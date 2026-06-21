const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { nanoid } = require('nanoid');
const { config } = require('../../shared/config');
const { getPool } = require('../../shared/mysql');
const { ProductsRepository } = require('./products.repository');
const {
  fetchCrmebProducts,
  normalizeBrand: helperNormalizeBrand,
  absImage,
  cleanText: helperCleanText
} = require('../admin/product-collect.helper');

const PRICE_TAG_FILES = [
  { fileName: 'products.json', type: 'phone' },
  { fileName: 'dji-products.json', type: 'dji' }
];

const SPEC_LABELS = {
  chip: '处理器',
  battery: '电池容量',
  screen: '屏幕尺寸',
  charge: '快充功率',
  refreshRate: '刷新率',
  screenTech: '屏幕技术',
  camera: '影像系统',
  video: '视频能力',
  safety: '安全能力',
  transmission: '图传',
  endurance: '续航',
  weight: '重量'
};

class ProductsService {
  constructor(repository = new ProductsRepository()) {
    this.repository = repository;
  }

  async listPublicProducts(query = {}) {
    const state = await this.repository.readAll();
    const products = applyProductFilters(state.products, { ...query, status: 'shown' });
    return {
      list: products.map(toPublicProduct),
      total: products.length
    };
  }

  async getPublicProduct(id) {
    const state = await this.repository.readAll();
    const product = state.products.find((item) => String(item.id) === String(id) && item.isShow);
    return product ? toPublicProduct(product) : null;
  }

  async listAdminProducts(query = {}) {
    const state = await this.repository.readAll();
    const products = applyProductFilters(state.products, query);
    return {
      summary: buildSummary(state.products, state.imports),
      list: products.map(toAdminProduct),
      total: products.length
    };
  }

  async updateProductShow(id, isShow) {
    let updatedProduct = null;
    await this.repository.updateAll((state) => {
      const product = state.products.find((item) => String(item.id) === String(id));
      if (!product) {
        const error = new Error('商品不存在');
        error.statusCode = 404;
        throw error;
      }

      product.isShow = Boolean(isShow);
      product.updatedAt = now();
      updatedProduct = product;
      return state;
    });

    return toAdminProduct(updatedProduct);
  }

  async updateProduct(id, input) {
    let updatedProduct = null;
    await this.repository.updateAll((state) => {
      const product = state.products.find((item) => String(item.id) === String(id));
      if (!product) {
        const error = new Error('商品不存在');
        error.statusCode = 404;
        throw error;
      }

      Object.assign(product, normalizeEditableFields(product, input));
      product.updatedAt = now();
      updatedProduct = product;
      return state;
    });

    return toAdminProduct(updatedProduct);
  }

  async batchUpdateShow(ids, isShow) {
    const idSet = new Set((ids || []).map((id) => String(id)));
    let updatedCount = 0;

    await this.repository.updateAll((state) => {
      state.products = state.products.map((product) => {
        if (!idSet.has(String(product.id))) return product;
        updatedCount += 1;
        return {
          ...product,
          isShow: Boolean(isShow),
          updatedAt: now()
        };
      });
      return state;
    });

    return { updatedCount };
  }

