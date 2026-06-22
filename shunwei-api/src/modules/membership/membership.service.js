const { getPool, legacyTable } = require('../../shared/mysql');
const { swTable } = require('../../shared/sw-mysql');
const { MembershipRepository } = require('../membership/membership.repository');
const { IntegralService } = require('../integral/integral.service');

const CHANNEL_MAP = {
  wechat_pay: 'wechat_purchase',
  offline_approval: 'offline_approval',
  admin: 'admin_grant'
};

/**
 * 会员业务服务（对齐 migrations/mvp1/ 表结构）
 */
class MembershipService {
  constructor() {
    this.repository = new MembershipRepository();
    this.integralService = new IntegralService();
  }

  normalizeTierCode(input) {
    const value = String(input || '').trim();
    if (value === 'tier_199' || value === 'SW199') return 'SW199';
    if (value === 'tier_299' || value === 'SW299') return 'SW299';
    return value;
  }

  async getPlans() {
    await this.repository.ensureTables();
    let maps = await this.repository.listShipMaps();
    if (!maps.length) {
      const config = await this.repository.getConfigMap();
      maps = [
        {
          tier_code: 'SW199',
          eb_member_ship_id: 0,
          gift_integral: Number(config.membership_gift_integral_sw199 || 199000),
          tier_rank: 1,
          title: '锦程199会员',
          vip_day: Number(config.member_vip_days || 365),
          pre_price: 199
        },
        {
          tier_code: 'SW299',
          eb_member_ship_id: 0,
          gift_integral: Number(config.membership_gift_integral_sw299 || 299000),
          tier_rank: 2,
          title: '锦程299会员',
          vip_day: Number(config.member_vip_days || 365),
          pre_price: 299
        }
      ];
    }

    return maps.map((row) => ({
      memberShipId: row.eb_member_ship_id,
      tierCode: row.tier_code,
      title: row.plan_title || row.ship_title || row.title || row.tier_code,
      price: Number(row.plan_price || row.ship_price || row.pre_price || 0),
      vipDays: Number(row.plan_vip_days || row.ship_vip_day || row.vip_day || 365),
      giftIntegral: Number(row.gift_integral || 0),
      tierRank: Number(row.tier_rank || 0)
    }));
  }

  async listPlansAdmin() {
    await this.repository.ensureTables();
    const rows = await this.repository.listPlansAdmin();
    return rows.map(toPlanDto);
  }

  async createPlan(input) {
    const data = normalizePlanInput(input, false);
    try {
      const id = await this.repository.createPlan(data);
      return { id, ...data, isActive: data.isActive };
    } catch (error) {
      throw translatePlanDupError(error);
    }
  }

  async updatePlan(id, input) {
    const data = normalizePlanInput(input, true);
    let affected = 0;
    try {
      affected = await this.repository.updatePlan(id, data);
    } catch (error) {
      throw translatePlanDupError(error);
    }
    if (!affected) {
      const error = new Error('会员卡方案不存在');
      error.statusCode = 404;
      throw error;
    }
    return { id: Number(id), ...data };
  }

  async deletePlan(id) {
    const affected = await this.repository.deletePlan(id);
    if (!affected) {
      const error = new Error('会员卡方案不存在');
      error.statusCode = 404;
      throw error;
    }
    return { deleted: true };
  }

  async getMe(uid) {
    await this.repository.ensureTables();
    const user = await this.repository.getUserMembership(uid);
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    const active = await this.repository.getActiveTierForUser(uid);
    const batches = await this.repository.listIntegralBatches(uid);
    const summary = await this.integralService.buildSummary(uid, batches, user.integral);

    return {
      uid: user.uid,
      nickname: user.nickname || '',
      tierCode: active ? active.tier_code : '',
      tierRank: active ? Number(active.tier_rank || 0) : 0,
      isMoneyLevel: Number(user.is_money_level || 0),
      isEverLevel: Number(user.is_ever_level || 0),
      overdueTime: Number(user.overdue_time || 0),
      membershipExpireAt: active ? Number(active.expire_at || 0) : 0,
      isMemberActive: this.isMemberActive(user),
      integral: summary
    };
  }

