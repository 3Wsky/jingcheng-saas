<template>
  <PageShell>
    <template #tabs>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane :label="`销售中(${summary.shownCount})`" name="shown" />
        <el-tab-pane :label="`仓库中(${summary.hiddenCount})`" name="hidden" />
        <el-tab-pane label="全部" name="all" />
      </el-tabs>
    </template>

    <template #filter>
      <el-form :inline="true" class="filter-form" @submit.prevent="search">
        <el-form-item label="商品搜索">
          <el-input v-model="keyword" placeholder="名称/ID" clearable style="width: 220px" />
        </el-form-item>
        <el-form-item label="上架状态">
          <el-select v-model="showFilter" clearable placeholder="全部" style="width: 120px">
            <el-option label="上架" value="yes" />
            <el-option label="下架" value="no" />
          </el-select>
        </el-form-item>
        <template v-if="filterExpanded">
          <el-form-item label="关联商品">
            <el-input v-model="productIdFilter" placeholder="CRMEB product_id" clearable style="width: 140px" />
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
        <el-button type="primary" @click="goCreate">添加商品</el-button>
        <el-button type="success" @click="collectOpen = true">商品采集</el-button>
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
        <span class="hint">积分核销 · 本地自提 · 无物流</span>
      </div>
    </template>

    <el-table ref="tableRef" :data="displayList" v-loading="loading" row-key="id" :row-class-name="rowClassName" @selection-change="onSelect">
      <template #empty>
        <el-empty description="暂无积分商品">
          <el-button type="primary" @click="goCreate">添加商品</el-button>
        </el-empty>
      </template>
      <el-table-column v-if="sortMode" label="" width="48" align="center">
        <template #default>
          <el-icon class="drag-handle" style="cursor: grab"><Rank /></el-icon>
        </template>
      </el-table-column>
      <el-table-column type="selection" width="48" />
      <el-table-column prop="id" label="ID" width="64" />
      <el-table-column label="商品图" width="72" align="center">
        <template #default="{ row }">
          <el-image v-if="row.image" :src="row.image" :preview-src-list="[row.image]" style="width:40px;height:40px" fit="cover" />
          <span v-else class="no-img">无图</span>
        </template>
      </el-table-column>
      <el-table-column label="商品名称" min-width="180">
        <template #default="{ row }">
          <div class="name-row">
            <el-tag v-if="row.isHost" size="small" type="danger" effect="plain">热门</el-tag>
            <span class="name-link" @click="goEdit(row.id)">{{ row.title }}</span>
          </div>
          <div v-if="row.productId" class="sub-info">关联商品 #{{ row.productId }}</div>
        </template>
      </el-table-column>
      <el-table-column label="兑换积分" width="100" align="right">
        <template #default="{ row }">{{ formatNum(row.price) }}</template>
      </el-table-column>
      <el-table-column label="库存" width="100" align="right">
        <template #default="{ row }">
          <el-link :type="row.stock <= 5 ? 'warning' : 'primary'" :underline="false" @click="openStock(row)">
            {{ row.stock }}
            <span v-if="row.stock <= 5" class="low-stock-tag">低</span>
          </el-link>
        </template>
      </el-table-column>
      <el-table-column prop="sales" label="销量" width="72" align="right" />
      <el-table-column label="限购" width="88" align="center">
        <template #default="{ row }">{{ row.onceNum }}/{{ row.num || '∞' }}</template>
      </el-table-column>
      <el-table-column prop="sort" label="排序" width="64" align="center" />
      <el-table-column label="状态" width="88" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isShow ? 'success' : 'info'" size="small">{{ row.isShow ? '销售中' : '仓库' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="goEdit(row.id)">编辑</el-button>
          <el-button link type="primary" @click="toggleShow(row)">{{ row.isShow ? '下架' : '上架' }}</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-if="!sortMode"
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filteredTotal"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="syncPage"
        @size-change="onSizeChange"
      />
      <p v-else class="sort-hint">拖拽左侧手柄调整「销售中」商品顺序，完成后点击「完成排序」</p>
    </template>
  </PageShell>

  <ProductCollectDialog v-model="collectOpen" mode="integral" @success="load" />

  <el-dialog v-model="stockOpen" title="修改库存" width="360px">
    <el-form label-width="72px">
      <el-form-item label="商品">{{ stockRow?.title }}</el-form-item>
      <el-form-item label="库存">
        <el-input-number v-model="stockValue" :min="0" style="width: 100%" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="stockOpen = false">取消</el-button>
      <el-button type="primary" :loading="stockSaving" @click="saveStock">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import { ArrowDown, Rank } from '@element-plus/icons-vue'
import Sortable from 'sortablejs'
import PageShell from '@/components/PageShell.vue'
import ProductCollectDialog from '@/components/ProductCollectDialog.vue'
import { downloadCsv } from '@/utils/csvExport'

