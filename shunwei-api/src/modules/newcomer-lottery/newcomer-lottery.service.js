const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const { getPool, legacyTable } = require('../../shared/mysql');
const { NewcomerLotteryRepository } = require('./newcomer-lottery.repository');

const REDEEM_EXPIRE_DAYS = 30;
const REDEEM_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const TASKS = [
  { id: 'register', title: '完成新用户注册', desc: '首次注册后可领取 1 次机会', action: '领取', enabled: true, rewardChances: 1 },
  { id: 'browse', title: '浏览商品', desc: '浏览商品后即可解锁 1 次机会', action: '领取', enabled: true, rewardChances: 1 },
  { id: 'profile', title: '完善个人资料', desc: '补全资料即可解锁 1 次机会', action: '领取', enabled: true, rewardChances: 1 }
];

const PRIZES = [
  { id: 'thanks', name: '谢谢参与', tag: '再接再厉', wheelIndex: 0, weight: 20, enabled: true, stock: null },
  { id: 'coupon', name: '购机优惠券', tag: '下单可用', wheelIndex: 1, weight: 22, enabled: true, stock: 999 },
  { id: 'mystery', name: '神秘大礼', tag: '惊喜好礼', wheelIndex: 2, weight: 8, enabled: true, stock: 200 },
  { id: 'newcomer', name: '新客礼', tag: '新人专属', wheelIndex: 3, weight: 14, enabled: true, stock: 500 },
  { id: 'heart', name: '感恩礼', tag: '福利礼包', wheelIndex: 4, weight: 12, enabled: true, stock: 300 },
  { id: 'surprise', name: '惊喜礼', tag: '随机掉落', wheelIndex: 5, weight: 10, enabled: true, stock: 100 },
  { id: 'again', name: '再来一次', tag: '好运加倍', wheelIndex: 6, weight: 14, enabled: true, stock: null }
];

const DEFAULT_CONFIG = {
  activity: {
    name: '新客首登抽奖',
    status: 'enabled',
    desc: '面向新用户的拉新活动。当前由新后端服务端开奖，前端只负责动画展示。',
    dailyLimit: 0,
    guaranteeMisses: 0,
    guaranteePrizeId: 'coupon'
  },
  tasks: TASKS,
  prizes: PRIZES
};

class NewcomerLotteryService {
  constructor(repository = new NewcomerLotteryRepository()) {
    this.repository = repository;
  }

  async getState(uid) {
    const userState = await this.ensureUser(uid);
    const config = await this.getConfig();
    return this.toClientState(userState, config);
  }

  async claimTask(uid, taskId) {
    const config = await this.getConfig();
    const task = config.tasks.find((item) => item.id === taskId);
    if (!task) {
      const error = new Error('任务不存在');
      error.statusCode = 404;
      throw error;
    }
    if (!task.enabled) {
      const error = new Error('任务已关闭');
      error.statusCode = 400;
      throw error;
    }

    const updatedState = await this.repository.updateAll((state) => {
      const redeemCodes = collectRedeemCodesExcept(state.users, uid);
      const userState = this.normalizeUserState(state.users[uid] || null, redeemCodes);
      if (userState.doneTasks.includes(taskId)) {
        state.users[uid] = userState;
        return state;
      }
      userState.doneTasks.push(taskId);
      userState.chances += task.rewardChances;
      userState.updatedAt = now();
      state.users[uid] = userState;
      return state;
    });
    const updated = updatedState.users[uid];

    return this.toClientState(updated, config);
  }