  async reorderProducts(ids) {
    const idOrder = (ids || []).map((id) => String(id)).filter(Boolean);
    if (!idOrder.length) {
      const error = new Error('排序列表不能为空');
      error.statusCode = 400;
      throw error;
    }

    let updatedCount = 0;
    await this.repository.updateAll((state) => {
      const byId = new Map(state.products.map((product) => [String(product.id), product]));
      const maxSort = idOrder.length;
      for (let index = 0; index < idOrder.length; index += 1) {
        const product = byId.get(idOrder[index]);
        if (!product) continue;
        product.sort = maxSort - index;
        product.updatedAt = now();
        updatedCount += 1;
      }
      state.products.sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0) || String(a.storeName).localeCompare(String(b.storeName), 'zh-CN'));
      return state;
    });

    return { updatedCount };
  }

  async importFromPriceTags(options = {}) {
    const dataDir = path.resolve(options.dataDir || config.priceTag.dataDir);
    const brandSet = Array.isArray(options.brands) && options.brands.length
      ? new Set(options.brands.map((b) => String(b).trim()).filter(Boolean))
      : null;
    const sourceSet = Array.isArray(options.sources) && options.sources.length
      ? new Set(options.sources.map((s) => String(s).trim()).filter(Boolean))
      : null;
    const incomingProducts = [];
    const fileResults = [];

    for (const source of PRICE_TAG_FILES) {
      if (sourceSet && !sourceSet.has(source.type)) continue;
      const filePath = path.join(dataDir, source.fileName);
      const result = await readPriceTagFile(filePath, source);
      const filteredProducts = brandSet
        ? result.products.filter((product) => brandSet.has(product.brand))
        : result.products;
      fileResults.push({
        ...result.file,
        matchedCount: filteredProducts.length,
        filteredByBrand: Boolean(brandSet)
      });
      incomingProducts.push(...filteredProducts);
    }

    let importSummary = null;
    const importedAt = now();
    await this.repository.updateAll((state) => {
      const byKey = new Map(state.products.map((product) => [product.productKey, product]));
      let createdCount = 0;
      let updatedCount = 0;

      for (const incoming of incomingProducts) {
        const existing = byKey.get(incoming.productKey);
        if (existing) {
          Object.assign(existing, mergeImportedProduct(existing, incoming, importedAt));
          updatedCount += 1;
          continue;
        }

        const created = {
          ...incoming,
          id: nanoid(12),
          isShow: options.isShow !== undefined ? Boolean(options.isShow) : true,
          sort: Number.isFinite(Number(incoming.sort)) ? Number(incoming.sort) : 0,
          importedAt,
          createdAt: importedAt,
          updatedAt: importedAt
        };
        state.products.push(created);
        byKey.set(created.productKey, created);
        createdCount += 1;
      }

      state.products.sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0) || String(a.storeName).localeCompare(String(b.storeName), 'zh-CN'));
      const importRecord = {
        id: nanoid(10),
        source: 'digital-price-tag-generator',
        dataDir,
        brands: brandSet ? [...brandSet] : [],
        files: fileResults,
        total: incomingProducts.length,
        createdCount,
        updatedCount,
        skippedCount: fileResults.reduce((sum, item) => sum + (item.skippedCount || 0), 0),
        importedAt
      };
      state.imports = [importRecord].concat(state.imports || []).slice(0, 20);
      importSummary = {
        ...importRecord,
        summary: buildSummary(state.products, state.imports)
      };
      return state;
    });

    return importSummary;
  }

  async previewCollectBrands(options = {}) {
    const dataDir = path.resolve(options.dataDir || config.priceTag.dataDir);
    const sourceSet = Array.isArray(options.sources) && options.sources.length
      ? new Set(options.sources.map((s) => String(s).trim()).filter(Boolean))
      : null;
    const brandCounts = {};

    for (const source of PRICE_TAG_FILES) {
      if (sourceSet && !sourceSet.has(source.type)) continue;
      const filePath = path.join(dataDir, source.fileName);
      const result = await readPriceTagFile(filePath, source);
      for (const product of result.products) {
        const brand = product.brand || '未分类';
        brandCounts[brand] = (brandCounts[brand] || 0) + 1;
      }
    }

    const brandList = Object.entries(brandCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));

    return {
      brandList,
      total: brandList.reduce((sum, item) => sum + item.count, 0),
      sources: sourceSet ? [...sourceSet] : ['phone', 'dji']
    };
  }

  async importFromCrmeb(options = {}) {
    const pool = getPool();
    const ids = Array.isArray(options.ids) ? options.ids.map(Number).filter((n) => n > 0) : [];
    const rows = await fetchCrmebProducts(pool, ids);
    if (!rows.length) {
      const error = new Error(ids.length ? '未找到所选 CRMEB 商品' : 'CRMEB 在售商品为空');
      error.statusCode = 404;
      throw error;
    }

    const importedAt = now();
    let importSummary = null;

    await this.repository.updateAll((state) => {
      const byKey = new Map(state.products.map((product) => [product.productKey, product]));
      let createdCount = 0;
      let updatedCount = 0;
      const defaultShow = options.isShow !== undefined ? Boolean(options.isShow) : true;

      for (const row of rows) {
        const incoming = crmebRowToShowcaseProduct(row, importedAt, defaultShow);
        const existing = byKey.get(incoming.productKey);
        if (existing) {
          Object.assign(existing, mergeImportedProduct(existing, incoming, importedAt));
          updatedCount += 1;
          continue;
        }

        const created = {
          ...incoming,
          id: nanoid(12),
          isShow: defaultShow,
          createdAt: importedAt,
          updatedAt: importedAt,
          importedAt
        };
        state.products.push(created);
        byKey.set(created.productKey, created);
        createdCount += 1;
      }

      state.products.sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0) || String(a.storeName).localeCompare(String(b.storeName), 'zh-CN'));
      const importRecord = {
        id: nanoid(10),
        source: 'crmeb',
        sourceLabel: 'CRMEB商品库',
        ids: ids.length ? ids : undefined,
        total: rows.length,
        createdCount,
        updatedCount,
        skippedCount: 0,
        importedAt
      };
      state.imports = [importRecord].concat(state.imports || []).slice(0, 20);
      importSummary = {
        ...importRecord,
        summary: buildSummary(state.products, state.imports)
      };
      return state;
    });

    return importSummary;
  }
}

