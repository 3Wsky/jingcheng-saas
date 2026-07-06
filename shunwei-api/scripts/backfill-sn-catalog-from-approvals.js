/**
 * Backfill SN catalog from historical approval receipts.
 *
 * Why this exists:
 * - Sold devices disappear from the latest ERP/Guanjiapo export.
 * - Historical approval receipts may still need to show "matched in SN catalog".
 * - Pending historical approvals may need their IMEI/SN to exist in sw_sn_catalog for manual review display.
 *
 * Usage:
 *   node scripts/backfill-sn-catalog-from-approvals.js
 *   node scripts/backfill-sn-catalog-from-approvals.js --run
 *   node scripts/backfill-sn-catalog-from-approvals.js --before=2026-07-06 --status=approved,admin_review
 *
 * Defaults:
 * - dry-run only; add --run to write.
 * - scans approval receipts created before today's 00:00:00 in Asia/Shanghai.
 * - scans approved/admin_review/manager_review consumption approval requests.
 * - only inserts codes that are currently missing from sw_sn_catalog.
 * - writes only IMEI1/SN + model. Brand, price, and remark are intentionally left blank/default.
 * - on --run, also backfills approved codes into sw_approval_code_usage, idempotently.
 */
const { getPool } = require('../src/shared/mysql');
const { swTable } = require('../src/shared/sw-mysql');
const { SnCatalogService } = require('../src/modules/admin/sn-catalog.service');
const { ApprovalCodeUsageService } = require('../src/modules/approval/approval-code-usage.service');

const PRODUCT_TYPES = ['手机', '平板', '电脑', '智能穿戴', '大疆', '无人机', '其他'];

function parseArgs(argv) {
  const out = {
    run: false,
    before: todayInShanghai(),
    since: '',
    statuses: ['approved', 'admin_review', 'manager_review'],
    limit: 0,
    updateExisting: false,
    skipCodeUsage: false
  };

  for (const arg of argv) {
    if (arg === '--run') out.run = true;
    else if (arg === '--update-existing') out.updateExisting = true;
    else if (arg === '--skip-code-usage') out.skipCodeUsage = true;
    else if (arg.startsWith('--before=')) out.before = arg.slice('--before='.length);
    else if (arg.startsWith('--since=')) out.since = arg.slice('--since='.length);
    else if (arg.startsWith('--status=')) {
      out.statuses = arg.slice('--status='.length).split(',').map((x) => x.trim()).filter(Boolean);
    } else if (arg.startsWith('--limit=')) {
      out.limit = Math.max(0, Number(arg.slice('--limit='.length)) || 0);
    }
  }

  assertDate(out.before, '--before');
  if (out.since) assertDate(out.since, '--since');
  if (!out.statuses.length) throw new Error('--status must not be empty');
  return out;
}

function todayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function assertDate(value, name) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    throw new Error(`${name} must be YYYY-MM-DD`);
  }
}

function shanghaiDayStartUnix(date) {
  return Math.floor(Date.parse(`${date}T00:00:00+08:00`) / 1000);
}

function parsePrice(seg) {
  const m = String(seg || '').match(/[¥￥]\s*([0-9]+(?:\.[0-9]+)?)/);
  return m ? Math.round(Number(m[1]) * 100) / 100 : 0;
}

