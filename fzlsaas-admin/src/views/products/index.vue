<template>
  <PageShell>
    <template #tabs>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane :label="`销售中(${summary.shownCount})`" name="shown" />
        <el-tab-pane :label="`仓库中(${summary.hiddenCount})`" name="hidden" />
        <el-tab-pane :label="`全部(${summary.total})`" name="all" />
      </el-tabs>
    </template>

    <template #filter>
      <el-alert
        v-if="summary.lastImport"
        type="info"
        :closable="false"
        show-icon
        class="import-bar"
        :title="lastImportTitle"
      />
      <el-form :inline="true" class="filter-form" @submit.prevent="search">
        <el-form-item label="商品搜索">
          <el-input v-model="keyword" placeholder="名称/品牌/型号" clearable style="width: 220px" />
        </el-form-item>
        <el-form-item label="品牌">
          <el-select v-model="brand" placeholder="全部" clearable style="width: 120px">
            <el-option v-for="b in brandList" :key="b" :label="b" :value="b" />
          </el-select>
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="categoryFilter" placeholder="全部" clearable style="width: 130px">
            <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
          </el-select>
        </el-form-item>
        <template v-if="filterExpanded">
          <el-form-item label="来源">
            <el-select v-model="sourceFilter" placeholder="全部" clearable style="width: 120px">
              <el-option v-for="s in sourceList" :key="s" :label="sourceLabel(s)" :value="s" />
            </el-select>
          </el-form-item>
          <el-form-item label="规格">
            <el-select v-model="specFilter" placeholder="全部" clearable style="width: 100px">
              <el-option label="单规格" value="0" />
              <el-option label="多规格" value="1" />
            </el-select>
          </el-form-item>
        </template>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button link type="primary" @click="filterExpanded = !filterExpanded">
            {{ filterExpanded ? '收起' : '展开' }}
          </el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #toolbar>
      <div class="toolbar-left">
        <el-button type="primary" @click="openCreate">新建商品</el-button>
        <el-button type="success" @click="openCollect">商品采集</el-button>
        <el-button @click="openCatDialog">分类管理</el-button>
        <el-dropdown :disabled="!selected.length" @command="batchShow">
          <el-button>
            批量设置<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item :command="true">批量上架</el-dropdown-item>
              <el-dropdown-item :command="false">批量下架</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-dropdown :disabled="!selected.length" @command="batchCategory">
          <el-button>
            批量分类<el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item v-for="c in categories" :key="c.id" :command="c.id">{{ c.name }}</el-dropdown-item>
              <el-dropdown-item v-if="!categories.length" disabled>暂无分类，请先在「分类管理」添加</el-dropdown-item>
              <el-dropdown-item v-if="categories.length" :command="UNCATEGORIZED" divided>移除分类（设为未分类）</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button @click="exportData">数据导出</el-button>
        <el-button
          :type="sortMode ? 'primary' : 'default'"
          :disabled="!canSort"
          @click="toggleSortMode"
        >
          {{ sortMode ? '完成排序' : '拖拽排序' }}
        </el-button>
      </div>
      <div class="toolbar-right">
        <span class="hint">展示商品 · 价签导入 · 不支持下单发货</span>
      </div>
    </template>

    <el-table ref="tableRef" :data="displayList" v-loading="loading" row-key="id" @selection-change="onSelect">
      <template #empty>
        <el-empty description="暂无展示商品">
          <el-button type="primary" @click="openCollect">商品采集</el-button>
        </el-empty>
      </template>
      <el-table-column v-if="sortMode" label="" width="48" align="center">
        <template #default>
          <el-icon class="drag-handle" style="cursor: grab"><Rank /></el-icon>
        </template>
      </el-table-column>
      <el-table-column type="selection" width="48" />
      <el-table-column prop="id" label="ID" width="120" show-overflow-tooltip />
      <el-table-column label="商品图" width="72" align="center">
        <template #default="{ row }">
          <el-image
            v-if="row.image"
            :src="row.image"
            :preview-src-list="previewImages(row)"
            style="width:40px;height:40px"
            fit="cover"
          />
          <span v-else class="no-img">无图</span>
        </template>
      </el-table-column>
      <el-table-column label="商品名称" min-width="200">
        <template #default="{ row }">
          <div class="name-row">
            <el-tag v-if="row.isHot" size="small" type="danger" effect="plain">热门</el-tag>
            <el-tag v-if="row.isNew" size="small" type="success" effect="plain">新品</el-tag>
            <el-tag v-if="row.isBest" size="small" type="warning" effect="plain">精品</el-tag>
            <el-tag v-if="row.specType" size="small" type="info">多规格</el-tag>
            <el-tag v-else size="small">单规格</el-tag>
          </div>
          <span class="name-link" @click="openEdit(row)">{{ row.storeName }}</span>
          <div class="sub-info">{{ row.storeInfo }}</div>
        </template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="88" />
      <el-table-column label="分类" width="96">
        <template #default="{ row }">
          <span v-if="row.categoryId">{{ categoryName(row.categoryId) }}</span>
          <span v-else class="sub-info">未分类</span>
        </template>
      </el-table-column>
      <el-table-column label="售价" width="100" align="right">
        <template #default="{ row }">
          <span v-if="row.price">¥{{ row.price }}</span>
          <el-tag v-else size="small" type="warning">待定价</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="SKU/参数" min-width="180">
        <template #default="{ row }">
          <div>{{ skuCount(row) }} 个 SKU · {{ (row.paramsList || []).length }} 项参数</div>
          <div class="sub-info">{{ paramPreview(row) }}</div>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="88">
        <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="88" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isShow ? 'success' : 'info'" size="small">{{ row.isShow ? '销售中' : '仓库' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="toggleShow(row)">{{ row.isShow ? '下架' : '上架' }}</el-button>
          <el-button link type="danger" @click="removeProduct(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-if="!sortMode"
        v-model:current-page="page"
        layout="total, prev, pager, next"
        :total="filteredTotal"
        :page-size="pageSize"
      />
      <p v-else class="sort-hint">拖拽左侧手柄调整「销售中」商品展示顺序，完成后点击「完成排序」保存</p>
    </template>
  </PageShell>

  <ProductCollectDialog v-model="collectOpen" mode="showcase" @success="load" />

  <el-drawer v-model="editOpen" :title="editForm && editForm.id ? '编辑展示商品' : '新建展示商品'" size="680px" destroy-on-close>
    <el-form v-if="editForm" :model="editForm" label-width="96px">
      <el-divider content-position="left">基础信息</el-divider>
      <el-form-item label="商品名称" required><el-input v-model="editForm.storeName" placeholder="必填" /></el-form-item>
      <el-form-item label="简介"><el-input v-model="editForm.storeInfo" type="textarea" :rows="2" /></el-form-item>
      <el-form-item label="品牌"><el-input v-model="editForm.brand" style="width: 200px" /></el-form-item>
      <el-form-item label="型号"><el-input v-model="editForm.model" style="width: 200px" /></el-form-item>
      <el-form-item label="分类">
        <el-select v-model="editForm.categoryId" placeholder="未分类" clearable style="width: 200px">
          <el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id" />
        </el-select>
        <el-button link type="primary" style="margin-left: 8px" @click="openCatDialog">管理分类</el-button>
      </el-form-item>
      <el-form-item label="封面图">
        <ImageUrlInput v-model="editForm.image" placeholder="封面图 URL" />
      </el-form-item>
      <el-form-item label="轮播图">
        <ImageListInput v-model="editForm.sliderImages" :max="9" />
      </el-form-item>
      <el-form-item label="售价"><el-input-number v-model="editForm.price" :min="0" /></el-form-item>
      <el-form-item label="排序"><el-input-number v-model="editForm.sort" /></el-form-item>
      <el-form-item label="标签">
        <el-checkbox v-model="editForm.isHot">热门</el-checkbox>
        <el-checkbox v-model="editForm.isNew">新品</el-checkbox>
        <el-checkbox v-model="editForm.isBest">精品</el-checkbox>
      </el-form-item>
      <el-form-item label="上架"><el-switch v-model="editForm.isShow" /></el-form-item>

      <el-divider content-position="left">规格</el-divider>
      <el-form-item label="规格类型">
        <el-radio-group v-model="editForm.specType">
          <el-radio-button :value="0">单规格</el-radio-button>
          <el-radio-button :value="1">多规格</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="editForm.specType === 1" label="规格/SKU">
        <div class="sku-editor">
          <div v-for="(sku, i) in editForm.skuPrices" :key="i" class="sku-row">
            <el-input v-model="sku.version" placeholder="规格名（如 256G 黑色）" style="flex:1" />
            <el-input-number v-model="sku.price" :min="0" :controls="false" placeholder="价格" style="width:120px" />
            <el-button link type="danger" @click="removeSku(i)">删除</el-button>
          </div>
          <el-button size="small" @click="addSku">+ 添加规格</el-button>
        </div>
      </el-form-item>

      <el-divider content-position="left">参数</el-divider>
      <el-form-item label="参数表">
        <div class="param-editor">
          <div v-for="(p, i) in editForm.paramsList" :key="i" class="param-row">
            <el-input v-model="p.name" placeholder="参数名（如 屏幕）" style="width:180px" />
            <el-input v-model="p.value" placeholder="参数值（如 6.1英寸）" style="flex:1" />
            <el-button link type="danger" @click="removeParam(i)">删除</el-button>
          </div>
          <el-button size="small" @click="addParam">+ 添加参数</el-button>
        </div>
      </el-form-item>

      <el-divider content-position="left">详情</el-divider>
      <el-form-item label="详情">
        <LazyRichTextEditor v-model="editForm.description" :height="360" placeholder="编辑商品详情" max-width="100%" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="editOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="saveEdit">保存</el-button>
    </template>
  </el-drawer>

  <el-dialog v-model="catDialogOpen" title="商品分类管理" width="520px">
    <div class="cat-add">
      <el-input v-model="catForm.name" placeholder="新分类名称" style="width: 220px" @keyup.enter="submitCategory" />
      <el-input-number v-model="catForm.sort" placeholder="排序" :controls="false" style="width: 90px" />
      <el-button type="primary" :loading="catSaving" @click="submitCategory">{{ catForm.id ? '更新' : '添加' }}</el-button>
      <el-button v-if="catForm.id" @click="resetCatForm">取消编辑</el-button>
    </div>
    <el-table :data="categories" size="small" style="margin-top: 12px">
      <template #empty><el-empty description="暂无分类" :image-size="60" /></template>
      <el-table-column prop="name" label="分类名称" />
      <el-table-column prop="productCount" label="商品数" width="80" align="center" />
      <el-table-column prop="sort" label="排序" width="70" align="center" />
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="editCategory(row)">编辑</el-button>
          <el-button link type="danger" @click="removeCategory(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { ArrowDown, Rank } from '@element-plus/icons-vue'