function crmebRowToShowcaseProduct(row, importedAt, defaultShow = true) {
  const brand = helperNormalizeBrand(row.storeName);
  const price = Math.max(0, Math.round(Number(row.price) || 0));
  const images = (row.sliderImages || []).map(absImage).filter(Boolean);
  const image = absImage(row.image) || images[0] || '';
  return {
    productKey: `crmeb:${row.crmebId}`,
    crmebId: row.crmebId,
    brand,
    model: helperCleanText(row.storeName),
    storeName: helperCleanText(row.storeName),
    storeInfo: helperCleanText(row.storeInfo) || `${brand} 正品`,
    keyword: helperCleanText(row.keyword) || helperCleanText(row.storeName),
    price,
    otPrice: 0,
    unitName: helperCleanText(row.unitName) || '台',
    image,
    sliderImages: images,
    recommendImage: '',
    isShow: defaultShow,
    isHot: false,
    isBest: false,
    isNew: false,
    sort: Number.isFinite(Number(row.sort)) ? Number(row.sort) : 0,
    specType: Number(row.specType || 0),
    attrs: [],
    skuPrices: [],
    colors: [],
    features: [],
    specs: {},
    paramsList: [],
    description: helperCleanText(row.description || row.storeInfo),
    source: 'crmeb',
    priceStatus: price > 0 ? 'available' : 'pending',
    scrapedAt: importedAt,
    raw: { sourceTable: 'eb_store_product', sourceId: row.crmebId }
  };
}

async function readPriceTagFile(filePath, source) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
    const products = [];
    let skippedCount = 0;

    for (const [key, value] of entries) {
      const product = normalizePriceTagProduct(key, value, source);
      if (product) {
        products.push(product);
      } else {
        skippedCount += 1;
      }
    }

    return {
      file: {
        fileName: source.fileName,
        status: 'ok',
        count: products.length,
        skippedCount
      },
      products
    };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return {
      file: {
        fileName: source.fileName,
        status: 'missing',
        count: 0,
        skippedCount: 0
      },
      products: []
    };
  }
}

function normalizePriceTagProduct(key, value, source) {
  if (!value || value.ok === false || !value.product || typeof value.product !== 'object') return null;
  return source.type === 'dji'
    ? normalizeDjiProduct(key, value)
    : normalizePhoneProduct(key, value);
}

function normalizePhoneProduct(key, value) {
  const raw = value.product || {};
  const title = cleanText(raw.title || key);
  if (!title) return null;
  const brand = normalizeBrand(raw.brand || key || title);
  const skuPrices = normalizeSkuPrices(raw.skuPrices);
  const price = normalizePrice(raw.price || (skuPrices[0] && skuPrices[0].price));
  const specs = normalizeSpecs(raw.specs);
  const features = normalizeTextArray(raw.features);

  return {
    productKey: `phone:${sourceKeyId(key || title)}`,
    brand,
    model: cleanModelName(title, brand),
    storeName: title,
    storeInfo: buildStoreInfo(brand, title, features, specs),
    keyword: [brand, title, cleanText(key)].filter(Boolean).join(','),
    price,
    otPrice: 0,
    unitName: '台',
    image: '',
    sliderImages: [],
    recommendImage: '',
    isShow: true,
    isHot: false,
    isBest: false,
    isNew: isRecent(value.fetchedAt),
    sort: brandSort(brand),
    specType: skuPrices.length > 1 ? 1 : 0,
    attrs: skuPrices,
    skuPrices,
    colors: normalizeTextArray(raw.colors),
    features,
    specs,
    paramsList: specsToParamsList(specs),
    description: normalizeDescription(raw.description, features, specs),
    sourceUrl: cleanText(raw.url || raw.fetchedFrom || ''),
    source: value.source || raw.source || 'official',
    priceStatus: raw.priceStatus || (price > 0 ? 'available' : 'pending'),
    scrapedAt: value.fetchedAt || raw.priceRefreshedAt || raw.fetchedAt || '',
    raw: {
      sourceFile: 'products.json',
      sourceKey: key
    }
  };
}