function parseReceiptProducts(receiptNo) {
  const s = String(receiptNo || '').trim();
  if (!s) return [];

  const parts = s.includes('[产品') ? s.split(/;\s*(?=\[产品)/) : [s];
  const products = [];

  for (const part of parts) {
    const bodyMatch = part.match(/\[产品\s*(\d+)\]\s*(.+)$/);
    const body = bodyMatch ? bodyMatch[2] : part;
    const index = bodyMatch ? Number(bodyMatch[1]) || products.length + 1 : products.length + 1;
    const segments = body.split('/').map((x) => x.trim()).filter(Boolean);
    const item = {
      index,
      type: '',
      model: '',
      price: 0,
      imei: '',
      sn: '',
      codeType: '',
      code: ''
    };
    const modelParts = [];

    for (const seg of segments) {
      if (PRODUCT_TYPES.includes(seg)) {
        item.type = seg;
      } else if (/^IMEI\s*\d?\s*[:：]/i.test(seg)) {
        item.imei = seg.replace(/^IMEI\s*\d?\s*[:：]\s*/i, '').trim();
        item.codeType = item.codeType || 'imei1';
        item.code = item.code || item.imei;
      } else if (/^SN\s*[:：]/i.test(seg)) {
        item.sn = seg.replace(/^SN\s*[:：]\s*/i, '').trim();
        item.codeType = item.codeType || 'sn';
        item.code = item.code || item.sn;
      } else if (parsePrice(seg) > 0) {
        item.price = parsePrice(seg);
      } else {
        modelParts.push(seg);
      }
    }

    item.model = modelParts.join(' ').trim();
    if (!item.code && item.imei) { item.codeType = 'imei1'; item.code = item.imei; }
    if (!item.code && item.sn) { item.codeType = 'sn'; item.code = item.sn; }
    products.push(item);
  }

  return products;
}

function normalizeModel(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function modelTokens(value) {
  return String(value || '')
    .toUpperCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function inferBrand(model) {
  const t = String(model || '').toLowerCase();
  if (/iphone|ipad|apple|苹果/.test(t)) return 'Apple';
  if (/华为|huawei|mate|pura|nova|畅享|麦芒/.test(t)) return '华为';
  if (/荣耀|honor/.test(t)) return '荣耀';
  if (/vivo|iqoo/.test(t)) return 'vivo';
  if (/oppo|oneplus|一加|realme/.test(t)) return 'OPPO';
  if (/小米|redmi|xiaomi/.test(t)) return '小米';
  if (/三星|samsung/.test(t)) return '三星';
  if (/大疆|dji|osmo|mavic/.test(t)) return 'DJI';
  return '';
}

function completeModel(inputModel, price, candidates) {
  const raw = String(inputModel || '').trim();
  const norm = normalizeModel(raw);
  if (!norm || norm.length < 2) {
    return { model: raw, brand: inferBrand(raw), source: 'original', confidence: 0 };
  }

  const tokens = modelTokens(raw);
  const inputBrand = inferBrand(raw);
  const scored = [];

  for (const c of candidates) {
    const candidateNorm = c.norm;
    if (!candidateNorm || candidateNorm === norm) continue;
    if (!candidateNorm.includes(norm)) {
      const tokenHit = tokens.length && tokens.every((t) => candidateNorm.includes(normalizeModel(t)));
      if (!tokenHit) continue;
    }

    let score = 0;
    if (candidateNorm.includes(norm)) score += Math.min(24, norm.length * 3);
    if (tokens.length) score += tokens.filter((t) => candidateNorm.includes(normalizeModel(t))).length * 8;
    if (inputBrand && inferBrand(c.model) === inputBrand) score += 12;
    if (price > 0 && c.price > 0) {
      const diff = Math.abs(c.price - price);
      const ratio = diff / Math.max(c.price, price);
      if (ratio <= 0.02) score += 20;
      else if (ratio <= 0.05) score += 12;
      else if (ratio <= 0.1) score += 6;
      else score -= Math.min(12, Math.floor(ratio * 20));
    }
    score += Math.min(8, Number(c.count || 0));
    scored.push({ ...c, score });
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  const second = scored[1];
  const uniqueHighConfidence = best && best.score >= 24 && (!second || best.score - second.score >= 8);
  const onlyOneCandidate = scored.length === 1 && best.score >= 18;

  if (uniqueHighConfidence || onlyOneCandidate) {
    return {
      model: best.model,
      brand: best.brand || inferBrand(best.model),
      source: 'completed',
      confidence: best.score,
      from: raw
    };
  }

  return { model: raw, brand: inputBrand, source: scored.length ? 'ambiguous' : 'original', confidence: best?.score || 0 };
}

async function loadModelCandidates(pool) {
  const [rows] = await pool.query(
    `SELECT COALESCE(NULLIF(TRIM(brand), ''), '') AS brand,
            TRIM(model) AS model,
            ROUND(price, 2) AS price,
            COUNT(*) AS count
     FROM ${swTable('sn_catalog')}
     WHERE TRIM(model) <> ''
     GROUP BY brand, model, price
     ORDER BY count DESC
     LIMIT 30000`
  );

  return rows.map((r) => ({
    brand: r.brand || '',
    model: r.model || '',
    price: Number(r.price || 0),
    count: Number(r.count || 0),
    norm: normalizeModel(r.model)
  }));
}

async function fetchApprovalRows(pool, options) {
  const conditions = [
    "biz_type = 'consumption_grant'",
    'receipt_no <> ""',
    'created_at < ?'
  ];
  const values = [shanghaiDayStartUnix(options.before)];

  if (options.since) {
    conditions.push('created_at >= ?');
    values.push(shanghaiDayStartUnix(options.since));
  }
  conditions.push('status IN (?)');
  values.push(options.statuses);

  const limitSql = options.limit > 0 ? ' LIMIT ?' : '';
  if (options.limit > 0) values.push(options.limit);

  const [rows] = await pool.query(
    `SELECT id, request_no, status, receipt_no, created_at
     FROM ${swTable('approval_request')}
     WHERE ${conditions.join(' AND ')}
     ORDER BY id ASC${limitSql}`,
    values
  );
  return rows;
}

function toCatalogItem(product, completion) {
  let imei1 = product.imei || (product.codeType === 'imei1' ? product.code : '');
  let snCode = product.sn || (product.codeType === 'sn' ? product.code : '');

  // Staff sometimes puts a phone IMEI into the SN field. Store pure 15-digit codes
  // as IMEI1 so the catalog matches the same identity key as normal ERP imports.
  const snDigits = SnCatalogService.normalizeImei(snCode);
  if (!imei1 && snDigits.length === 15 && snDigits === SnCatalogService.normalizeSn(snCode)) {
    imei1 = snCode;
    snCode = '';
  }

  return {
    snCode,
    imei1,
    model: completion.model || product.model || ''
  };
}

function mergeCatalogItem(existing, next, requestId) {
  existing.sourceRequestIds.add(requestId);
  if (!existing.model || String(next.model || '').length > String(existing.model || '').length) existing.model = next.model;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const pool = getPool();
  const catalog = new SnCatalogService();
  const missingByKey = new Map();
  const examples = [];
  const completionStats = { completed: 0, ambiguous: 0, original: 0 };
  const stats = {
    approvals: 0,
    products: 0,
    noCode: 0,
    alreadyMatched: 0,
    missingCodes: 0,
    duplicateMissingCodes: 0
  };

  try {
    await catalog.ensureTable();
    const candidates = await loadModelCandidates(pool);
    const approvals = await fetchApprovalRows(pool, options);
    stats.approvals = approvals.length;

    for (const row of approvals) {
      const products = parseReceiptProducts(row.receipt_no || '');
      for (const p of products) {
        stats.products += 1;
        if (!p.code) { stats.noCode += 1; continue; }

        const hit = p.codeType === 'imei1'
          ? await catalog.lookupByCode({ imei: p.code })
          : await catalog.lookupByCode({ sn: p.code });
        if (hit && hit.found && !options.updateExisting) {
          stats.alreadyMatched += 1;
          continue;
        }

        const completion = completeModel(p.model, p.price, candidates);
        completionStats[completion.source] = (completionStats[completion.source] || 0) + 1;
        const item = toCatalogItem(p, completion);
        const key = SnCatalogService.buildMatchKey(
          SnCatalogService.normalizeImei(item.imei1),
          SnCatalogService.normalizeSn(item.snCode)
        );
        if (!key) { stats.noCode += 1; continue; }

        if (missingByKey.has(key)) {
          stats.duplicateMissingCodes += 1;
          mergeCatalogItem(missingByKey.get(key), item, Number(row.id));
        } else {
          stats.missingCodes += 1;
          item.sourceRequestIds = new Set([Number(row.id)]);
          missingByKey.set(key, item);
          if (examples.length < 30) {
            examples.push({
              requestId: row.id,
              requestNo: row.request_no,
              status: row.status,
              codeType: p.codeType,
              code: p.code,
              model: item.model,
              fromModel: completion.from || '',
              completion: completion.source
            });
          }
        }
      }
    }

    const items = [...missingByKey.values()].map(({ sourceRequestIds, ...item }) => item);

    console.log('================ SN catalog approval backfill ================');
    console.log(`Mode          : ${options.run ? 'RUN - will write database' : 'DRY RUN - no database writes'}`);
    console.log(`Date window   : ${options.since || '(beginning)'} <= created_at < ${options.before} Asia/Shanghai`);
    console.log(`Statuses      : ${options.statuses.join(', ')}`);
    console.log(`Approvals     : ${stats.approvals}`);
    console.log(`Products      : ${stats.products}`);
    console.log(`Already match : ${stats.alreadyMatched}`);
    console.log(`No code       : ${stats.noCode}`);
    console.log(`To backfill   : ${items.length}`);
    console.log(`Duplicates    : ${stats.duplicateMissingCodes}`);
    console.log(`Model complete: completed=${completionStats.completed || 0}, ambiguous=${completionStats.ambiguous || 0}, original=${completionStats.original || 0}`);

    if (examples.length) {
      console.log('\nExamples:');
      for (const e of examples) {
        const modelText = e.fromModel ? `${e.fromModel} -> ${e.model}` : e.model;
        console.log(`  #${e.requestId} ${e.status} ${e.codeType}:${e.code}  ${modelText || '(blank model)'}`);
      }
      if (items.length > examples.length) console.log(`  ... and ${items.length - examples.length} more`);
    }

    if (!options.run) {
      console.log('\nDry run only. Re-run with --run after checking the examples.');
      return;
    }

    const result = await catalog.bulkImport(items);
    console.log(`\n[written] sw_sn_catalog processed=${result.processed || 0}, skipped=${result.skipped || 0}, total=${result.total || 0}`);

    if (!options.skipCodeUsage) {
      const usage = new ApprovalCodeUsageService();
      const usageResult = await usage.backfillFromApproved();
      console.log(`[written] sw_approval_code_usage approvedScanned=${usageResult.approvedScanned}, codesInserted=${usageResult.codesInserted}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Error:', err && err.stack ? err.stack : err.message);
  process.exit(1);
});
