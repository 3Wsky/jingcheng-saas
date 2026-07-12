const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { toPublicUrl } = require('../../shared/url');

const DEMO_SOURCE_TYPE = 'demo_video';
const DEMO_ORDER_PREFIX = 'DEMOIG';

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
        [staff.nickname || '店员', staffUid, order.order_id]
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
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)
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
          String(order.order_id || '').startsWith(DEMO_ORDER_PREFIX) ? '[演示]店员免审核销' : '店员免审核销',
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
    // 事务前预检查仅用于快速失败/友好提示；真正的扣减以事务内「锁后重读」为准（防并发双花）。
    const [preUserRows] = await getPool().query(
      `SELECT uid, integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0)=0 LIMIT 1`,
      [uid]
    );
    if (!preUserRows[0]) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(preUserRows[0].integral || 0) < integralCost) {
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

      // 锁定用户行后重读积分（权威值），杜绝并发/双击下的丢失更新（积分双花）。
      const [lockedUserRows] = await connection.query(
        `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? AND COALESCE(is_del,0)=0 LIMIT 1 FOR UPDATE`,
        [uid]
      );
      if (!lockedUserRows[0]) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }
      const beforeIntegral = Number(lockedUserRows[0].integral || 0);
      if (beforeIntegral < integralCost) {
        const error = new Error('积分不足');
        error.statusCode = 400;
        throw error;
      }

      const [demoBatches] = await connection.query(
        `SELECT id, remain_amount
         FROM ${swTable('integral_batch')}
         WHERE uid = ? AND status = 1 AND remain_amount > 0 AND source_type = ?
         ORDER BY expire_at ASC, id ASC
         FOR UPDATE`,
        [uid, DEMO_SOURCE_TYPE]
      );
      const demoAvailable = demoBatches.reduce((sum, batch) => sum + Number(batch.remain_amount || 0), 0);
      if (demoAvailable > 0) {
        if (demoAvailable < integralCost) {
          const error = new Error('演示积分不足');
          error.statusCode = 400;
          throw error;
        }

        let remaining = integralCost;
        for (const batch of demoBatches) {
          if (remaining <= 0) break;
          const batchRemain = Number(batch.remain_amount || 0);
          const deduct = Math.min(batchRemain, remaining);
          const newRemain = batchRemain - deduct;
          await connection.query(
            `UPDATE ${swTable('integral_batch')}
             SET remain_amount = ?, status = ?, updated_at = ?
             WHERE id = ?`,
            [newRemain, newRemain > 0 ? 1 : 0, now, batch.id]
          );
          remaining -= deduct;
        }

        const afterIntegral = beforeIntegral - integralCost;
        const demoOrderId = `${DEMO_ORDER_PREFIX}${now}${uid}${Math.random().toString(36).slice(2, 6)}`;
        await connection.query(
          `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
          [afterIntegral, uid]
        );
        await connection.query(
          `INSERT INTO ${legacyTable('store_integral_order')}
           (uid, order_id, product_id, store_name, image, suk, total_num, price, total_price,
            verify_code, status, is_del, add_time, delivery_type, channel_type)
           VALUES (?, ?, ?, ?, ?, '', 1, ?, ?, ?, 0, 0, ?, 'fictitious', 'routine')`,
          [uid, demoOrderId, productId, product.title, product.image,
           integralCost, integralCost, verifyCode, now]
        );
        await connection.query(
          `INSERT INTO ${legacyTable('user_bill')}
           (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
           VALUES (?, ?, 0, '积分商城兑换', 'integral', 'deduction', ?, ?, ?, ?, 1, 0, 0)`,
          [uid, demoOrderId, integralCost, afterIntegral, `[演示]兑换${product.title}`, now]
        );
        await connection.commit();
        return {
          orderId: demoOrderId,
          verifyCode,
          productName: product.title,
          integralCost,
          balanceAfter: afterIntegral,
          isDemo: true
        };
      }

      // 原子扣库存并校验 affectedRows：售罄（=0 行）立即回滚，绝不“扣分却没货”。
      const [stockUpd] = await connection.query(
        `UPDATE ${legacyTable('store_integral')} SET stock = stock - 1 WHERE id = ? AND stock > 0`,
        [productId]
      );
      if (!stockUpd.affectedRows) {
        const error = new Error('手慢了，刚被兑换完，过两天试试');
        error.statusCode = 409;
        throw error;
      }

      const afterIntegral = beforeIntegral - integralCost;
      await connection.query(
        `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
        [afterIntegral, uid]
      );

      await connection.query(
        `INSERT INTO ${legacyTable('store_integral_order')}
         (uid, order_id, product_id, store_name, image, suk, total_num, price, total_price,
          verify_code, status, is_del, add_time, delivery_type, channel_type)
         VALUES (?, ?, ?, ?, ?, '', 1, ?, ?, ?, 0, 0, ?, 'fictitious', 'routine')`,
        [uid, orderId, productId, product.title, product.image,
         integralCost, integralCost, verifyCode, now]
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

  async cancelExchange(uid, orderId, options = {}) {
    const allowExpired = Boolean(options.allowExpired);
    const keepOrderVisible = Boolean(options.keepOrderVisible);
    const allowVerified = Boolean(options.allowVerified);
    const [orderRows] = await getPool().query(
      `SELECT id, uid, order_id, product_id, store_name, total_price, status, is_del, add_time
       FROM ${legacyTable('store_integral_order')}
       WHERE order_id = ? LIMIT 1`,
      [orderId]
    );
    const order = orderRows[0];
    if (!order || Number(order.is_del) === 1) {
      const error = new Error('订单不存在');
      error.statusCode = 404;
      throw error;
    }
    if (Number(order.uid) !== Number(uid)) {
      const error = new Error('无权操作该订单');
      error.statusCode = 403;
      throw error;
    }
    if (Number(order.status || 0) === 3 && !allowVerified) {
      const error = new Error('这笔礼品已到店核销啦，无法再撤销～如有疑问可联系客户经理');
      error.statusCode = 409;
      throw error;
    }
    if (Number(order.status || 0) === -1) {
      const error = new Error('该兑换订单已撤销，积分和库存均已恢复');
      error.statusCode = 409;
      throw error;
    }

    const now = Math.floor(Date.now() / 1000);
    const CANCEL_WINDOW = 24 * 3600;
    if (!allowExpired && now - Number(order.add_time || 0) > CANCEL_WINDOW) {
      const error = new Error('已超过 24 小时撤销时限，这笔兑换暂时无法撤销啦～如有需要可联系客户经理协助');
      error.statusCode = 409;
      throw error;
    }

    const refund = Number(order.total_price || 0);
    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      const [delResult] = await connection.query(
        `UPDATE ${legacyTable('store_integral_order')}
         SET is_del = ?, status = -1
         WHERE order_id = ? AND uid = ? AND is_del = 0 AND status <> -1`,
        [keepOrderVisible ? 0 : 1, orderId, uid]
      );
      if (!delResult.affectedRows) {
        const error = new Error('撤销失败，订单状态可能已变更');
        error.statusCode = 409;
        throw error;
      }

      const [stockResult] = await connection.query(
        `UPDATE ${legacyTable('store_integral')} SET stock = stock + 1 WHERE id = ?`,
        [order.product_id]
      );
      if (!stockResult.affectedRows) {
        const error = new Error('礼品不存在，无法恢复库存');
        error.statusCode = 409;
        throw error;
      }

      // 锁定用户行后重读积分，避免与并发兑换/其它积分变动互相覆盖（丢失更新）。
      const [userRows] = await connection.query(
        `SELECT integral FROM ${legacyTable('user')} WHERE uid = ? LIMIT 1 FOR UPDATE`,
        [uid]
      );
      if (!userRows.length) {
        const error = new Error('用户不存在，无法退回积分');
        error.statusCode = 409;
        throw error;
      }
      const beforeIntegral = Number(userRows[0]?.integral || 0);
      const afterIntegral = beforeIntegral + refund;
      await connection.query(
        `UPDATE ${legacyTable('user')} SET integral = ? WHERE uid = ?`,
        [afterIntegral, uid]
      );

      await connection.query(
        `INSERT INTO ${legacyTable('user_bill')}
         (uid, link_id, pm, title, category, type, number, balance, mark, add_time, status, take, frozen_time)
         VALUES (?, ?, 1, '积分兑换撤销', 'integral', 'system_add', ?, ?, ?, ?, 1, 0, 0)`,
        [uid, orderId, refund, afterIntegral, `撤销兑换退回${order.store_name || ''}`, now]
      );

      await connection.commit();
      return {
        orderId,
        uid: Number(uid),
        refundIntegral: refund,
        balanceAfter: afterIntegral,
        productId: Number(order.product_id || 0),
        productName: order.store_name || ''
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async cancelExchangeByAdmin(orderId) {
    const [rows] = await getPool().query(
      `SELECT uid FROM ${legacyTable('store_integral_order')} WHERE order_id = ? LIMIT 1`,
      [orderId]
    );
    const uid = Number(rows[0]?.uid || 0);
    if (!uid) {
      const error = new Error('订单不存在');
      error.statusCode = 404;
      throw error;
    }
    return this.cancelExchange(uid, orderId, {
      allowExpired: true,
      keepOrderVisible: true,
      allowVerified: true
    });
  }

  async listUserOrders(uid, page = 1, limit = 20, request) {
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
        image: toPublicUrl(r.image || '', request),
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