  async getIntegralSummary(uid) {
    const user = await this.repository.getUserMembership(uid);
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }
    const batches = await this.repository.listIntegralBatches(uid);
    return this.integralService.buildSummary(uid, batches, user.integral);
  }

  async claimGift(uid, input) {
    await this.repository.ensureTables();
    const config = await this.repository.getConfigMap();
    const tierCode = this.normalizeTierCode(input.tierCode);
    const sourceChannel = CHANNEL_MAP[input.channel] || input.channel;
    const sourceRef = String(input.refId || '').trim();
    const operatorUid = Number(input.operatorUid || 0);

    if (!sourceRef) {
      const error = new Error('refId 不能为空');
      error.statusCode = 400;
      throw error;
    }

    const existing = await this.repository.findMembershipBySource(sourceChannel, sourceRef);
    if (existing) {
      return { duplicate: true, membership: this.toMembershipDto(existing), integral: { granted: 0 } };
    }

    const tierMeta = await this.resolveTierMeta(tierCode, input.memberShipId, config);
    const user = await this.repository.getUserMembership(uid);
    if (!user) {
      const error = new Error('用户不存在');
      error.statusCode = 404;
      throw error;
    }

    const activeTier = await this.repository.getActiveTierForUser(uid);
    const beforeTier = activeTier ? activeTier.tier_code : '';
    const vipDays = Number(tierMeta.vipDays || config.member_vip_days || 365);
    const change = this.resolveMembershipChange(
      beforeTier,
      tierMeta.tierCode,
      Number(activeTier ? activeTier.expire_at : user.overdue_time || 0),
      vipDays
    );
    const isMoneyLevel = input.channel === 'wechat_pay' ? 1 : 2;
    const now = Math.floor(Date.now() / 1000);

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();

      await connection.query(
        `
        UPDATE ${legacyTable('user')}
        SET is_money_level = ?, is_ever_level = 0, overdue_time = ?
        WHERE uid = ? AND COALESCE(is_del, 0) = 0
        `,
        [isMoneyLevel, change.afterOverdue, uid]
      );

      const [membershipResult] = await connection.query(
        `
        INSERT INTO ${swTable('user_membership')}
          (uid, tier_code, eb_member_ship_id, source_channel, source_ref, granted_integral,
           start_at, expire_at, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `,
        [
          uid,
          change.afterTier,
          tierMeta.memberShipId,
          sourceChannel,
          sourceRef,
          tierMeta.giftIntegral,
          now,
          change.afterOverdue,
          now,
          now
        ]
      );

      const integralResult = await this.integralService.grantMembershipGiftIntegral(connection, {
        uid,
        amount: tierMeta.giftIntegral,
        sourceType: 'membership_grant',
        sourceId: `${sourceChannel}:${sourceRef}`,
        expireDays: Number(config.gift_integral_expire_days || 365),
        bizId: String(membershipResult.insertId),
        remark: `${change.afterTier} 开卡赠送`,
        operatorUid
      });

      await connection.commit();

      const membership = await this.repository.findMembershipBySource(sourceChannel, sourceRef);
      return { duplicate: false, membership: this.toMembershipDto(membership), integral: integralResult };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 在调用方事务中发放线下审批会员权益。
   * 审批流必须把会员、积分和现金券放在同一个事务内，因此不能调用
   * 会自行开启事务的 claimGift()。
   */
  async grantApprovalMembership(connection, uid, input) {
    const tierCode = this.normalizeTierCode(input.tierCode);
    const sourceChannel = 'offline_approval';
    const sourceRef = String(input.refId || '').trim();
    const operatorUid = Number(input.operatorUid || 0);
    const integralAmount = Number(input.integralAmount || 0);
    if (!sourceRef) throw Object.assign(new Error('refId 不能为空'), { statusCode: 400 });

    const [[existing]] = await connection.query(
      `SELECT * FROM ${swTable('user_membership')}
       WHERE source_channel = ? AND source_ref = ? LIMIT 1`,
      [sourceChannel, sourceRef]
    );
    if (existing) return { duplicate: true, membershipId: existing.id, integral: { granted: 0 } };

    const [[tierMeta]] = await connection.query(
      `SELECT tier_code, eb_member_ship_id, gift_integral, tier_rank
       FROM ${swTable('membership_ship_map')}
       WHERE tier_code = ? AND is_active = 1 LIMIT 1`,
      [tierCode]
    );
    if (!tierMeta) throw Object.assign(new Error('会员档位未配置'), { statusCode: 400 });

    const [[user]] = await connection.query(
      `SELECT uid, integral, is_money_level, overdue_time
       FROM ${legacyTable('user')}
       WHERE uid = ? AND COALESCE(is_del, 0) = 0 LIMIT 1 FOR UPDATE`,
      [uid]
    );
    if (!user) throw Object.assign(new Error('用户不存在'), { statusCode: 404 });

    const [[activeTier]] = await connection.query(
      `SELECT um.tier_code, um.expire_at, sm.tier_rank
       FROM ${swTable('user_membership')} um
       LEFT JOIN ${swTable('membership_ship_map')} sm ON sm.tier_code = um.tier_code
       WHERE um.uid = ? AND um.status = 1 AND um.expire_at > UNIX_TIMESTAMP()
       ORDER BY sm.tier_rank DESC, um.expire_at DESC LIMIT 1`,
      [uid]
    );
    const [[daysConfig]] = await connection.query(
      `SELECT config_value FROM ${swTable('system_config')}
       WHERE config_key = 'member_vip_days' LIMIT 1`
    );
    const vipDays = Number(daysConfig?.config_value || 365);
    const change = this.resolveMembershipChange(
      activeTier?.tier_code || '',
      tierCode,
      Number(activeTier?.expire_at || user.overdue_time || 0),
      vipDays
    );
    const now = Math.floor(Date.now() / 1000);

    await connection.query(
      `UPDATE ${legacyTable('user')}
       SET is_money_level = 2, is_ever_level = 0, overdue_time = ? WHERE uid = ?`,
      [change.afterOverdue, uid]
    );
    const [membershipResult] = await connection.query(
      `INSERT INTO ${swTable('user_membership')}
       (uid, tier_code, eb_member_ship_id, source_channel, source_ref, granted_integral,
        start_at, expire_at, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [uid, change.afterTier, tierMeta.eb_member_ship_id, sourceChannel, sourceRef,
       integralAmount, now, change.afterOverdue, now, now]
    );

    const integral = await this.integralService.grantMembershipGiftIntegral(connection, {
      uid,
      amount: integralAmount,
      sourceType: 'approval_grant',
      sourceId: sourceRef,
      expireDays: 365,
      bizId: sourceRef,
      remark: `${change.afterTier} 审批开通赠送`,
      operatorUid
    });
    return { duplicate: false, membershipId: membershipResult.insertId, integral };
  }

  async adminGrant(input) {
    return this.claimGift(Number(input.uid), {
      tierCode: input.tierCode,
      channel: 'admin',
      refId: input.refId || `admin-${Date.now()}-${input.uid}`,
      memberShipId: input.memberShipId
    });
  }

  async getAdminConfig() {
    await this.repository.ensureTables();
    const config = await this.repository.getConfigMap();
    return {
      integralMallSkipApproval: config.integral_mall_skip_approval === '1',
      giftIntegralSw199: Number(config.membership_gift_integral_sw199 || 0),
      giftIntegralSw299: Number(config.membership_gift_integral_sw299 || 0),
      giftIntegralExpireDays: Number(config.gift_integral_expire_days || 365),
      memberVipDays: Number(config.member_vip_days || 365),
      integralExchangeRate: Number(config.integral_exchange_rate || 1000)
    };
  }

  async updateSkipApproval(enabled) {
    await this.repository.updateConfig({ integral_mall_skip_approval: enabled ? '1' : '0' });
    return this.getAdminConfig();
  }

  async resolveTierMeta(tierCode, memberShipId, config) {
    const normalized = this.normalizeTierCode(tierCode);

    if (memberShipId) {
      const byShip = await this.repository.getShipMapByShipId(Number(memberShipId));
      if (byShip) {
        return {
          tierCode: byShip.tier_code,
          memberShipId: byShip.eb_member_ship_id,
          giftIntegral: Number(byShip.gift_integral || 0),
          tierRank: Number(byShip.tier_rank || 0),
          vipDays: Number(byShip.vip_days || byShip.vip_day || 0)
        };
      }
    }

    const byTier = await this.repository.getShipMapByTier(normalized);
    if (byTier) {
      return {
        tierCode: byTier.tier_code,
        memberShipId: byTier.eb_member_ship_id,
        giftIntegral: Number(byTier.gift_integral || 0),
        tierRank: Number(byTier.tier_rank || 0),
        vipDays: Number(byTier.vip_days || byTier.vip_day || 0)
      };
    }

    if (normalized === 'SW299') {
      return {
        tierCode: 'SW299',
        memberShipId: 0,
        giftIntegral: Number(config.membership_gift_integral_sw299 || 299000),
        tierRank: 2,
        vipDays: Number(config.member_vip_days || 365)
      };
    }

    return {
      tierCode: 'SW199',
      memberShipId: 0,
      giftIntegral: Number(config.membership_gift_integral_sw199 || 199000),
      tierRank: 1,
      vipDays: Number(config.member_vip_days || 365)
    };
  }

  resolveMembershipChange(beforeTier, newTier, currentExpireAt, vipDays) {
    const now = Math.floor(Date.now() / 1000);
    const beforeRank = beforeTier === 'SW299' ? 2 : beforeTier === 'SW199' ? 1 : 0;
    const newRank = newTier === 'SW299' ? 2 : 1;
    const afterTier = newRank > beforeRank ? newTier : beforeRank > 0 ? beforeTier : newTier;
    const base = Math.max(currentExpireAt || 0, now);
    const afterOverdue = base + vipDays * 86400;
    return { afterTier, afterOverdue };
  }

  isMemberActive(user) {
    if (Number(user.is_ever_level || 0) === 1) return true;
    if (Number(user.is_money_level || 0) <= 0) return false;
    const overdue = Number(user.overdue_time || 0);
    return overdue === 0 || overdue > Math.floor(Date.now() / 1000);
  }

  toMembershipDto(row) {
    return {
      id: row.id,
      uid: row.uid,
      tierCode: row.tier_code,
      memberShipId: row.eb_member_ship_id,
      sourceChannel: row.source_channel,
      sourceRef: row.source_ref,
      grantedIntegral: row.granted_integral,
      startAt: row.start_at,
      expireAt: row.expire_at,
      status: row.status
    };
  }
}

function toPlanDto(row) {
  return {
    id: Number(row.id),
    tierCode: row.tier_code,
    title: row.plan_title || row.ship_title || row.tier_code,
    price: Number(row.plan_price || row.ship_price || 0),
    vipDays: Number(row.plan_vip_days || row.ship_vip_day || 365),
    giftIntegral: Number(row.gift_integral || 0),
    memberShipId: Number(row.eb_member_ship_id || 0),
    tierRank: Number(row.tier_rank || 0),
    sort: Number(row.plan_sort || 0),
    isActive: Number(row.is_active) === 1,
    shipTitle: row.ship_title || ''
  };
}

function normalizePlanInput(input = {}, partial = false) {
  const data = {};
  const setStr = (key, val, max) => { if (val !== undefined) data[key] = String(val).trim().slice(0, max); };
  const setNum = (key, val) => { if (val !== undefined) data[key] = Number(val) || 0; };

  if (input.tierCode !== undefined) data.tierCode = String(input.tierCode).trim().toUpperCase().slice(0, 16);
  setStr('title', input.title, 64);
  setNum('price', input.price);
  setNum('vipDays', input.vipDays);
  setNum('giftIntegral', input.giftIntegral);
  setNum('memberShipId', input.memberShipId);
  setNum('tierRank', input.tierRank);
  setNum('sort', input.sort);
  if (input.isActive !== undefined) data.isActive = Boolean(input.isActive);

  if (!partial) {
    if (!data.tierCode) { const e = new Error('档位代码不能为空'); e.statusCode = 400; throw e; }
    if (!data.title) { const e = new Error('方案名称不能为空'); e.statusCode = 400; throw e; }
    if (data.memberShipId === undefined) data.memberShipId = 0;
    if (data.giftIntegral === undefined) data.giftIntegral = 0;
    if (data.tierRank === undefined) data.tierRank = 0;
    if (data.sort === undefined) data.sort = 0;
    if (data.price === undefined) data.price = 0;
    if (data.vipDays === undefined) data.vipDays = 365;
    if (data.isActive === undefined) data.isActive = true;
  }
  return data;
}

function translatePlanDupError(error) {
  if (error && error.code === 'ER_DUP_ENTRY') {
    const msg = String(error.sqlMessage || '');
    if (msg.includes('uk_tier_code')) {
      const e = new Error('该档位代码已存在');
      e.statusCode = 409;
      return e;
    }
    if (msg.includes('uk_ship_id')) {
      const e = new Error('该 CRMEB 会员卡已被其他方案关联（每张卡只能绑定一个方案）');
      e.statusCode = 409;
      return e;
    }
    const e = new Error('方案已存在（档位或关联卡重复）');
    e.statusCode = 409;
    return e;
  }
  return error;
}

module.exports = { MembershipService };
