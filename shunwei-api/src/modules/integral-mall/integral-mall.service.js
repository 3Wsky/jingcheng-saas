const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');

/**
 * 积分商城核销服务（MVP1：免审开启时店员直接核销）
 */
class IntegralMallService {
  async assertStaff(uid) {
    const [rows] = await getPool().query(
      `
      SELECT uid, is_staff, division_id, nickname
      FROM ${legacyTable('user')}
      WHERE uid = ? AND COALESCE(is_del, 0) = 0
      LIMIT 1
      `,
      [uid]
    );
    const staff = rows[0];
    if (!staff || Number(staff.is_staff || 0) !== 1) {
      const error = new Error('无店员核销权限');
      error.statusCode = 403;
      throw error;
    }
    return staff;
  }

  async isSkipApprovalEnabled() {
    const [rows] = await getPool().query(
      `SELECT config_value FROM ${swTable('system_config')} WHERE config_key = 'integral_mall_skip_approval' LIMIT 1`
    );
    return !rows[0] || rows[0].config_value === '1';
  }

  async findIntegralOrder(identifier) {
    const key = String(identifier || '').trim();
    if (!key) return null;

    const [rows] = await getPool().query(
      `
      SELECT id, order_id, uid, product_id, store_name, verify_code, status, total_price
      FROM ${legacyTable('store_integral_order')}
      WHERE is_del = 0 AND (order_id = ? OR verify_code = ?)
      LIMIT 1
      `,
      [key, key]
    );
    return rows[0] || null;
  }