const router = useRouter()
const loading = ref(false)
const allList = ref<any[]>([])
const summary = ref({ shownCount: 0, hiddenCount: 0 })
const activeTab = ref('shown')
const keyword = ref('')
const showFilter = ref('')
const productIdFilter = ref('')
const filterExpanded = ref(false)
const selected = ref<any[]>([])
const collectOpen = ref(false)
const stockOpen = ref(false)
const stockRow = ref<any>(null)
const stockValue = ref(0)
const stockSaving = ref(false)
const page = ref(1)
const pageSize = ref(20)
const sortMode = ref(false)
const tableRef = ref<any>(null)
let sortable: Sortable | null = null

const canSort = computed(() =>
  activeTab.value === 'shown' &&
  !keyword.value &&
  !showFilter.value &&
  !productIdFilter.value
)

const filteredList = computed(() => {
  let rows = allList.value
  if (activeTab.value === 'shown') rows = rows.filter((r) => r.isShow)
  else if (activeTab.value === 'hidden') rows = rows.filter((r) => !r.isShow)
  if (keyword.value) {
    const k = keyword.value.toLowerCase()
    rows = rows.filter((r) => String(r.title || '').toLowerCase().includes(k) || String(r.id) === k)
  }
  if (showFilter.value === 'yes') rows = rows.filter((r) => r.isShow)
  else if (showFilter.value === 'no') rows = rows.filter((r) => !r.isShow)
  if (productIdFilter.value) rows = rows.filter((r) => String(r.productId) === productIdFilter.value.trim())
  return rows
})

const filteredTotal = computed(() => filteredList.value.length)
const displayList = computed(() => {
  if (sortMode.value) return filteredList.value
  const start = (page.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

onMounted(() => load())

function rowClassName({ row }: { row: any }) {
  return row.stock <= 5 && row.isShow ? 'low-stock-row' : ''
}

function formatNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0'
}

async function load() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/integral-mall/products', {
      params: { page: 1, pageSize: 500, status: 'all' }
    })
    allList.value = data?.list || []
    summary.value = data?.summary || { shownCount: 0, hiddenCount: 0 }
  } catch {
    allList.value = []
  } finally {
    loading.value = false
  }
}

function syncPage() {}
function onTabChange() { page.value = 1 }
function onSizeChange() { page.value = 1 }
function search() { page.value = 1 }
function reset() {
  keyword.value = ''
  showFilter.value = ''
  productIdFilter.value = ''
  activeTab.value = 'shown'
  search()
}

function onSelect(rows: any[]) { selected.value = rows }
function goCreate() { router.push('/integral-mall/edit') }
function goEdit(id: number) { router.push(`/integral-mall/edit/${id}`) }

function openStock(row: any) {
  stockRow.value = row
  stockValue.value = row.stock
  stockOpen.value = true
}

async function saveStock() {
  if (!stockRow.value) return
  stockSaving.value = true
  try {
    await request.patch(`/api/admin/integral-mall/products/${stockRow.value.id}/stock`, { stock: stockValue.value })
    ElMessage.success('库存已更新')
    stockOpen.value = false
    load()
  } catch { /* handled */ }
  finally { stockSaving.value = false }
}

async function toggleShow(row: any) {
  try {
    await request.put(`/api/admin/integral-mall/products/${row.id}`, { isShow: !row.isShow })
    ElMessage.success('状态已更新')
    load()
  } catch { /* handled */ }
}

async function batchShow(isShow: boolean) {
  if (!selected.value.length) return
  try {
    await request.patch('/api/admin/integral-mall/products/batch-show', {
      ids: selected.value.map((r) => r.id),
      isShow
    })
    ElMessage.success(`已更新 ${selected.value.length} 个商品`)
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
    'integral-mall-products.csv',
    ['ID', '商品名称', '关联商品ID', '兑换积分', '库存', '销量', '限购', '排序', '状态'],
    rows.map((r) => [
      r.id,
      r.title || '',
      r.productId || '',
      r.price ?? 0,
      r.stock ?? 0,
      r.sales ?? 0,
      `${r.onceNum || 0}/${r.num || '∞'}`,
      r.sort ?? 0,
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
        await request.patch('/api/admin/integral-mall/products/reorder', { ids })
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
.filter-form :deep(.el-form-item) { margin-bottom: 8px; }
.toolbar-left { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.toolbar-right { margin-left: auto; }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); }
.sort-hint { font-size: 13px; color: rgba(0,0,0,0.55); margin: 0; padding: 8px 0; }
.drag-handle { color: #999; }
.name-link { color: var(--el-color-primary); cursor: pointer; }
.name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.sub-info { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 2px; }
.no-img { font-size: 12px; color: #ccc; }
.low-stock-tag { margin-left: 4px; font-size: 11px; color: #d97706; }
:deep(.low-stock-row) { background-color: #fffbeb !important; }
</style>