import Sortable from 'sortablejs'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import ProductCollectDialog from '@/components/ProductCollectDialog.vue'
import ImageUrlInput from '@/components/ImageUrlInput.vue'
import ImageListInput from '@/components/ImageListInput.vue'
import LazyRichTextEditor from '@/components/LazyRichTextEditor'
import { downloadCsv } from '@/utils/csvExport'

const loading = ref(false)
const allList = ref<any[]>([])
const summary = ref<any>({ shownCount: 0, hiddenCount: 0, total: 0, lastImport: null })
const brandList = ref<string[]>([])
const sourceList = ref<string[]>([])
const activeTab = ref('shown')
const keyword = ref('')
const brand = ref('')
const categoryFilter = ref('')
const sourceFilter = ref('')
const specFilter = ref('')
const filterExpanded = ref(false)
const selected = ref<any[]>([])
const collectOpen = ref(false)
const editOpen = ref(false)
const editForm = ref<any>(null)
const saving = ref(false)
const categories = ref<any[]>([])
const catDialogOpen = ref(false)
const catForm = ref<{ id: string; name: string; sort: number }>({ id: '', name: '', sort: 0 })
const catSaving = ref(false)
const page = ref(1)
const pageSize = 20
const UNCATEGORIZED = '__uncategorized__'
const sortMode = ref(false)
const tableRef = ref<any>(null)
let sortable: Sortable | null = null