function normalizeDjiProduct(key, value) {
  const raw = value.product || {};
  const title = cleanText(raw.title || key);
  if (!title) return null;
  const bundles = normalizeBundles(raw.bundles);
  const skuPrices = bundles.map((bundle) => ({
    version: bundle.title,
    price: bundle.price,
    priceValue: bundle.priceValue,
    sbomCode: bundle.slug || '',
    colors: []
  }));
  const specs = normalizeSpecs(raw.specs);
  const features = normalizeTextArray(raw.highlights || raw.features);
  const price = normalizePrice(raw.price || (skuPrices[0] && skuPrices[0].price));

  return {
    productKey: `dji:${sourceKeyId(raw.slug || key || title)}`,
    brand: normalizeBrand(raw.brand || 'DJI'),
    model: cleanModelName(title, 'DJI'),
    storeName: title,
    storeInfo: buildStoreInfo('DJI', title, features, specs),
    keyword: ['DJI', title, cleanText(raw.slug || key)].filter(Boolean).join(','),
    price,
    otPrice: 0,
    unitName: '件',
    image: '',
    sliderImages: [],
    recommendImage: '',
    isShow: true,
    isHot: false,
    isBest: false,
    isNew: isRecent(value.fetchedAt),
    sort: brandSort('DJI'),
    specType: skuPrices.length > 1 ? 1 : 0,
    attrs: skuPrices,
    skuPrices,
    colors: [],
    bundles,
    features,
    specs,
    paramsList: specsToParamsList(specs),
    description: normalizeDescription(raw.description, features, specs),
    sourceUrl: cleanText(raw.url || raw.fetchedFrom || ''),
    source: value.source || 'dji',
    priceStatus: raw.priceStatus || (price > 0 ? 'available' : 'pending'),
    scrapedAt: value.fetchedAt || raw.fetchedAt || '',
    raw: {
      sourceFile: 'dji-products.json',
      sourceKey: key
    }
  };
}

function mergeImportedProduct(existing, incoming, importedAt) {
  return {
    ...incoming,
    id: existing.id,
    isShow: existing.isShow === undefined ? incoming.isShow : existing.isShow,
    isHot: Boolean(existing.isHot),
    isBest: Boolean(existing.isBest),
    isNew: Boolean(incoming.isNew || existing.isNew),
    sort: Number.isFinite(Number(existing.sort)) ? Number(existing.sort) : Number(incoming.sort || 0),
    image: existing.image || incoming.image || '',
    sliderImages: Array.isArray(existing.sliderImages) && existing.sliderImages.length ? existing.sliderImages : incoming.sliderImages,
    recommendImage: existing.recommendImage || incoming.recommendImage || '',
    createdAt: existing.createdAt || importedAt,
    importedAt: existing.importedAt || importedAt,
    updatedAt: importedAt
  };
}

