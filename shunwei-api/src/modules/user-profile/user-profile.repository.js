const { getPool, legacyTable } = require('../../shared/mysql');

class UserProfileRepository {
  constructor() {
    this.extReady = false;
  }

  async ensureExtensionTable() {
    if (this.extReady) return;

    await getPool().query(`
      CREATE TABLE IF NOT EXISTS ${legacyTable('user_profile_ext')} (
        uid INT UNSIGNED NOT NULL,
        purchased_model VARCHAR(120) NOT NULL DEFAULT '',
        created_at INT UNSIGNED NOT NULL DEFAULT 0,
        updated_at INT UNSIGNED NOT NULL DEFAULT 0,
        PRIMARY KEY (uid)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Shunwei user profile extension'
    `);
    this.extReady = true;
  }

  async getByUid(uid) {
    await this.ensureExtensionTable();

    const [rows] = await getPool().query(
      `
      SELECT
        u.uid,
        u.nickname,
        u.avatar,
        u.phone,
        u.birthday,
        COALESCE(ext.purchased_model, '') AS purchased_model
      FROM ${legacyTable('user')} u
      LEFT JOIN ${legacyTable('user_profile_ext')} ext ON ext.uid = u.uid
      WHERE u.uid = ? AND COALESCE(u.is_del, 0) = 0
      LIMIT 1
      `,
      [uid]
    );

    return rows[0] || null;
  }

  async updateByUid(uid, input) {
    await this.ensureExtensionTable();

    const now = Math.floor(Date.now() / 1000);
    const birthday = dateToTimestamp(input.birthday);
    const purchasedModel = String(input.purchasedModel || '').trim();

    const connection = await getPool().getConnection();
    try {
      await connection.beginTransaction();
      const [userResult] = await connection.query(
        `UPDATE ${legacyTable('user')} SET birthday = ? WHERE uid = ? AND COALESCE(is_del, 0) = 0`,
        [birthday, uid]
      );

      if (!userResult.affectedRows) {
        const error = new Error('用户不存在');
        error.statusCode = 404;
        throw error;
      }

      await connection.query(
        `
        INSERT INTO ${legacyTable('user_profile_ext')} (uid, purchased_model, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE purchased_model = VALUES(purchased_model), updated_at = VALUES(updated_at)
        `,
        [uid, purchasedModel, now, now]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    return this.getByUid(uid);
  }
}

function dateToTimestamp(value) {
  const input = String(value || '').trim();
  if (!input) return 0;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const error = new Error('生日格式应为 YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  const date = new Date(`${input}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) {
    const error = new Error('生日格式应为 YYYY-MM-DD');
    error.statusCode = 400;
    throw error;
  }

  return Math.floor(date.getTime() / 1000);
}

function timestampToDate(value) {
  const timestamp = Number(value || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(timestamp * 1000)).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function toUserProfile(row) {
  return {
    uid: row.uid,
    nickname: row.nickname || '',
    avatar: row.avatar || '',
    phone: row.phone || '',
    birthday: timestampToDate(row.birthday),
    birthdayTimestamp: Number(row.birthday || 0),
    purchasedModel: row.purchased_model || ''
  };
}

module.exports = {
  UserProfileRepository,
  dateToTimestamp,
  timestampToDate,
  toUserProfile
};