  async draw(uid) {
    let drawnPrize = null;
    let guaranteeApplied = false;
    let config = null;
    let updatedUser = null;

    const updatedState = await this.repository.updateAll((state) => {
      state.config = this.normalizeConfig(state.config);
      config = state.config;
      const redeemCodes = collectRedeemCodesExcept(state.users, uid);
      const userState = this.normalizeUserState(state.users[uid] || null, redeemCodes);

      if (userState.chances <= 0) {
        const error = new Error('抽奖次数不足');
        error.statusCode = 400;
        throw error;
      }

      if (config.activity.status !== 'enabled') {
        const error = new Error('活动已关闭');
        error.statusCode = 400;
        throw error;
      }

      if (config.activity.dailyLimit > 0) {
        const todayCount = userState.records.filter((record) => dateKey(record.createdAt) === todayKey()).length;
        if (todayCount >= config.activity.dailyLimit) {
          const error = new Error('今日抽奖次数已达上限');
          error.statusCode = 400;
          throw error;
        }
      }

      const guaranteedPrize = findGuaranteedPrize(config, userState);
      const drawablePrizes = config.prizes.filter((prize) => isPrizeDrawableForUser(prize, userState));
      if (!guaranteedPrize && !drawablePrizes.length) {
        const error = new Error('暂无可抽奖品');
        error.statusCode = 400;
        throw error;
      }

      drawnPrize = guaranteedPrize || pickWeightedPrize(drawablePrizes);
      guaranteeApplied = Boolean(guaranteedPrize);
      state.config.prizes = state.config.prizes.map((prize) => {
        if (prize.id !== drawnPrize.id || prize.stock === null || prize.stock === undefined) return prize;
        return {
          ...prize,
          stock: Math.max(0, prize.stock - 1)
        };
      });
      config = state.config;

      userState.chances -= 1;
      if (drawnPrize.id === 'again') userState.chances += 1;

      const record = {
        id: nanoid(16),
        prizeId: drawnPrize.id,
        name: drawnPrize.name,
        tag: drawnPrize.tag,
        wheelIndex: drawnPrize.wheelIndex,
        won: drawnPrize.id !== 'thanks',
        rule: guaranteeApplied ? 'guarantee' : 'weighted',
        createdAt: now()
      };
      if (record.won) {
        Object.assign(record, createRedemptionFields(record.createdAt, redeemCodes));
      }

      userState.records = [record].concat(userState.records).slice(0, 50);
      userState.updatedAt = now();
      state.users[uid] = userState;
      state.config.updatedAt = now();
      updatedUser = userState;
      return state;
    });

    config = this.normalizeConfig(updatedState.config);
    updatedUser = updatedUser || updatedState.users[uid];

    return {
      prize: publicPrize(drawnPrize),
      chances: updatedUser.chances,
      records: updatedUser.records.slice(0, 20),
      state: this.toClientState(updatedUser, config)
    };
  }

  async getRecords(uid) {
    const userState = await this.ensureUser(uid);
    return userState.records.slice(0, 20);
  }

  async ensureRedeemCodes() {
    return this.repository.updateAll((state) => {
      const usersState = state && state.users && typeof state.users === 'object' ? state.users : {};
      const redeemCodes = new Set();
      for (const [uid, userState] of Object.entries(usersState)) {
        usersState[uid] = this.normalizeUserState(userState, redeemCodes);
      }
      state.users = usersState;
      return state;
    });
  }

  async getWinnerFeed(limit = 20) {
    await this.ensureRedeemCodes();
    const state = await this.repository.readAll();
    const usersState = state && state.users && typeof state.users === 'object' ? state.users : {};
    const records = [];

    for (const [uid, userState] of Object.entries(usersState)) {
      const normalized = this.normalizeUserState(userState);
      for (const record of normalized.records) {
        if (!record || record.won === false) continue;
        records.push({
          uid,
          id: record.id || '',
          prizeId: record.prizeId || '',
          prizeName: record.name || '',
          tag: record.tag || '',
          createdAt: record.createdAt || normalized.updatedAt || ''
        });
      }
    }

    records.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const latest = records.slice(0, normalizeInteger(limit, 20, 1));
    const nicknames = await getNicknamesByUid(latest.map((record) => record.uid));

    return latest.map((record) => ({
      ...record,
      nickname: nicknames[String(record.uid)] || fallbackNickname(record.uid)
    }));
  }