const canSort = computed(() =>
  activeTab.value === 'shown' &&
  !keyword.value &&
  !brand.value &&
  !categoryFilter.value &&
  !sourceFilter.value &&
  !specFilter.value
)

const filteredTotal = computed(() => filteredList.value.length)
const displayList = computed(() => {
  if (sortMode.value) return filteredList.value
  const start = (page.value - 1) * pageSize
  return filteredList.value.slice(start, start + pageSize)
})

const SOURCE_LABELS: Record<string, string> = {
  official: '官方',
  dji: '大疆',
  crmeb: 'CRMEB',
  csv: 'CSV',
  'digital-price-tag-generator': '价签'
}

const filteredList = computed(() => {
  let rows = allList.value
  if (activeTab.value === 'shown') rows = rows.filter((r) => r.isShow)
  else if (activeTab.value === 'hidden') rows = rows.filter((r) => !r.isShow)
  if (keyword.value) {
    const k = keyword.value.toLowerCase()
    rows = rows.filter((r) => [r.storeName, r.brand, r.model, r.keyword].join(' ').toLowerCase().includes(k))
  }
  if (brand.value) rows = rows.filter((r) => r.brand === brand.value)
  if (categoryFilter.value) rows = rows.filter((r) => String(r.categoryId || '') === categoryFilter.value)
  if (sourceFilter.value) rows = rows.filter((r) => r.source === sourceFilter.value)
  if (specFilter.value === '1') rows = rows.filter((r) => r.specType)
  else if (specFilter.value === '0') rows = rows.filter((r) => !r.specType)
  return rows
})