function normalizeEditableFields(product, input) {
  const next = {};
  if (input.storeName !== undefined) next.storeName = cleanText(input.storeName).slice(0, 120);
  if (input.storeInfo !== undefined) next.storeInfo = cleanText(input.storeInfo).slice(0, 240);
  if (input.keyword !== undefined) next.keyword = cleanText(input.keyword).slice(0, 240);
  if (input.price !== undefined) next.price = normalizePrice(input.price);
  if (input.otPrice !== undefined) next.otPrice = normalizePrice(input.otPrice);
  if (input.unitName !== undefined) next.unitName = cleanText(input.unitName).slice(0, 12) || product.unitName || '台';
  if (input.image !== undefined) next.image = cleanText(input.image);
  if (input.recommendImage !== undefined) next.recommendImage = cleanText(input.recommendImage);
  if (input.isShow !== undefined) next.isShow = Boolean(input.isShow);
  if (input.isHot !== undefined) next.isHot = Boolean(input.isHot);
  if (input.isBest !== undefined) next.isBest = Boolean(input.isBest);
  if (input.isNew !== undefined) next.isNew = Boolean(input.isNew);
  if (input.sort !== undefined) next.sort = normalizeInteger(input.sort, product.sort || 0);
  if (input.description !== undefined) next.description = cleanText(input.description);
  if (Array.isArray(input.sliderImages)) next.sliderImages = normalizeTextArray(input.sliderImages);
  if (Array.isArray(input.features)) next.features = normalizeTextArray(input.features);
  if (input.specs && typeof input.specs === 'object') {
    next.specs = normalizeSpecs(input.specs);
    next.paramsList = specsToParamsList(next.specs);
  }
  if (Array.isArray(input.paramsList)) {
    next.paramsList = normalizeParamsList(input.paramsList);
  }
  return next;
}

function applyProductFilters(products, query = {}) {
  const keyword = cleanText(query.keyword).toLowerCase();
  const brand = cleanText(query.brand);
  const status = cleanText(query.status);
  const source = cleanText(query.source);

  return (products || [])
    .filter((product) => {
      if (status === 'shown' && !product.isShow) return false;
      if (status === 'hidden' && product.isShow) return false;
      if (brand && product.brand !== brand) return false;
      if (source && product.source !== source) return false;
      if (!keyword) return true;
      const haystack = [
        product.storeName,
        product.storeInfo,
        product.brand,
        product.model,
        product.keyword,
        product.source
      ].join(' ').toLowerCase();
      return haystack.includes(keyword);
    })
    .sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0) || String(a.storeName).localeCompare(String(b.storeName), 'zh-CN'));
}

function buildSummary(products, imports = []) {
  const brandCounts = {};
  let shownCount = 0;
  let hiddenCount = 0;
  let pendingPriceCount = 0;

  for (const product of products || []) {
    const brand = product.brand || '未分类';
    brandCounts[brand] = (brandCounts[brand] || 0) + 1;
    if (product.isShow) shownCount += 1;
    if (!product.isShow) hiddenCount += 1;
    if (!product.price || product.priceStatus === 'pending') pendingPriceCount += 1;
  }

  return {
    total: products.length,
    shownCount,
    hiddenCount,
    pendingPriceCount,
    brandCounts,
    brandList: Object.keys(brandCounts).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    lastImport: imports && imports.length ? imports[0] : null
  };
}

function toPublicProduct(product) {
  return {
    id: product.id,
    productKey: product.productKey,
    brand: product.brand,
    model: product.model,
    storeName: product.storeName,
    storeInfo: product.storeInfo,
    price: product.price,
    priceText: formatPrice(product.price),
    otPrice: product.otPrice,
    unitName: product.unitName,
    image: product.image,
    sliderImages: product.sliderImages || [],
    isHot: Boolean(product.isHot),
    isBest: Boolean(product.isBest),
    isNew: Boolean(product.isNew),
    skuPrices: product.skuPrices || [],
    colors: product.colors || [],
    bundles: product.bundles || [],
    features: product.features || [],
    specs: product.specs || {},
    paramsList: product.paramsList || [],
    description: product.description || '',
    sourceUrl: product.sourceUrl || '',
    source: product.source || '',
    priceStatus: product.priceStatus || '',
    scrapedAt: product.scrapedAt || '',
    updatedAt: product.updatedAt || ''
  };
}

function toAdminProduct(product) {
  const crmebId = Number(product.crmebId || product.raw?.sourceId || 0) || (
    String(product.productKey || '').startsWith('crmeb:')
      ? Number(String(product.productKey).split(':')[1]) || 0
      : 0
  );
  return {
    ...toPublicProduct(product),
    crmebId: crmebId || undefined,
    keyword: product.keyword || '',
    isShow: Boolean(product.isShow),
    sort: Number(product.sort || 0),
    specType: Number(product.specType || 0),
    attrs: product.attrs || [],
    recommendImage: product.recommendImage || '',
    importedAt: product.importedAt || '',
    createdAt: product.createdAt || '',
    raw: product.raw || null
  };
}