  async verifyPickup(staffUid, orderId) {
    const staff = await this.assertStaff(staffUid);
    const skipApproval = await this.isSkipApprovalEnabled();
    if (!skipApproval) {
      const error = new Error('积分商城免审已关闭，请走审批流程(MVP2)');
      error.statusCode = 403;
      throw error;
    }

    const order = await this.findIntegralOrder(orderId);
    if (!order) {
      const error = new Error('积分订单不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(order.status || 0) === 3) {
      const error = new Error('订单已核销');
      error.statusCode = 409;
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      const [updateResult] = await connection.query(
        `
        UPDATE ${legacyTable('store_integral_order')}
        SET status = 3, delivery_type = 'fictitious', delivery_name = ?, delivery_uid = ?
        WHERE order_id = ? AND is_del = 0 AND status <> 3
        `,
        [staff.nickname || '店员', staffUid, orderId]
      );

      if (!updateResult.affectedRows) {
        const error = new Error('核销失败，订单状态可能已变更');
        error.statusCode = 409;
        throw error;
      }

      await connection.query(
        `
        INSERT INTO ${swTable('integral_mall_verify_log')}
          (integral_order_id, order_id, uid, product_id, verify_code, staff_uid, division_id,
           verify_status, skip_approval, remark, verified_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, '店员免审核销', ?, ?)
        ON DUPLICATE KEY UPDATE
          staff_uid = VALUES(staff_uid),
          verify_status = 1,
          verified_at = VALUES(verified_at)
        `,
        [
          order.id,
          order.order_id,
          order.uid,
          order.product_id,
          order.verify_code || '',
          staffUid,
          Number(staff.division_id || 0),
          now,
          now
        ]
      );

      await connection.commit();
      return {
        orderId: order.order_id,
        customerUid: order.uid,
        productName: order.store_name,
        integralCost: Number(order.total_price || 0),
        verifiedAt: now,
        staffUid
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async exchange(uid, productId) {
    const [productRows] = await getPool().query(
      `SELECT id, image, title, price, stock, unit_name, is_show
       FROM ${legacyTable('store_integral')}
       WHERE id = ? AND is_del = 0 LIMIT 1`,
      [productId]
    );
    const product = productRows[0];
    if (!product) {
      const error = new Error('积分商品不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(product.is_show) !== 1) {
      const error = new Error('该商品已下架');
      error.statusCode = 400;
      throw error;
    }
    if (Number(product.stock || 0) <= 0) {
      const error = new Error('暂时无法兑换，过两天试试');
      error.statusCode = 400;
      throw error;
    }

    const integralCost = Number(product.price || 0);
    const [userRows] = await getPool().query(
      `SELECT uid, integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0)=0 LIMIT 1`,
      [uid]
    );
    if (!userRows[0]) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(userRows[0].integral || 0) < integralCost) {
      const error = new Error('积分不足');
      error.statusCode = 400;
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const orderId = `IG${now}${uid}${Math.random().toString(36).slice(2, 6)}`;
    const verifyCode = String(Math.floor(100000 + Math.random() * 900000));
    const connection = await getPool().getConnection();

    try {
      await connection.beginTransaction();

      await connection.query(
        `UPDATE ${legacyTable('store_integral')} SET stock = stock - 1 WHERE id = ? AND stock > 0`,
        [productId]
      );

      const afterIntegral = Number(userRows[0].integral) - integralCost;
      await connection.query(
        `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
        [afterIntegral, uid]
      );

      await connection.query(
        `INSERT INTO ${legacyTable('store_integral_order')}
         (uid, order_id, product_id, store_name, image, total_price, unique, verify_code,
          status, is_del, add_time, channel_type, shipping_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 'routine', 'fictitious')`,
        [uid, orderId, productId, product.title, product.image, integralCost,
         orderId, verifyCode, now]
      );

      await connection.query(
        `INSERT INTO ${legacyTable('user_bill')}
         (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
         VALUES (?, ?, 0, '积分商城兑换', 'integral', 'deduction', ?, ?, ?, ?, 1, 0, 0)`,
        [uid, orderId, integralCost, afterIntegral, `兑换${product.title}`, now]
      );

      await connection.commit();
      return {
        orderId,
        verifyCode,
        productName: product.title,
        integralCost,
        balanceAfter: afterIntegral
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async listUserOrders(uid, page = 1, limit = 20) {
    const offset = (page - 1) * limit;
    const [[countRow]] = await getPool().query(
      `SELECT COUNT(*) AS total FROM ${legacyTable('store_integral_order')}
       WHERE uid = ? AND is_del = 0`,
      [uid]
    );
    const [rows] = await getPool().query(
      `SELECT order_id, product_id, store_name, image, total_price, verify_code, status, add_time
       FROM ${legacyTable('store_integral_order')}
       WHERE uid = ? AND is_del = 0
       ORDER BY add_time DESC
       LIMIT ? OFFSET ?`,
      [uid, limit, offset]
    );

    return {
      list: rows.map((r) => ({
        orderId: r.order_id,
        productId: r.product_id,
        productName: r.store_name || '',
        image: r.image || '',
        integralCost: Number(r.total_price || 0),
        verifyCode: r.verify_code || '',
        status: Number(r.status || 0),
        statusLabel: Number(r.status) === 3 ? '已核销' : '待核销',
        createdAt: Number(r.add_time || 0),
      })),
      total: Number(countRow?.total || 0),
      page,
      limit,
    };
  }

  async getCustomerBenefits(customerUid) {
    const [userRows] = await getPool().query(
      `
      SELECT uid, nickname, integral, is_money_level, overdue_time, is_staff
      FROM ${legacyTable('user')}
      WHERE uid = ? AND COALESCE(is_del, 0) = 0
      LIMIT 1
      `,
      [customerUid]
    );
    if (!userRows[0]) {
      const error = new Error('客户不存在');
      error.statusCode = 404;
      throw error;
    }

    const [membershipRows] = await getPool().query(
      `
      SELECT tier_code, expire_at, granted_integral, source_channel, created_at
      FROM ${swTable('user_membership')}
      WHERE uid = ? AND status = 1
      ORDER BY expire_at DESC
      LIMIT 5
      `,
      [customerUid]
    );

    const [batchRows] = await getPool().query(
      `
      SELECT SUM(remain_amount) AS gift_remain
      FROM ${swTable('integral_batch')}
      WHERE uid = ? AND status = 1 AND batch_type = 'gift'
      `,
      [customerUid]
    );

    return {
      uid: userRows[0].uid,
      nickname: userRows[0].nickname || '',
      integral: Number(userRows[0].integral || 0),
      giftIntegralRemain: Number(batchRows[0]?.gift_remain || 0),
      isMoneyLevel: Number(userRows[0].is_money_level || 0),
      overdueTime: Number(userRows[0].overdue_time || 0),
      memberships: membershipRows
    };
  }
}

module.exports = { IntegralMallService };