onMounted(() => {
  load()
  loadCategories()
})

async function loadCategories() {
  try {
    categories.value = await request.get('/api/admin/product-categories')
  } catch {
    categories.value = []
  }
}

function categoryName(id?: string) {
  if (!id) return '—'
  return categories.value.find((c) => String(c.id) === String(id))?.name || '—'
}

function sourceLabel(s?: string) {
  if (!s) return '—'
  return SOURCE_LABELS[s] || s
}

function formatTime(v?: string) {
  if (!v) return '—'
  try {
    return new Date(v).toLocaleString('zh-CN')
  } catch {
    return v
  }
}

const lastImportTitle = computed(() => {
  const imp = summary.value.lastImport
  if (!imp) return ''
  const source = imp.sourceLabel || (imp.source === 'crmeb' ? 'CRMEB' : '价签')
  const fileHint = imp.files?.[0]?.fileName || (imp.source === 'crmeb' ? 'CRMEB商品库' : '价签JSON')
  const created = imp.createdCount ?? 0
  const updated = imp.updatedCount ?? 0
  const total = imp.total ?? imp.importedCount ?? (created + updated)
  const countText = updated > 0 ? `新增 ${created} / 更新 ${updated}` : `${total} 条`
  return `最近采集：${fileHint}（${source}）· ${countText} · ${formatTime(imp.importedAt)}`
})

function previewImages(row: any) {
  const imgs = [row.image, ...(row.sliderImages || [])].filter(Boolean)
  return imgs.length ? imgs : row.image ? [row.image] : []
}

function skuCount(row: any) {
  return (row.skuPrices || row.attrs || []).length
}

function paramPreview(row: any) {
  return (row.paramsList || []).slice(0, 2).map((p: any) => `${p.name}：${p.value}`).join(' / ') || '暂无参数'
}

async function load() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/products', {
      params: {
        status: 'all',
        keyword: keyword.value || undefined,
        brand: brand.value || undefined,
        source: sourceFilter.value || undefined
      }
    })
    allList.value = data?.list || []
    summary.value = {
      shownCount: data?.summary?.shownCount ?? 0,
      hiddenCount: data?.summary?.hiddenCount ?? 0,
      total: data?.summary?.total ?? allList.value.length,
      lastImport: data?.summary?.lastImport ?? null
    }
    brandList.value = data?.summary?.brandList || []
    const sources = new Set(allList.value.map((r) => r.source).filter(Boolean))
    sourceList.value = Array.from(sources)
  } catch {
    allList.value = []
  } finally {
    loading.value = false
  }
}

function onTabChange() { page.value = 1 }
function search() { page.value = 1; load() }
function reset() {
  keyword.value = ''
  brand.value = ''
  categoryFilter.value = ''
  sourceFilter.value = ''
  specFilter.value = ''
  activeTab.value = 'shown'
  search()
}
function onSelect(rows: any[]) { selected.value = rows }
function openCollect() { collectOpen.value = true }

function openCreate() {
  editForm.value = {
    id: '',
    storeName: '',
    storeInfo: '',
    brand: '',
    model: '',
    categoryId: '',
    image: '',
    sliderImages: [''],
    price: 0,
    sort: 0,
    isShow: true,
    isHot: false,
    isNew: false,
    isBest: false,
    specType: 0,
    skuPrices: [],
    paramsList: [],
    description: ''
  }
  editOpen.value = true
}

