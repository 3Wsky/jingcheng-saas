import fs from 'node:fs/promises';

const VMALL_SEARCH_URL = 'https://www.vmall.com/search?keyword=';
const VMALL_CSRF_URL = 'https://openapi.vmall.com/csrftoken.js';
const VMALL_QUERY_URL = 'https://openapi.vmall.com/mcp/v1/search/queryPrd';
const VMALL_DETAIL_URL = 'https://openapi.vmall.com/mcp/product/queryDisplayProductByVersion';
const VMALL_SBOM_URL = 'https://openapi.vmall.com/mcp/querySbomByCodes';
const VMALL_IMAGE_BASE = 'https://res.vmallres.com/pimages';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const EXCLUDED_WORDS = ['保护壳', '保护套', '手机壳', '手机套', '钢化膜', '保护膜', '充电器', '耳机', '移动电源', '支架', '配件', '翻新', '官翻', '二手'];

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.models || !args.out) {
    throw new Error('Usage: node fzlsaas-scraper.mjs --models <file> --out <file>');
  }

  const models = (await fs.readFile(args.models, 'utf8'))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const delayMin = Number(args['delay-min-ms'] || 300);
  const delayMax = Number(args['delay-max-ms'] || 800);
  const client = new VmallClient();
  const products = [];
  const errors = [];

  for (const model of models) {
    try {
      const rows = await client.searchProducts(model);
      const mapped = [];
      for (const row of pickProducts(model, rows)) {
        mapped.push(await client.mapProduct(model, row));
      }
      products.push(...(mapped.length ? mapped : [makeDraftProduct(model, '官网未返回匹配商品，已生成待补全商品')]));
    } catch (error) {
      errors.push({ model, message: error.message });
      products.push(makeDraftProduct(model, `官网采集受限，已生成待补全商品：${error.message}`));
    }
    await sleep(randomInt(delayMin, delayMax));
  }

  await fs.writeFile(args.out, JSON.stringify({ products, errors, scrapedAt: new Date().toISOString() }, null, 2), 'utf8');
}

class VmallClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = '';
  }

  async searchProducts(keyword) {
    await this.ensureSession(keyword);
    const body = {
      keyword,
      pageNum: '1',
      pageSize: '12',
      searchSortField: '0',
      searchSortType: 'desc',
      searchFlag: '0',
      portal: '3',
      lang: 'zh_CN',
      country: 'CN',
      version: '1'
    };
    const res = await fetch(VMALL_QUERY_URL, {
      method: 'POST',
      headers: this.headers({
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
        origin: 'https://www.vmall.com',
        referer: VMALL_SEARCH_URL + encodeURIComponent(keyword),
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        CsrfToken: this.csrfToken
      }),
      body: JSON.stringify(body)
    });
    this.storeCookies(res.headers);
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`华为商城返回非 JSON：HTTP ${res.status}`);
    }
    if (!res.ok || data.success === false) {
      throw new Error(data.info || data.msg || `华为商城查询失败：HTTP ${res.status}`);
    }
    return Array.isArray(data.resultList) ? data.resultList : [];
  }

  async mapProduct(keyword, row) {
    let detail = null;
    let sboms = [];
    try {
      detail = await this.queryProductDetail(row);
      const codes = extractSbomCodes(detail);
      if (codes.length) sboms = await this.querySboms(codes);
    } catch (error) {
      console.warn(`SKU detail fallback for ${keyword}: ${error.message}`);
    }
    return mapVmallProduct(keyword, row, detail, sboms);
  }

  async queryProductDetail(row) {
    const data = await this.getJson(VMALL_DETAIL_URL, {
      prdId: String(row.productId || ''),
      sbomCode: String(row.skuCode || ''),
      portal: '1',
      lang: 'zh_CN',
      country: 'CN',
      version: '1'
    }, row);
    if (data.code !== '0' || !data.displayPrdVo) {
      throw new Error(data.info || data.msg || '商品详情接口无有效数据');
    }
    return data.displayPrdVo;
  }

  async querySboms(codes) {
    const data = await this.getJson(VMALL_SBOM_URL, {
      sbomCodes: JSON.stringify(codes),
      portal: '1',
      lang: 'zh_CN',
      country: 'CN',
      version: '1'
    });
    if (data.code !== '0' || !Array.isArray(data.sbomList)) {
      throw new Error(data.info || data.msg || 'SKU 接口无有效数据');
    }
    const byCode = new Map(data.sbomList.map((item) => [String(item.sbomCode || ''), item]));
    return codes.map((code) => byCode.get(String(code))).filter(Boolean);
  }

  async getJson(url, params, row = null) {
    await this.ensureSession(params.keyword || row?.name || '');
    const requestUrl = new URL(url);
    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined && value !== null && value !== '') requestUrl.searchParams.set(key, value);
    }
    const res = await fetch(requestUrl, {
      headers: this.headers({
        accept: 'application/json, text/plain, */*',
        referer: row
          ? `https://item.vmall.com/product/comdetail/index.html?prdId=${encodeURIComponent(row.productId || '')}&sbomCode=${encodeURIComponent(row.skuCode || '')}`
          : 'https://item.vmall.com/product/comdetail/index.html',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        CsrfToken: this.csrfToken,
        'x-requested-with': 'XMLHttpRequest'
      })
    });
    this.storeCookies(res.headers);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`华为商城返回非 JSON：HTTP ${res.status}`);
    }
  }

  async ensureSession(keyword) {
    if (!this.csrfToken) {
      const home = await fetch(VMALL_SEARCH_URL + encodeURIComponent(keyword), {
        headers: this.headers({ accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' })
      });
      this.storeCookies(home.headers);
      await home.text();
    }

    if (!this.csrfToken) {
      const csrf = await fetch(`${VMALL_CSRF_URL}?t=${Date.now()}`, {
        headers: this.headers({ accept: '*/*', referer: 'https://www.vmall.com/' })
      });
      this.storeCookies(csrf.headers);
      const js = await csrf.text();
      const token = js.match(/csrftoken\s*=\s"([a-zA-Z0-9-]+)"/)?.[1] || this.cookies.get('CSRF-TOKEN') || '';
      if (!token) throw new Error('未获取到华为商城 CSRF token');
      this.csrfToken = token;
      this.cookies.set('CSRF-TOKEN', token);
    }
  }

  headers(extra = {}) {
    return {
      'user-agent': USER_AGENT,
      'accept-language': 'zh-CN,zh;q=0.9',
      cookie: this.cookieHeader(),
      ...extra
    };
  }

  cookieHeader() {
    return Array.from(this.cookies.entries()).map(([key, value]) => `${key}=${value}`).join('; ');
  }

  storeCookies(headers) {
    for (const [key, value] of headers) {
      if (key.toLowerCase() !== 'set-cookie') continue;
      for (const cookie of splitSetCookie(value)) {
        const index = cookie.indexOf('=');
        if (index <= 0) continue;
        const name = cookie.slice(0, index).trim();
        const cookieValue = cookie.slice(index + 1).trim();
        if (name) this.cookies.set(name, cookieValue);
      }
    }
  }
}

function pickProducts(model, rows) {
  const targets = Array.from(new Set([
    normalize(model),
    normalize(String(model).replace(/高配\/套装|高配|套装/g, '').trim())
  ])).filter(Boolean);
  const candidates = rows
    .filter((row) => String(row.carrierCode || '').includes('HUAWEIDEVICE') || !row.carrierCode)
    .filter((row) => !isAccessory(row))
    .map((row) => ({ row, score: Math.max(...targets.map((target) => matchScore(target, row))) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || Number(a.row.price || 0) - Number(b.row.price || 0));

  return candidates.length ? [candidates[0].row] : [];
}

function matchScore(target, row) {
  const names = [row.name, row.briefName, row.skuName].map(normalize).filter(Boolean);
  if (!target || !names.length) return 0;
  if (names.some((name) => name === target)) return 8;
  if (names.some((name) => name.includes(target))) return 7;
  const tokens = target.split(/(?=[a-z]+)|\s+/i).filter((token) => token.length > 1);
  const joined = names.join(' ');
  const matched = tokens.filter((token) => joined.includes(token)).length;
  return matched >= Math.max(1, Math.ceil(tokens.length * 0.75)) ? 3 + matched : 0;
}

function isAccessory(row) {
  const name = `${row.name || ''} ${row.briefName || ''} ${row.skuName || ''}`;
  return EXCLUDED_WORDS.some((word) => name.includes(word));
}

function mapVmallProduct(keyword, row, detail = null, sboms = []) {
  const normalizedSboms = normalizeSboms(sboms);
  const price = minPositive(normalizedSboms.map((item) => item.priceValue))
    || Number(row.promoPriceAccurate ?? row.promoPrice ?? row.priceAccurate ?? row.price ?? row.estPrice ?? 0)
    || 0;
  const image = normalizedSboms.find((item) => item.image)?.image || buildImageUrl(row);
  const storeName = clean(detail?.name || row.name || row.briefName || row.skuName || keyword);
  const skuName = clean(row.skuName || storeName);
  const sliderImages = unique([image, ...normalizedSboms.map((item) => item.image)]).filter(Boolean);
  const colorItems = buildColorItems(normalizedSboms);
  return {
    productKey: `vmall:${row.productId || sourceKey(storeName)}`,
    brand: inferBrand(storeName || keyword),
    model: clean(detail?.briefName || row.briefName || keyword),
    storeName,
    storeInfo: clean(row.promotionInfo || detail?.wapSalePoint || detail?.webSalePoint || row.displayTags || '华为商城官方商品'),
    keyword,
    price,
    image,
    sliderImages,
    skuPrices: normalizedSboms.length ? normalizedSboms : [{
      version: skuName,
      price: price ? `¥${price}` : '',
      priceValue: price,
      sbomCode: String(row.skuCode || ''),
      config: '',
      color: extractColor(skuName),
      colors: [extractColor(skuName)].filter(Boolean),
      image
    }],
    colors: unique(normalizedSboms.map((item) => item.color).filter(Boolean)),
    colorItems,
    detailImages: buildDetailImages(detail),
    specs: buildSpecs(detail),
    paramsList: buildParams(row),
    description: clean(row.promotionInfo || detail?.seoDescription || ''),
    specType: normalizedSboms.length > 1 ? 1 : 0,
    scrapedAt: new Date().toISOString()
  };
}

function extractSbomCodes(detail) {
  const codes = [];
  for (const item of detail?.sbomList || []) addCode(codes, item.sbomCode);
  for (const item of detail?.sbomListForLazy || []) addCode(codes, item.sbomCode);
  for (const attr of detail?.attrViewList || []) {
    for (const value of attr.attrValueList || []) {
      for (const sbom of value.sbomList || []) addCode(codes, sbom.sbomCode);
    }
  }
  return codes;
}

function addCode(codes, code) {
  const value = String(code || '').trim();
  if (value && !codes.includes(value)) codes.push(value);
}

function normalizeSboms(sboms) {
  return (sboms || []).map((sbom) => {
    const attrs = Array.isArray(sbom.gbomAttrList) ? sbom.gbomAttrList : [];
    const color = clean((attrs.find((item) => isColorAttr(item.attrName)) || {}).attrValue || '');
    const config = attrs
      .filter((item) => !isColorAttr(item.attrName))
      .map((item) => clean(item.attrValue))
      .filter(Boolean)
      .join(' ');
    const priceValue = Number(sbom.promoPrice ?? sbom.promotionPrice ?? sbom.price ?? sbom.purchasePrice ?? 0) || 0;
    const version = [config, color].filter(Boolean).join(' ') || clean(sbom.sbomName || sbom.sbomAbbr || '');
    return {
      version,
      config,
      color,
      price: priceValue ? `¥${priceValue}` : '',
      priceValue,
      sbomCode: String(sbom.sbomCode || ''),
      colors: color ? [color] : [],
      image: buildImageUrl(sbom)
    };
  }).filter((item) => item.sbomCode || item.version);
}

function isColorAttr(name) {
  return /颜色|色$|款式|表款|表带/i.test(String(name || ''));
}

function buildColorItems(skus) {
  const byColor = new Map();
  for (const sku of skus || []) {
    if (!sku.color || byColor.has(sku.color)) continue;
    byColor.set(sku.color, { name: sku.color, image: sku.image || '', sbomCode: sku.sbomCode || '' });
  }
  return Array.from(byColor.values());
}

function buildDetailImages(detail) {
  const images = [];
  // 手机、电脑、平板的详情接口字段不完全一致。详情图必须用原图地址，
  // 不能复用 SKU 图的 428×428 缩略图规则，否则电脑长图会被错误降级。
  const lists = [
    detail?.functionPhotoList,
    detail?.gbomAttrDisplayList,
    detail?.detailPhotoList,
    detail?.detailImageList,
    detail?.productDetailImageList,
    detail?.webDetailPhotoList,
    detail?.descriptionImageList
  ];
  for (const list of lists) {
    for (const item of Array.isArray(list) ? list : []) {
      if (item.photoPath || item.photoName) images.push(buildDetailImageUrl(item));
      if (item.imageUrl) images.push(item.imageUrl);
      if (item.imgUrl) images.push(item.imgUrl);
    }
  }
  return unique(images).filter(Boolean);
}

function buildDetailImageUrl(item) {
  if (item.imageUrl && /^https?:\/\//i.test(item.imageUrl)) return item.imageUrl;
  if (item.imgUrl && /^https?:\/\//i.test(item.imgUrl)) return item.imgUrl;
  if (!item.photoPath || !item.photoName) return '';
  const path = String(item.photoPath).replace(/^\/+/, '');
  return `${VMALL_IMAGE_BASE}/${path}${item.photoName}`;
}

function buildSpecs(detail) {
  const specs = {};
  for (const item of detail?.pivotalAttrList || []) {
    const name = clean(item.attrName || item.name);
    const value = clean(item.attrValue || item.value);
    if (name && value) specs[name] = value;
  }
  return specs;
}

function makeDraftProduct(model, reason) {
  return {
    productKey: `vmall-draft:${sourceKey(model)}`,
    brand: inferBrand(model),
    model: clean(model),
    storeName: normalizeStoreName(model),
    storeInfo: reason,
    keyword: model,
    price: 0,
    image: '',
    sliderImages: [],
    skuPrices: [],
    colors: [],
    colorItems: [],
    detailImages: [],
    specs: {},
    paramsList: [],
    description: reason,
    specType: 0,
    scrapedAt: new Date().toISOString()
  };
}

function buildImageUrl(row) {
  if (row.imageUrl && /^https?:\/\//i.test(row.imageUrl)) return row.imageUrl;
  if (row.imgUrl && /^https?:\/\//i.test(row.imgUrl)) return row.imgUrl;
  if (!row.photoPath || !row.photoName) return '';
  const path = String(row.photoPath).replace(/^\/+/, '');
  return `${VMALL_IMAGE_BASE}/${path}428_428_${row.photoName}`;
}

function minPositive(values) {
  const candidates = values.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return candidates.length ? Math.min(...candidates) : 0;
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function buildParams(row) {
  const params = [];
  if (row.goodRate) params.push({ name: '好评率', value: `${row.goodRate}%`, sort: 10, status: true });
  if (row.rateCount) params.push({ name: '评价数', value: String(row.rateCount), sort: 20, status: true });
  if (row.skuCount) params.push({ name: 'SKU 数量', value: String(row.skuCount), sort: 30, status: true });
  return params;
}

function inferBrand(text) {
  const value = String(text || '').trim();
  if (/华为|HUAWEI|Mate|Pura|nova|WATCH|MatePad|MateBook/i.test(value)) return '华为';
  if (/DJI|大疆/i.test(value)) return 'DJI';
  return '';
}

function normalizeStoreName(model) {
  const name = clean(model);
  return /^HUAWEI\b/i.test(name) || /华为/.test(name) ? name : `HUAWEI ${name}`;
}

function extractColor(skuName) {
  const text = clean(skuName);
  const parts = text.split(/\s+/);
  return parts.length >= 2 ? parts[parts.length - 1] : '';
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalize(value) {
  return clean(value).toLowerCase().replace(/华为|huawei/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function sourceKey(value) {
  return normalize(value).replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 80) || 'unknown';
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    args[key.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
  }
  return args;
}

function splitSetCookie(value) {
  const result = [];
  const regex = /(?:^|,\s*)([A-Za-z0-9_-]+=[^;,]*)/g;
  let match;
  while ((match = regex.exec(value || ''))) result.push(match[1]);
  return result;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function randomInt(min, max) {
  const low = Math.max(0, Math.min(min, max));
  const high = Math.max(low, Math.max(min, max));
  return low + Math.floor(Math.random() * (high - low + 1));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