  async redeemByCode(code, input = {}) {
    const targetCode = normalizeRedeemCode(code);
    if (!targetCode) {
      const error = new Error('兑换码不能为空');
      error.statusCode = 400;
      throw error;
    }

    let redeemedRecord = null;
    const redeemedAt = now();
    const note = cleanText(input.note, '');
    const operator = cleanText(input.operator, 'admin');
    let terminalError = null;

    await this.repository.updateAll((state) => {
      const usersState = state && state.users && typeof state.users === 'object' ? state.users : {};
      const redeemCodes = new Set();

      for (const [uid, userState] of Object.entries(usersState)) {
        const normalized = this.normalizeUserState(userState, redeemCodes);
        const index = normalized.records.findIndex((record) => normalizeRedeemCode(record.redeemCode) === targetCode);
        if (index === -1) {
          usersState[uid] = normalized;
          continue;
        }

        const record = normalized.records[index];
        if (record.won === false) {
          const error = new Error('未中奖记录不能核销');
          error.statusCode = 400;
          throw error;
        }
        if (record.redeemStatus === 'redeemed') {
          const error = new Error('该兑换码已经核销');
          error.statusCode = 409;
          throw error;
        }
        if (record.redeemStatus === 'void') {
          const error = new Error('该兑换码已作废');
          error.statusCode = 409;
          throw error;
        }
        if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
          const error = new Error('该兑换码已过期');
          error.statusCode = 410;
          normalized.records[index] = {
            ...record,
            redeemStatus: 'expired'
          };
          normalized.updatedAt = redeemedAt;
          usersState[uid] = normalized;
          terminalError = error;
          return state;
        }

        const nextRecord = {
          ...record,
          redeemStatus: 'redeemed',
          redeemedAt,
          fulfillment: {
            status: 'fulfilled',
            note,
            updatedAt: redeemedAt,
            fulfilledAt: redeemedAt,
            operator
          }
        };

        normalized.records[index] = nextRecord;
        normalized.updatedAt = redeemedAt;
        usersState[uid] = normalized;
        redeemedRecord = {
          uid,
          ...nextRecord
        };
        return state;
      }

      const error = new Error('兑换码不存在');
      error.statusCode = 404;
      throw error;
    });

    if (terminalError) throw terminalError;
    return redeemedRecord;
  }

  async ensureUser(uid) {
    const updated = await this.repository.updateAll((state) => {
      state.config = this.normalizeConfig(state.config);
      state.users[uid] = this.normalizeUserState(state.users[uid] || null, collectRedeemCodesExcept(state.users, uid));
      return state;
    });
    return updated.users[uid];
  }

  async getConfig() {
    const state = await this.repository.updateAll((current) => {
      current.config = this.normalizeConfig(current.config);
      return current;
    });
    return this.normalizeConfig(state.config);
  }

  async updateConfig(input) {
    const state = await this.repository.updateAll((current) => {
      current.config = this.normalizeConfig(input);
      current.config.updatedAt = now();
      return current;
    });
    return this.normalizeConfig(state.config);
  }

  normalizeConfig(config) {
    const source = config && typeof config === 'object' ? config : {};
    const activity = source.activity && typeof source.activity === 'object' ? source.activity : {};
    const taskMap = new Map((Array.isArray(source.tasks) ? source.tasks : []).map((task) => [task.id, task]));
    const prizeMap = new Map((Array.isArray(source.prizes) ? source.prizes : []).map((prize) => [prize.id, prize]));

    return {
      activity: {
        name: cleanText(activity.name, DEFAULT_CONFIG.activity.name),
        status: activity.status === 'disabled' ? 'disabled' : 'enabled',
        desc: cleanText(activity.desc, DEFAULT_CONFIG.activity.desc),
        dailyLimit: normalizeInteger(activity.dailyLimit, DEFAULT_CONFIG.activity.dailyLimit, 0),
        guaranteeMisses: normalizeInteger(activity.guaranteeMisses, DEFAULT_CONFIG.activity.guaranteeMisses, 0),
        guaranteePrizeId: normalizePrizeId(activity.guaranteePrizeId, DEFAULT_CONFIG.activity.guaranteePrizeId)
      },
      tasks: TASKS.map((task) => {
        const incoming = taskMap.get(task.id) || {};
        return {
          id: task.id,
          title: cleanText(incoming.title, task.title),
          desc: cleanText(incoming.desc, task.desc),
          action: cleanText(incoming.action, task.action),
          enabled: incoming.enabled !== false,
          rewardChances: normalizeInteger(incoming.rewardChances, task.rewardChances, 1)
        };
      }),
      prizes: PRIZES.map((prize) => {
        const incoming = prizeMap.get(prize.id) || {};
        return {
          id: prize.id,
          name: cleanText(incoming.name, prize.name),
          tag: cleanText(incoming.tag, prize.tag),
          wheelIndex: prize.wheelIndex,
          weight: normalizeInteger(incoming.weight, prize.weight, 0),
          enabled: incoming.enabled !== false,
          stock: normalizeStock(incoming.stock, prize.stock),
          oncePerUser: incoming.oncePerUser === true
        };
      }),
      updatedAt: source.updatedAt || now()
    };
  }

  normalizeUserState(state, redeemCodes) {
    const initial = {
      chances: 0,
      doneTasks: [],
      records: [],
      createdAt: now(),
      updatedAt: now()
    };

    if (!state) return initial;

    return {
      chances: Number.isFinite(state.chances) ? state.chances : 0,
      doneTasks: Array.isArray(state.doneTasks) ? state.doneTasks : [],
      records: Array.isArray(state.records) ? normalizeRecordsForRedemption(state.records, redeemCodes) : [],
      createdAt: state.createdAt || now(),
      updatedAt: state.updatedAt || now()
    };
  }

  toClientState(userState, config = this.normalizeConfig()) {
    const enabledTasks = config.tasks.filter((task) => task.enabled);

    return {
      activity: {
        name: config.activity.name,
        status: config.activity.status,
        desc: config.activity.desc
      },
      chances: userState.chances,
      tasks: enabledTasks.map((task) => ({
        ...task,
        done: userState.doneTasks.includes(task.id)
      })),
      prizes: config.prizes.filter((prize) => prize.enabled).map(publicPrize),
      records: userState.records.slice(0, 20),
      doneTaskCount: enabledTasks.filter((task) => userState.doneTasks.includes(task.id)).length
    };
  }
}