function openEdit(row: any) {
  editForm.value = {
    id: row.id,
    storeName: row.storeName,
    storeInfo: row.storeInfo,
    brand: row.brand || '',
    model: row.model || '',
    categoryId: row.categoryId || '',
    image: row.image,
    sliderImages: row.sliderImages?.length ? [...row.sliderImages] : [''],
    price: row.price,
    sort: row.sort,
    isShow: row.isShow,
    isHot: Boolean(row.isHot),
    isNew: Boolean(row.isNew),
    isBest: Boolean(row.isBest),
    specType: Number(row.specType) ? 1 : 0,
    skuPrices: (row.skuPrices || []).map((s: any) => ({ version: s.version || '', price: Number(s.priceValue ?? s.price ?? 0) })),
    paramsList: (row.paramsList || []).map((p: any) => ({ name: p.name || '', value: p.value || '' })),
    description: row.description || ''
  }
  editOpen.value = true
}

function addSku() {
  editForm.value.skuPrices.push({ version: '', price: 0 })
}
function removeSku(i: number) {
  editForm.value.skuPrices.splice(i, 1)
}
function addParam() {
  editForm.value.paramsList.push({ name: '', value: '' })
}
function removeParam(i: number) {
  editForm.value.paramsList.splice(i, 1)
}

async function saveEdit() {
  if (!editForm.value) return
  if (!editForm.value.storeName?.trim()) {
    ElMessage.warning('请填写商品名称')
    return
  }
  saving.value = true
  try {
    const sliderImages = (editForm.value.sliderImages || []).filter((x: string) => x?.trim())
    const skuPrices = (editForm.value.skuPrices || [])
      .filter((s: any) => s.version?.trim() || Number(s.price) > 0)
      .map((s: any) => ({ version: s.version?.trim() || '', price: Number(s.price) || 0 }))
    const paramsList = (editForm.value.paramsList || [])
      .filter((p: any) => p.name?.trim() && p.value?.trim())
      .map((p: any) => ({ name: p.name.trim(), value: p.value.trim() }))
    const payload: any = {
      storeName: editForm.value.storeName.trim(),
      storeInfo: editForm.value.storeInfo,
      brand: editForm.value.brand,
      model: editForm.value.model,
      categoryId: editForm.value.categoryId || '',
      image: editForm.value.image,
      sliderImages,
      price: editForm.value.price,
      sort: editForm.value.sort,
      isShow: editForm.value.isShow,
      isHot: editForm.value.isHot,
      isNew: editForm.value.isNew,
      isBest: editForm.value.isBest,
      specType: editForm.value.specType ? 1 : 0,
      skuPrices,
      paramsList,
      description: editForm.value.description
    }
    if (editForm.value.id) {
      await request.put(`/api/admin/products/${editForm.value.id}`, payload)
      ElMessage.success('已保存')
    } else {
      await request.post('/api/admin/products', payload)
      ElMessage.success('商品已创建')
    }
    editOpen.value = false
    load()
  } catch { /* handled */ }
  finally { saving.value = false }
}

