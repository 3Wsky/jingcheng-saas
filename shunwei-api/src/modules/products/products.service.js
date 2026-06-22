const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const os = require('node:os');
const { spawn } = require('node:child_process');
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

  async createProduct(input = {}) {
    const createdAt = now();
    let created = null;
    await this.repository.updateAll((state) => {
      const id = nanoid(12);
      const base = {
        id,
        productKey: `manual:${id}`,
        source: 'manual',
        brand: '',
        model: '',
        categoryId: '',
        storeName: '',
        storeInfo: '',
        keyword: '',
        price: 0,
        otPrice: 0,
        unitName: '台',
        image: '',
        sliderImages: [],
        colors: [],
        skuPrices: [],
        features: [],
        specs: {},
        paramsList: [],
        description: '',
        isShow: input.isShow !== undefined ? Boolean(input.isShow) : true,
        isHot: false,
        isBest: false,
        isNew: false,
        specType: 0,
        sort: 0,
        createdAt,
        updatedAt: createdAt
      };
      Object.assign(base, normalizeEditableFields(base, input));
      if (input.isShow !== undefined) base.isShow = Boolean(input.isShow);
      state.products.push(base);
      created = base;
      return state;
    });
    return toAdminProduct(created);
  }

  async deleteProduct(id) {
    let removed = false;
    await this.repository.updateAll((state) => {
      const before = state.products.length;
      state.products = state.products.filter((item) => String(item.id) !== String(id));
      removed = state.products.length < before;
      return state;
    });
    if (!removed) {
      const error = new Error('商品不存在');
      error.statusCode = 404;
      throw error;
    }
    return { deleted: true };
  }

  async listCategories() {
    const state = await this.repository.readAll();
    const counts = {};
    for (const p of state.products) {
      const cid = String(p.categoryId || '');
      if (cid) counts[cid] = (counts[cid] || 0) + 1;
    }
    return (state.categories || [])
      .map((c) => ({ ...c, productCount: counts[String(c.id)] || 0 }))
      .sort((a, b) => Number(b.sort || 0) - Number(a.sort || 0) || String(a.name).localeCompare(String(b.name), 'zh-CN'));
  }

  async createCategory(input = {}) {
    const name = cleanText(input.name).slice(0, 40);
    if (!name) {
      const error = new Error('分类名称不能为空');
      error.statusCode = 400;
      throw error;
    }
    const createdAt = now();
    let created = null;
    await this.repository.updateAll((state) => {
      if ((state.categories || []).some((c) => c.name === name)) {
        const error = new Error('分类已存在');
        error.statusCode = 409;
        throw error;
      }
      created = {
        id: nanoid(8),
        name,
        sort: normalizeInteger(input.sort, 0),
        createdAt,
        updatedAt: createdAt
      };
      state.categories = [...(state.categories || []), created];
      return state;
    });
    return created;
  }

  async updateCategory(id, input = {}) {
    let updated = null;
    await this.repository.updateAll((state) => {
      const category = (state.categories || []).find((c) => String(c.id) === String(id));
      if (!category) {
        const error = new Error('分类不存在');
        error.statusCode = 404;
        throw error;
      }
      if (input.name !== undefined) {
        const name = cleanText(input.name).slice(0, 40);
        if (!name) {
          const error = new Error('分类名称不能为空');
          error.statusCode = 400;
          throw error;
        }
        if ((state.categories || []).some((c) => c.name === name && String(c.id) !== String(id))) {
          const error = new Error('分类已存在');
          error.statusCode = 409;
          throw error;
        }
        category.name = name;
      }
      if (input.sort !== undefined) category.sort = normalizeInteger(input.sort, category.sort || 0);
      category.updatedAt = now();
      updated = category;
      return state;
    });
    return updated;
  }

  async deleteCategory(id) {
    await this.repository.updateAll((state) => {
      state.categories = (state.categories || []).filter((c) => String(c.id) !== String(id));
      // 解绑该分类下的商品，避免悬挂引用
      for (const p of state.products) {
        if (String(p.categoryId || '') === String(id)) {
          p.categoryId = '';
          p.updatedAt = now();
        }
      }
      return state;
    });
    return { deleted: true };
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

  async batchUpdateCategory(ids, categoryId) {
    const idSet = new Set((ids || []).map((id) => String(id)));
    const targetCategoryId = cleanText(categoryId || '');
    let updatedCount = 0;

    await this.repository.updateAll((state) => {
      if (targetCategoryId && !(state.categories || []).some((c) => String(c.id) === targetCategoryId)) {
        const error = new Error('指定的分类不存在');
        error.statusCode = 400;
        throw error;
      }
      state.products = state.products.map((product) => {
        if (!idSet.has(String(product.id))) return product;
        updatedCount += 1;
        return {
          ...product,
          categoryId: targetCategoryId,
          updatedAt: now()
        };
      });
      return state;
    });

    return { updatedCount };
  }

  // 采集/导入时解析并校验目标分类，返回规范化的 categoryId（空串表示不指定）
  async resolveCategoryId(rawId) {
    const categoryId = cleanText(rawId || '');
    if (!categoryId) return '';
    const state = await this.repository.readAll();
    if (!(state.categories || []).some((c) => String(c.id) === categoryId)) {
      const error = new Error('指定的分类不存在');
      error.statusCode = 400;
      throw error;
    }
    return categoryId;
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
    const categoryId = await this.resolveCategoryId(options.categoryId);
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
          if (categoryId) existing.categoryId = categoryId;
          updatedCount += 1;
          continue;
        }

        const created = {
          ...incoming,
          id: nanoid(12),
          categoryId: categoryId || incoming.categoryId || '',
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

  async importFromCsv(options = {}) {
    const csvText = String(options.csv || options.content || '').trim();
    if (!csvText) {
      const error = new Error('请提供 CSV 内容');
      error.statusCode = 400;
      throw error;
    }

    const categoryId = await this.resolveCategoryId(options.categoryId);
    const rows = parseProductCsv(csvText);
    if (!rows.length) {
      const error = new Error('CSV 无有效商品行（需表头 + 至少一行商品名称）');
      error.statusCode = 400;
      throw error;
    }

    const incomingProducts = rows
      .map((row) => normalizeCsvProduct(row))
      .filter(Boolean);

    if (!incomingProducts.length) {
      const error = new Error('CSV 中未解析到有效商品');
      error.statusCode = 400;
      throw error;
    }

    let importSummary = null;
    const importedAt = now();
    await this.repository.updateAll((state) => {
      const byKey = new Map(state.products.map((product) => [product.productKey, product]));
      let createdCount = 0;
      let updatedCount = 0;
      const defaultShow = options.isShow !== undefined ? Boolean(options.isShow) : true;

      for (const incoming of incomingProducts) {
        const existing = byKey.get(incoming.productKey);
        if (existing) {
          Object.assign(existing, mergeImportedProduct(existing, incoming, importedAt));
          if (categoryId) existing.categoryId = categoryId;
          updatedCount += 1;
          continue;
        }

        const created = {
          ...incoming,
          id: nanoid(12),
          categoryId: categoryId || incoming.categoryId || '',
          isShow: defaultShow,
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
        source: 'csv-import',
        fileName: options.fileName || 'products.csv',
        total: incomingProducts.length,
        createdCount,
        updatedCount,
        skippedCount: rows.length - incomingProducts.length,
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

  async importFromCrmeb(options = {}) {
    const pool = getPool();
    const categoryId = await this.resolveCategoryId(options.categoryId);
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
          if (categoryId) existing.categoryId = categoryId;
          updatedCount += 1;
          continue;
        }

        const created = {
          ...incoming,
          id: nanoid(12),
          categoryId: categoryId || incoming.categoryId || '',
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

  // 调用 fzlsaas 官网采集器（digital-price-tag-generator/fzlsaas-scraper.mjs），返回采集到的商品数组
  async runOfficialScraper(models) {
    const scraperDir = process.env.OFFICIAL_SCRAPER_DIR
      || path.resolve(config.rootDir, '..', '..', 'digital-price-tag-generator');
    const scraperFile = path.join(scraperDir, 'fzlsaas-scraper.mjs');
    try {
      await fs.access(scraperFile);
    } catch {
      const error = new Error('官网采集器未就绪：未找到 fzlsaas-scraper.mjs（请部署 digital-price-tag-generator 或设置 OFFICIAL_SCRAPER_DIR）');
      error.statusCode = 503;
      throw error;
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tmpModels = path.join(os.tmpdir(), `fzlsaas-official-models-${stamp}.txt`);
    const tmpOut = path.join(os.tmpdir(), `fzlsaas-official-out-${stamp}.json`);
    await fs.writeFile(tmpModels, models.join('\n'), 'utf8');
    try {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
          'fzlsaas-scraper.mjs',
          '--models', tmpModels,
          '--out', tmpOut,
          '--delay-min-ms', '1500',
          '--delay-max-ms', '3500'
        ], { cwd: scraperDir, windowsHide: true });
        let stderr = '';
        child.stderr.on('data', (chunk) => { stderr += String(chunk); });
        const timeoutMs = 90000 + 60000 * models.length;
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('官网采集超时，请减少型号数量后重试'));
        }, timeoutMs);
        child.on('error', (err) => { clearTimeout(timer); reject(err); });
        child.on('exit', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else reject(new Error(`采集器异常退出(${code})：${stderr.slice(0, 300)}`));
        });
      });
      const raw = await fs.readFile(tmpOut, 'utf8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed.products) ? parsed.products : [];
    } finally {
      fs.rm(tmpModels, { force: true }).catch(() => {});
      fs.rm(tmpOut, { force: true }).catch(() => {});
    }
  }

  // 官网采集并写入商品库（含图片：主图/轮播/颜色对应图/详情图）
  async collectFromOfficial(options = {}) {
    const models = (options.models || [])
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .slice(0, 8);
    if (!models.length) {
      const error = new Error('请提供要采集的型号');
      error.statusCode = 400;
      throw error;
    }
    const categoryId = await this.resolveCategoryId(options.categoryId);
    const scraped = await this.runOfficialScraper(models);
    if (!scraped.length) {
      const error = new Error('官网未采集到任何商品（型号可能不匹配，或暂只支持华为）');
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

      for (const sp of scraped) {
        const incoming = normalizeOfficialProduct(sp);
        if (!incoming.productKey || !incoming.storeName) continue;
        const existing = byKey.get(incoming.productKey);
        if (existing) {
          Object.assign(existing, mergeImportedProduct(existing, incoming, importedAt));
          existing.skuPrices = incoming.skuPrices;
          existing.colors = incoming.colors;
          existing.colorItems = incoming.colorItems;
          existing.detailImages = incoming.detailImages;
          existing.paramsList = incoming.paramsList;
          existing.specs = incoming.specs;
          existing.specType = incoming.specType;
          if (incoming.description) existing.description = incoming.description;
          if (categoryId) existing.categoryId = categoryId;
          updatedCount += 1;
          continue;
        }
        const created = {
          ...incoming,
          id: nanoid(12),
          categoryId: categoryId || '',
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
        source: 'vmall-official',
        sourceLabel: '华为官网',
        models,
        total: scraped.length,
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

// 把官网采集器输出的商品规范化为 fzlsaas 商品结构（含图片字段）
function normalizeOfficialProduct(sp) {
  const product = sp || {};
  const skuPrices = (product.skuPrices || []).map((s) => ({
    version: helperCleanText(s.version || ''),
    price: s.price || (s.priceValue ? `¥ ${s.priceValue}` : ''),
    priceValue: Number(s.priceValue) || Number(String(s.price || '').replace(/[^\d.]/g, '')) || 0,
    sbomCode: s.sbomCode || '',
    colors: s.color ? [s.color] : [],
    image: s.image || ''
  }));
  const sliderImages = Array.isArray(product.sliderImages) ? product.sliderImages.filter(Boolean) : [];
  const colorItems = Array.isArray(product.colorItems)
    ? product.colorItems.filter((c) => c && c.name).map((c) => ({ name: helperCleanText(c.name), image: c.image || '', sbomCode: c.sbomCode || '' }))
    : [];
  const detailImages = Array.isArray(product.detailImages) ? product.detailImages.filter(Boolean) : [];
  const price = Math.max(0, Math.round(Number(product.price) || 0));
  return {
    productKey: product.productKey || `vmall:${helperCleanText(product.model || product.storeName || '')}`,
    crmebId: null,
    brand: helperCleanText(product.brand || ''),
    model: helperCleanText(product.model || ''),
    storeName: helperCleanText(product.storeName || product.model || ''),
    storeInfo: helperCleanText(product.storeInfo || ''),
    keyword: helperCleanText(product.keyword || ''),
    price,
    otPrice: 0,
    unitName: '台',
    image: product.image || sliderImages[0] || (colorItems[0] && colorItems[0].image) || '',
    sliderImages,
    recommendImage: product.image || '',
    isShow: true,
    isHot: false,
    isBest: false,
    isNew: false,
    sort: 0,
    specType: product.specType ? 1 : 0,
    attrs: [],
    skuPrices,
    colors: Array.isArray(product.colors) && product.colors.length ? product.colors : colorItems.map((c) => c.name),
    colorItems,
    features: [],
    specs: product.specs && typeof product.specs === 'object' ? product.specs : {},
    paramsList: Array.isArray(product.paramsList) ? product.paramsList : [],
    detailImages,
    description: product.description || '',
    source: 'vmall-official',
    priceStatus: price > 0 ? 'available' : 'pending',
    scrapedAt: product.scrapedAt || ''
  };
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

const CSV_HEADER_ALIASES = {
  storename: 'storeName',
  name: 'storeName',
  title: 'storeName',
  '商品名称': 'storeName',
  brand: 'brand',
  '品牌': 'brand',
  price: 'price',
  '售价': 'price',
  storeinfo: 'storeInfo',
  info: 'storeInfo',
  '简介': 'storeInfo',
  image: 'image',
  '主图': 'image',
  sourceurl: 'sourceUrl',
  url: 'sourceUrl',
  '来源链接': 'sourceUrl',
  model: 'model',
  '型号': 'model'
};

function parseProductCsv(text) {
  const lines = String(text || '').trim().replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(',').map((s) => s.trim());
  const fieldIndexes = header.map((h) => CSV_HEADER_ALIASES[h.toLowerCase()] || CSV_HEADER_ALIASES[h] || null);
  const rows = [];
  for (let i = 1; i < lines.length && rows.length < 500; i++) {
    const cols = lines[i].split(',').map((s) => s.trim());
    const row = {};
    fieldIndexes.forEach((field, idx) => {
      if (field && cols[idx]) row[field] = cols[idx];
    });
    if (row.storeName) rows.push(row);
  }
  return rows;
}

function normalizeCsvProduct(row) {
  const storeName = cleanText(row.storeName || '');
  if (!storeName) return null;
  const brand = normalizeBrand(row.brand || storeName);
  const price = normalizePrice(row.price);
  const image = cleanText(row.image || '');
  const sliderImages = image ? [image] : [];

  return {
    productKey: `csv:${sourceKeyId(`${brand}:${storeName}`)}`,
    brand,
    model: cleanModelName(row.model || storeName, brand),
    storeName,
    storeInfo: cleanText(row.storeInfo || ''),
    keyword: [brand, storeName, cleanText(row.model || '')].filter(Boolean).join(','),
    price,
    otPrice: 0,
    unitName: '台',
    image,
    sliderImages,
    recommendImage: image,
    isShow: true,
    isHot: false,
    isBest: false,
    isNew: false,
    sort: brandSort(brand),
    specType: 0,
    attrs: [],
    skuPrices: price > 0 ? [{ version: '默认', price: String(price), priceValue: price, colors: [] }] : [],
    colors: [],
    features: [],
    specs: {},
    paramsList: [],
    description: '',
    sourceUrl: cleanText(row.sourceUrl || ''),
    source: 'csv',
    priceStatus: price > 0 ? 'available' : 'pending',
    scrapedAt: '',
    raw: { sourceFile: 'csv-import' }
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
  if (input.brand !== undefined) next.brand = cleanText(input.brand).slice(0, 40);
  if (input.model !== undefined) next.model = cleanText(input.model).slice(0, 80);
  if (input.categoryId !== undefined) next.categoryId = cleanText(input.categoryId).slice(0, 40);
  if (input.specType !== undefined) next.specType = Number(input.specType) ? 1 : 0;
  if (Array.isArray(input.sliderImages)) next.sliderImages = normalizeTextArray(input.sliderImages);
  if (Array.isArray(input.colors)) next.colors = normalizeTextArray(input.colors);
  if (Array.isArray(input.features)) next.features = normalizeTextArray(input.features);
  if (Array.isArray(input.skuPrices)) next.skuPrices = normalizeSkuPrices(input.skuPrices);
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
  const categoryId = cleanText(query.categoryId);

  return (products || [])
    .filter((product) => {
      if (status === 'shown' && !product.isShow) return false;
      if (status === 'hidden' && product.isShow) return false;
      if (brand && product.brand !== brand) return false;
      if (source && product.source !== source) return false;
      if (categoryId && String(product.categoryId || '') !== categoryId) return false;
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
    categoryId: product.categoryId || '',
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