function publicPrize(prize) {
  return {
    id: prize.id,
    name: prize.name,
    tag: prize.tag,
    wheelIndex: prize.wheelIndex,
    stock: prize.stock === undefined ? null : prize.stock
  };
}

function pickWeightedPrize(prizes) {
  const total = prizes.reduce((sum, prize) => sum + prize.weight, 0);
  const random = crypto.randomInt(1, total + 1);
  let cursor = 0;

  for (const prize of prizes) {
    cursor += prize.weight;
    if (random <= cursor) return prize;
  }

  return prizes[0];
}

function findGuaranteedPrize(config, userState) {
  const guaranteeMisses = Number(config.activity.guaranteeMisses || 0);
  if (guaranteeMisses <= 0) return null;
  if (consecutiveMissCount(userState.records) < guaranteeMisses) return null;

  const prize = config.prizes.find((item) => item.id === config.activity.guaranteePrizeId);
  if (!prize || !isPrizeAvailableForUser(prize, userState)) return null;

  return prize;
}

function isPrizeDrawableForUser(prize, userState) {
  return isPrizeAvailableForUser(prize, userState) && prize.weight > 0;
}

function isPrizeAvailableForUser(prize, userState) {
  return prize.enabled && hasStock(prize) && (!prize.oncePerUser || !hasWonPrize(userState, prize.id));
}

function hasWonPrize(userState, prizeId) {
  return (userState.records || []).some((record) => record && record.prizeId === prizeId && record.won !== false);
}