// ── 分类管理 ──
function openCatDialog() {
  resetCatForm()
  loadCategories()
  catDialogOpen.value = true
}
function resetCatForm() {
  catForm.value = { id: '', name: '', sort: 0 }
}
function editCategory(row: any) {
  catForm.value = { id: row.id, name: row.name, sort: row.sort || 0 }
}
async function submitCategory() {
  if (!catForm.value.name?.trim()) {
    ElMessage.warning('请输入分类名称')
    return
  }
  catSaving.value = true
  try {
    if (catForm.value.id) {
      await request.put(`/api/admin/product-categories/${catForm.value.id}`, {
        name: catForm.value.name.trim(),
        sort: catForm.value.sort
      })
      ElMessage.success('分类已更新')
    } else {
      await request.post('/api/admin/product-categories', {
        name: catForm.value.name.trim(),
        sort: catForm.value.sort
      })
      ElMessage.success('分类已添加')
    }
    resetCatForm()
    await loadCategories()
  } catch { /* handled */ }
  finally { catSaving.value = false }
}
async function removeCategory(row: any) {
  try {
    await ElMessageBox.confirm(
      row.productCount > 0
        ? `分类「${row.name}」下有 ${row.productCount} 个商品，删除后这些商品将变为「未分类」。确认删除？`
        : `确认删除分类「${row.name}」？`,
      '删除确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  try {
    await request.delete(`/api/admin/product-categories/${row.id}`)
    ElMessage.success('分类已删除')
    await loadCategories()
    load()
  } catch { /* handled */ }
}

async function toggleShow(row: any) {
  try {
    await request.patch(`/api/admin/products/${row.id}/show`, { isShow: !row.isShow })
    ElMessage.success('状态已更新')
    load()
  } catch { /* handled */ }
}

async function removeProduct(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除商品「${row.storeName}」？删除后不可恢复。`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await request.delete(`/api/admin/products/${row.id}`)
    ElMessage.success('商品已删除')
    load()
  } catch { /* handled */ }
}

async function batchShow(isShow: boolean) {
  if (!selected.value.length) return
  try {
    await request.patch('/api/admin/products/batch-show', { ids: selected.value.map((r) => r.id), isShow })
    ElMessage.success('批量更新成功')
    load()
  } catch { /* handled */ }
}

async function batchCategory(command: string) {
  if (!selected.value.length) return
  const categoryId = command === UNCATEGORIZED ? '' : command
  try {
    const res = await request.patch('/api/admin/products/batch-category', {
      ids: selected.value.map((r) => r.id),
      categoryId
    })
    const name = categoryId ? categoryName(categoryId) : '未分类'
    ElMessage.success(`已将 ${res?.updatedCount ?? selected.value.length} 个商品设为「${name}」`)
    await loadCategories()
    load()
  } catch { /* handled */ }
}

function exportData() {
  const rows = filteredList.value
  if (!rows.length) {
    ElMessage.info('暂无数据可导出')
    return
  }
  downloadCsv(
    'products-list.csv',
    ['ID', '商品名称', '品牌', '售价', 'SKU数', '参数项', '来源', '状态'],
    rows.map((r) => [
      r.id,
      r.storeName || '',
      r.brand || '',
      r.price ?? '',
      skuCount(r),
      (r.paramsList || []).length,
      sourceLabel(r.source),
      r.isShow ? '销售中' : '仓库'
    ])
  )
  ElMessage.success(`已导出 ${rows.length} 条`)
}

function destroySortable() {
  sortable?.destroy()
  sortable = null
}

async function initSortable() {
  await nextTick()
  destroySortable()
  if (!sortMode.value || !canSort.value) return
  const tbody = tableRef.value?.$el?.querySelector('.el-table__body-wrapper tbody')
  if (!tbody) return
  sortable = Sortable.create(tbody, {
    handle: '.drag-handle',
    animation: 150,
    onEnd: async (evt) => {
      const { oldIndex, newIndex } = evt
      if (oldIndex == null || newIndex == null || oldIndex === newIndex) return
      const ids = filteredList.value.map((r) => r.id)
      const [moved] = ids.splice(oldIndex, 1)
      ids.splice(newIndex, 0, moved)
      try {
        await request.patch('/api/admin/products/reorder', { ids })
        ElMessage.success('排序已保存')
        await load()
        if (sortMode.value) initSortable()
      } catch {
        /* handled */
      }
    }
  })
}

function toggleSortMode() {
  if (sortMode.value) {
    sortMode.value = false
    destroySortable()
    return
  }
  if (!canSort.value) {
    ElMessage.warning('请先切换到「销售中」Tab 并清空筛选条件')
    return
  }
  sortMode.value = true
  initSortable()
}

watch([sortMode, () => filteredList.value.length], () => {
  if (sortMode.value) initSortable()
})

onBeforeUnmount(() => destroySortable())
</script>

<style scoped>
.import-bar { margin-bottom: 12px; }
.filter-form :deep(.el-form-item) { margin-bottom: 8px; }
.toolbar-left { display: flex; flex-wrap: wrap; gap: 8px; }
.toolbar-right { margin-left: auto; }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); }
.sort-hint { font-size: 13px; color: rgba(0,0,0,0.55); margin: 0; padding: 8px 0; }
.drag-handle { color: #999; }
.name-row { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
.name-link { color: var(--el-color-primary); cursor: pointer; }
.sub-info { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 2px; }
.no-img { font-size: 12px; color: #ccc; }
.sku-editor, .param-editor { width: 100%; }
.sku-row, .param-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.cat-add { display: flex; align-items: center; gap: 8px; }
</style>