function normalizeSkuPrices(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      version: cleanText(item && item.version),
      price: formatPrice(normalizePrice(item && item.price)),
      priceValue: normalizePrice(item && item.price),
      sbomCode: cleanText(item && item.sbomCode),
      colors: normalizeTextArray(item && item.colors)
    }))
    .filter((item) => item.version || item.priceValue > 0);
}

function normalizeBundles(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map((item) => ({
      title: cleanText(item && item.title),
      slug: cleanText(item && item.slug),
      type: cleanText(item && item.type),
      price: formatPrice(normalizePrice(item && (item.priceValue || item.price))),
      priceValue: normalizePrice(item && (item.priceValue || item.price)),
      controller: cleanText(item && item.controller),
      bundleKind: cleanText(item && item.bundleKind),
      includedItems: Array.isArray(item && item.includedItems) ? item.includedItems.map((included) => ({
        name: cleanText(included && included.name),
        quantity: normalizeInteger(included && included.quantity, 1),
        slug: cleanText(included && included.slug)
      })).filter((included) => included.name) : []
    }))
    .filter((item) => item.title || item.priceValue > 0);
}

function normalizeSpecs(specs) {
  if (!specs || typeof specs !== 'object') return {};
  const normalized = {};
  for (const [key, value] of Object.entries(specs)) {
    const cleaned = cleanText(value).replace(/^undefined/, '').replace(/undefined/g, '').trim();
    if (!cleaned) continue;
    normalized[key] = cleaned;
  }
  return normalized;
}

function specsToParamsList(specs) {
  return Object.entries(specs || {}).map(([key, value], index) => ({
    name: SPEC_LABELS[key] || key,
    value,
    sort: index + 1,
    status: true
  }));
}

function normalizeParamsList(list) {
  return list
    .map((item, index) => ({
      name: cleanText(item && item.name).slice(0, 40),
      value: cleanText(item && item.value).slice(0, 240),
      sort: normalizeInteger(item && item.sort, index + 1),
      status: item && item.status !== false
    }))
    .filter((item) => item.name && item.value);
}

function normalizeTextArray(value) {
  const list = Array.isArray(value) ? value : [];
  return Array.from(new Set(list.map((item) => cleanText(item)).filter(Boolean)));
}

function normalizeDescription(description, features, specs) {
  const direct = cleanText(description);
  if (direct) return direct;
  const featureText = normalizeTextArray(features).slice(0, 4).join('；');
  if (featureText) return featureText;
  return Object.values(specs || {}).slice(0, 4).join('；');
}

function buildStoreInfo(brand, title, features, specs) {
  const featureText = normalizeTextArray(features).slice(0, 2).join(' / ');
  if (featureText) return featureText;
  const paramsText = Object.values(specs || {}).slice(0, 3).join(' / ');
  if (paramsText) return paramsText;
  return `${brand} ${title}`.trim();
}

function normalizeBrand(value) {
  return helperNormalizeBrand(value);
}

function cleanModelName(title, brand) {
  return cleanText(title).replace(new RegExp(`^${escapeRegExp(brand)}\\s*`, 'i'), '').replace(/^HUAWEI\s*/i, '').replace(/^HONOR\s*/i, '').trim();
}

function normalizePrice(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  const text = cleanText(value);
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
  return match ? Math.max(0, Math.round(Number(match[1]))) : 0;
}

function formatPrice(value) {
  const price = normalizePrice(value);
  return price > 0 ? `¥${price}` : '¥ --';
}

function normalizeInteger(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function brandSort(brand) {
  const map = {
    华为: 90,
    荣耀: 80,
    vivo: 70,
    iQOO: 68,
    DJI: 60
  };
  return map[brand] || 0;
}

function isRecent(value) {
  const time = new Date(value || '').getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time < 1000 * 60 * 60 * 24 * 30;
}

function slugify(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/\+/g, '-plus')
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || nanoid(8);
}

function sourceKeyId(value) {
  const text = cleanText(value);
  const slug = slugify(text);
  const hash = crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);
  return `${slug}-${hash}`;
}

function cleanText(value) {
  return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function now() {
  return new Date().toISOString();
}

module.exports = { ProductsService };