function consecutiveMissCount(records) {
  let count = 0;
  for (const record of records || []) {
    if (record && record.won === false) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}

function now() {
  return new Date().toISOString();
}

function todayKey() {
  return dateKey(now());
}

function dateKey(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
}

function hasStock(prize) {
  return prize.stock === null || prize.stock === undefined || prize.stock > 0;
}

function normalizeRecordsForRedemption(records, existingCodes = new Set()) {
  return records.map((record) => {
    if (!record || record.won === false) return record;
    const nextRecord = { ...record };
    const normalizedCode = normalizeRedeemCode(nextRecord.redeemCode);
    if (normalizedCode && !existingCodes.has(normalizedCode)) {
      nextRecord.redeemCode = normalizedCode;
      existingCodes.add(normalizedCode);
    } else {
      Object.assign(nextRecord, createRedemptionFields(nextRecord.createdAt || now(), existingCodes));
    }
    if (!nextRecord.expiresAt) nextRecord.expiresAt = expiresAtFrom(nextRecord.createdAt || now());
    nextRecord.redeemStatus = inferRedeemStatus(nextRecord);
    return nextRecord;
  });
}

function createRedemptionFields(createdAt, existingCodes = new Set()) {
  const redeemCode = createRedeemCode(existingCodes);
  return {
    redeemCode,
    redeemStatus: 'pending',
    expiresAt: expiresAtFrom(createdAt)
  };
}

function createRedeemCode(existingCodes) {
  let code = '';
  do {
    const bytes = crypto.randomBytes(8);
    code = Array.from(bytes)
      .map((byte) => REDEEM_ALPHABET[byte % REDEEM_ALPHABET.length])
      .join('');
  } while (existingCodes.has(code));
  existingCodes.add(code);
  return code;
}

function expiresAtFrom(value) {
  const base = value ? new Date(value) : new Date();
  const time = Number.isNaN(base.getTime()) ? Date.now() : base.getTime();
  return new Date(time + REDEEM_EXPIRE_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function inferRedeemStatus(record) {
  if (record.redeemStatus === 'redeemed' || record.redeemStatus === 'void') return record.redeemStatus;
  const status = record.fulfillment && record.fulfillment.status;
  if (status === 'fulfilled') return 'redeemed';
  if (status === 'void') return 'void';
  if (record.redeemedAt) return 'redeemed';
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return 'expired';
  if (record.redeemStatus === 'expired') return 'expired';
  return 'pending';
}

function normalizeRedeemCode(value) {
  return String(value || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

function collectRedeemCodes(usersState) {
  const codes = new Set();
  for (const userState of Object.values(usersState || {})) {
    for (const record of Array.isArray(userState && userState.records) ? userState.records : []) {
      const code = normalizeRedeemCode(record && record.redeemCode);
      if (code) codes.add(code);
    }
  }
  return codes;
}

function collectRedeemCodesExcept(usersState, excludedUid) {
  const codes = new Set();
  for (const [uid, userState] of Object.entries(usersState || {})) {
    if (String(uid) === String(excludedUid)) continue;
    for (const record of Array.isArray(userState && userState.records) ? userState.records : []) {
      const code = normalizeRedeemCode(record && record.redeemCode);
      if (code) codes.add(code);
    }
  }
  return codes;
}

function normalizeInteger(value, fallback, min) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.floor(number));
}

function normalizeStock(value, fallback) {
  if (value === null) return null;
  if (value === '' || value === undefined) return fallback === undefined ? null : fallback;
  return normalizeInteger(value, fallback === undefined ? null : fallback, 0);
}

function normalizePrizeId(value, fallback) {
  const id = String(value || '').trim();
  return PRIZES.some((prize) => prize.id === id) ? id : fallback;
}

async function getNicknamesByUid(uids) {
  const numericUids = Array.from(new Set(
    uids
      .map((uid) => Number(uid))
      .filter((uid) => Number.isInteger(uid) && uid > 0)
  ));
  if (!numericUids.length) return {};

  try {
    const [rows] = await getPool().query(
      `SELECT uid, nickname FROM ${legacyTable('user')} WHERE uid IN (?)`,
      [numericUids]
    );
    return Object.fromEntries(
      rows.map((row) => [String(row.uid), cleanText(row.nickname, '')]).filter(([, nickname]) => nickname)
    );
  } catch (error) {
    console.warn('[newcomer-lottery] nickname lookup failed', error && error.code ? error.code : error.message);
    return {};
  }
}

function fallbackNickname(uid) {
  const value = String(uid || '');
  if (!value) return '用户';
  if (value.length <= 4) return `用户${value}`;
  return `用户${value.slice(0, 2)}***${value.slice(-2)}`;
}

function cleanText(value, fallback) {
  const text = String(value === undefined || value === null ? '' : value).trim();
  return text || fallback;
}

module.exports = { NewcomerLotteryService, TASKS, PRIZES, DEFAULT_CONFIG };
