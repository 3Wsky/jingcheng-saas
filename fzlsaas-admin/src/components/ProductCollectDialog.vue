<template>
  <el-dialog v-model="visible" :title="title" width="720px" destroy-on-close @closed="reset">
    <el-tabs v-model="activeTab">
      <!-- 展示商品：价签 -->
      <el-tab-pane v-if="mode === 'showcase'" label="价签采集" name="priceTag">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
          从 digital-price-tag-generator 价签 JSON 同步展示商品（只读展示，不支持发货）。
        </el-alert>
        <el-form label-width="88px">
          <el-form-item label="采集范围">
            <el-checkbox-group v-model="selectedSources">
              <el-checkbox value="phone">手机价签</el-checkbox>
              <el-checkbox value="dji">DJI 价签</el-checkbox>
            </el-checkbox-group>
            <p class="hint">可只采集手机或 DJI，避免无关品类混入</p>
          </el-form-item>
          <el-form-item label="品牌筛选">
            <div class="brand-toolbar">
              <el-button link type="primary" @click="selectAllBrands">全选</el-button>
              <el-button link type="primary" @click="clearBrands">清空</el-button>
              <span v-if="brandPreviewLoading" class="hint">加载品牌列表…</span>
            </div>
            <el-checkbox-group v-model="selectedBrands">
              <el-checkbox v-for="b in brandOptions" :key="b.name" :value="b.name">
                {{ b.name }}<span v-if="b.count" class="brand-count">（{{ b.count }}）</span>
              </el-checkbox>
            </el-checkbox-group>
            <p class="hint">不勾选品牌则导入所选范围内的全部商品；勾选后仅采集对应品牌</p>
          </el-form-item>
          <el-form-item label="导入后">
            <el-radio-group v-model="importShow">
              <el-radio :value="true">默认上架展示</el-radio>
              <el-radio :value="false">放入仓库</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 展示商品：官网采集（含图片） -->
      <el-tab-pane v-if="mode === 'showcase'" label="官网采集(含图)" name="official">
        <el-alert type="success" :closable="false" show-icon style="margin-bottom: 12px">
          输入型号，从品牌官网采集 <strong>商品图 / 颜色对应图 / 配置价格 / 详情图</strong> 并自动建商品。当前支持 <strong>华为</strong>（vmall）。
        </el-alert>
        <el-form label-width="88px">
          <el-form-item label="型号清单">
            <el-input
              v-model="officialModels"
              type="textarea"
              :rows="5"
              placeholder="每行一个型号，例如：
华为 Mate 80 Pro Max
华为 Pura 80 Pro"
            />
            <p class="hint">每行一个，最多 8 个；官网采集较慢（每个约 20–30 秒），提交后请耐心等待</p>
          </el-form-item>
          <el-form-item label="导入后">
            <el-radio-group v-model="importShow">
              <el-radio :value="true">默认上架展示</el-radio>
              <el-radio :value="false">放入仓库</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 展示商品：CSV -->
      <el-tab-pane v-if="mode === 'showcase'" label="CSV导入" name="csv">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
          上传价签/Excel 导出的 CSV，按商品名称幂等合并。列：商品名称、品牌、售价、简介、主图、来源链接、型号。
        </el-alert>
        <div class="csv-toolbar">
          <el-button link type="primary" @click="downloadCsvTemplate">下载模板</el-button>
          <span v-if="csvFileName" class="hint">已选：{{ csvFileName }}</span>
        </div>
        <el-upload
          drag
          accept=".csv,text/csv"
          :auto-upload="false"
          :show-file-list="false"
          :on-change="onCsvFileChange"
        >
          <div class="el-upload__text">拖拽 CSV 到此处，或 <em>点击选择</em></div>
        </el-upload>
        <el-form label-width="88px" style="margin-top: 12px">
          <el-form-item label="导入后">
            <el-radio-group v-model="importShow">
              <el-radio :value="true">默认上架展示</el-radio>
              <el-radio :value="false">放入仓库</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 展示商品：CRMEB -->
      <el-tab-pane v-if="mode === 'showcase'" label="CRMEB商品" name="crmeb">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
          从旧程序 eb_store_product 批量导入展示商品，按商品 ID 幂等合并。
        </el-alert>
        <el-form :inline="true" @submit.prevent="searchCrmeb">
          <el-form-item label="搜索">
            <el-input v-model="crmebKeyword" placeholder="名称/ID" clearable style="width: 200px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="searchCrmeb">查询</el-button>
            <el-button link type="primary" @click="selectAllCrmebPage">全选本页</el-button>
          </el-form-item>
        </el-form>
        <el-table
          ref="crmebTableRef"
          :data="crmebList"
          v-loading="crmebLoading"
          height="280"
          @selection-change="onCrmebSelect"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column prop="id" label="ID" width="64" />
          <el-table-column prop="storeName" label="商品名称" min-width="180" show-overflow-tooltip />
          <el-table-column label="售价" width="88" align="right">
            <template #default="{ row }">¥{{ row.price }}</template>
          </el-table-column>
        </el-table>
        <div class="pager">
          <el-pagination
            v-model:current-page="crmebPage"
            :page-size="crmebPageSize"
            :total="crmebTotal"
            layout="total, prev, pager, next"
            @current-change="loadCrmeb"
          />
        </div>
        <el-form label-width="88px" style="margin-top: 12px">
          <el-form-item label="导入后">
            <el-radio-group v-model="importShow">
              <el-radio :value="true">默认上架</el-radio>
              <el-radio :value="false">放入仓库</el-radio>
            </el-radio-group>
          </el-form-item>
        </el-form>
        <p v-if="selectedCrmebIds.length" class="hint">已选 {{ selectedCrmebIds.length }} 件</p>
      </el-tab-pane>

      <!-- 展示商品：链接 -->
      <el-tab-pane v-if="mode === 'showcase'" label="链接采集" name="url">
        <el-form label-width="88px">
          <el-form-item label="商品链接">
            <el-input v-model="collectUrl" placeholder="https://..." />
          </el-form-item>
          <el-form-item label="平台">
            <el-select v-model="platform" style="width: 100%">
              <el-option label="淘宝/天猫" value="taobao" />
              <el-option label="京东" value="jd" />
              <el-option label="拼多多" value="pdd" />
              <el-option label="其他" value="other" />
            </el-select>
          </el-form-item>
        </el-form>
        <el-alert type="warning" :closable="false" title="链接解析下一版接入，当前可先使用价签/CRMEB 采集" />
      </el-tab-pane>

      <!-- 积分：仅已上架展示商品 -->
      <el-tab-pane v-if="mode === 'integral'" label="展示商品" name="showcase">
        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
          批量从已上架展示商品导入积分商城；如需<strong>独立上架</strong>，请点「添加商品」→ 选择「手动创建」。
        </el-alert>
        <el-form :inline="true" @submit.prevent="loadShowcase">
          <el-form-item label="品牌">
            <el-select v-model="showcaseBrand" clearable placeholder="全部" style="width: 120px" @change="loadShowcase">
              <el-option v-for="b in showcaseBrandOptions" :key="b" :label="b" :value="b" />
            </el-select>
          </el-form-item>
          <el-form-item label="搜索">
            <el-input v-model="showcaseKeyword" placeholder="名称" clearable style="width: 180px" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="loadShowcase">刷新</el-button>
            <el-button link type="primary" @click="selectAllShowcase">全选列表</el-button>
          </el-form-item>
        </el-form>
        <el-table
          ref="showcaseTableRef"
          :data="filteredShowcase"
          height="300"
          @selection-change="onShowcaseSelect"
        >
          <el-table-column type="selection" width="42" />
          <el-table-column prop="brand" label="品牌" width="72" />
          <el-table-column prop="storeName" label="商品名称" min-width="200" show-overflow-tooltip />
          <el-table-column label="售价" width="88" align="right">
            <template #default="{ row }">¥{{ row.price }}</template>
          </el-table-column>
          <el-table-column label="来源" width="80">
            <template #default="{ row }">{{ sourceLabel(row.source) }}</template>
          </el-table-column>
        </el-table>
        <p class="hint">导入后默认放入积分仓库，积分价 = max(1000, 售价×10)，可在编辑页调整。</p>
        <p v-if="selectedShowcaseIds.length" class="hint">已选 {{ selectedShowcaseIds.length }} 件</p>
      </el-tab-pane>
    </el-tabs>

    <div v-if="mode === 'showcase' && activeTab !== 'url'" class="collect-category">
      <span class="cat-label">导入到分类</span>
      <el-select
        v-model="importCategoryId"
        placeholder="不指定（保持/未分类）"
        clearable
        size="small"
        style="width: 220px"
      >
        <el-option v-for="c in categoryOptions" :key="c.id" :label="c.name" :value="c.id" />
      </el-select>
      <span class="hint">采集的商品将归入该分类，可留空</span>
    </div>

    <div v-if="result" class="collect-result">
      <template v-if="result.createdCount != null || result.updatedCount != null">
        <p>新增 {{ result.createdCount ?? 0 }} / 更新 {{ result.updatedCount ?? 0 }}</p>
        <p v-if="result.brands?.length" class="muted">品牌：{{ result.brands.join('、') }}</p>
        <p v-if="result.files?.length" class="muted">
          文件：{{ result.files.map((f: any) => f.fileName).join('、') }}
        </p>
        <p v-if="result.sourceLabel" class="muted">来源：{{ result.sourceLabel }}</p>
      </template>
      <template v-else-if="result.skippedCount != null">
        <p>新增 {{ result.createdCount ?? 0 }} · 跳过 {{ result.skippedCount ?? 0 }}</p>
      </template>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="loading" @click="submit">
        {{ submitLabel }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import { downloadCsv } from '@/utils/csvExport'

const BRAND_OPTIONS = ['华为', '荣耀', '小米', 'iQOO', 'vivo', 'OPPO', 'Apple', 'DJI', '数码']

type BrandOption = { name: string; count?: number }

const props = defineProps<{
  modelValue: boolean
  mode: 'showcase' | 'integral'
}>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; success: [] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const title = computed(() => (props.mode === 'showcase' ? '商品采集' : '积分商品采集'))
const activeTab = ref('priceTag')
const importShow = ref(true)
const collectUrl = ref('')
const officialModels = ref('')
const platform = ref('taobao')
const loading = ref(false)
const result = ref<any>(null)

const brandOptions = ref<BrandOption[]>(BRAND_OPTIONS.map((name) => ({ name })))
const showcaseBrandOptions = ref<string[]>([...BRAND_OPTIONS])
const selectedBrands = ref<string[]>([])
const selectedSources = ref<Array<'phone' | 'dji'>>(['phone', 'dji'])
const brandPreviewLoading = ref(false)

const showcaseList = ref<any[]>([])
const showcaseKeyword = ref('')
const showcaseBrand = ref('')
const selectedShowcaseIds = ref<string[]>([])
const showcaseTableRef = ref()

const crmebList = ref<any[]>([])
const crmebLoading = ref(false)
const crmebKeyword = ref('')
const crmebPage = ref(1)
const crmebPageSize = 20
const crmebTotal = ref(0)
const selectedCrmebIds = ref<number[]>([])
const crmebTableRef = ref()
const csvContent = ref('')
const csvFileName = ref('')

const importCategoryId = ref('')
const categoryOptions = ref<any[]>([])

const filteredShowcase = computed(() => {
  const kw = showcaseKeyword.value.trim().toLowerCase()
  if (!kw) return showcaseList.value
  return showcaseList.value.filter((p) =>
    String(p.storeName || '').toLowerCase().includes(kw)
  )
})

const submitLabel = computed(() => {
  if (activeTab.value === 'official') return '开始官网采集'
  if (activeTab.value === 'url') return '提交采集'
  if (activeTab.value === 'csv') return csvContent.value ? '导入 CSV' : '导入 CSV'
  if (activeTab.value === 'crmeb') return selectedCrmebIds.value.length ? `导入 ${selectedCrmebIds.value.length} 件` : '导入所选'
  if (activeTab.value === 'showcase' && props.mode === 'integral') {
    return selectedShowcaseIds.value.length ? `导入 ${selectedShowcaseIds.value.length} 件` : '导入所选'
  }
  return '开始采集'
})

watch(() => props.modelValue, (open) => {
  if (!open) return
  result.value = null
  if (props.mode === 'integral') {
    activeTab.value = 'showcase'
    loadShowcase()
  } else {
    activeTab.value = 'priceTag'
    loadBrandPreview()
    loadCategories()
  }
})

watch(activeTab, (tab) => {
  if (tab === 'crmeb' && !crmebList.value.length) loadCrmeb()
  if (tab === 'priceTag' && props.mode === 'showcase') loadBrandPreview()
})

watch(selectedSources, () => {
  if (props.modelValue && props.mode === 'showcase' && activeTab.value === 'priceTag') {
    loadBrandPreview()
  }
}, { deep: true })

function sourceLabel(s: string) {
  const map: Record<string, string> = {
    crmeb: 'CRMEB',
    official: '价签',
    dji: 'DJI',
    csv: 'CSV'
  }
  return map[s] || s || '-'
}

async function downloadCsvTemplate() {
  downloadCsv(
    'products-import-template.csv',
    ['商品名称', '品牌', '售价', '简介', '主图', '来源链接', '型号'],
    [['华为 Mate 70 Pro', '华为', '6999', '旗舰手机', '', '', '']]
  )
}

function onCsvFileChange(uploadFile: { raw?: File }) {
  const file = uploadFile?.raw
  if (!file) return
  csvFileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    csvContent.value = String(reader.result || '')
  }
  reader.readAsText(file, 'UTF-8')
}

async function loadCategories() {
  try {
    categoryOptions.value = await request.get('/api/admin/product-categories')
  } catch {
    categoryOptions.value = []
  }
}

async function loadBrandPreview() {
  brandPreviewLoading.value = true
  try {
    const data = await request.get('/api/admin/products/collect/preview', {
      params: {
        sources: selectedSources.value.length ? selectedSources.value.join(',') : undefined
      }
    })
    const list = Array.isArray(data?.brandList) ? data.brandList : []
    brandOptions.value = list.length
      ? list.map((item: any) => ({ name: item.name || item, count: item.count }))
      : BRAND_OPTIONS.map((name) => ({ name }))
  } catch {
    brandOptions.value = BRAND_OPTIONS.map((name) => ({ name }))
  } finally {
    brandPreviewLoading.value = false
  }
}

function selectAllBrands() {
  selectedBrands.value = brandOptions.value.map((b) => b.name)
}

function clearBrands() {
  selectedBrands.value = []
}

async function loadShowcase() {
  try {
    const data = await request.get('/api/admin/products', {
      params: {
        status: 'shown',
        brand: showcaseBrand.value || undefined
      }
    })
    showcaseList.value = data?.list || []
    if (Array.isArray(data?.summary?.brandList) && data.summary.brandList.length) {
      showcaseBrandOptions.value = data.summary.brandList
    }
  } catch {
    showcaseList.value = []
  }
}

async function loadCrmeb() {
  crmebLoading.value = true
  try {
    const data = await request.get('/api/admin/crmeb-products', {
      params: { page: crmebPage.value, pageSize: crmebPageSize, keyword: crmebKeyword.value || undefined }
    })
    crmebList.value = data?.list || []
    crmebTotal.value = data?.total || 0
  } catch {
    crmebList.value = []
  } finally {
    crmebLoading.value = false
  }
}

function searchCrmeb() {
  crmebPage.value = 1
  loadCrmeb()
}

function onCrmebSelect(rows: any[]) {
  selectedCrmebIds.value = rows.map((r) => Number(r.id)).filter(Boolean)
}

function onShowcaseSelect(rows: any[]) {
  selectedShowcaseIds.value = rows.map((r) => String(r.id))
}

function selectAllCrmebPage() {
  crmebTableRef.value?.toggleAllSelection?.()
}

function selectAllShowcase() {
  showcaseTableRef.value?.toggleAllSelection?.()
}

function reset() {
  collectUrl.value = ''
  officialModels.value = ''
  selectedShowcaseIds.value = []
  selectedCrmebIds.value = []
  selectedBrands.value = []
  selectedSources.value = ['phone', 'dji']
  result.value = null
  loading.value = false
  showcaseKeyword.value = ''
  showcaseBrand.value = ''
  crmebKeyword.value = ''
  csvContent.value = ''
  csvFileName.value = ''
  importCategoryId.value = ''
}

async function submit() {
  loading.value = true
  try {
    if (activeTab.value === 'official') {
      const models = officialModels.value.split('\n').map((s) => s.trim()).filter(Boolean)
      if (!models.length) {
        ElMessage.warning('请至少输入一个型号')
        return
      }
      if (models.length > 8) {
        ElMessage.warning('一次最多采集 8 个型号')
        return
      }
      result.value = await request.post('/api/admin/products/collect-from-official', {
        models,
        isShow: importShow.value,
        categoryId: importCategoryId.value || undefined
      }, { timeout: 600000 })
      ElMessage.success(`官网采集完成：新增 ${result.value?.createdCount ?? 0} / 更新 ${result.value?.updatedCount ?? 0}`)
      emit('success')
      return
    }

    if (activeTab.value === 'priceTag') {
      if (!selectedSources.value.length) {
        ElMessage.warning('请至少选择一种采集范围')
        return
      }
      const brands = selectedBrands.value.filter(Boolean)
      result.value = await request.post('/api/admin/products/collect', {
        isShow: importShow.value,
        brands: brands.length ? brands : undefined,
        sources: selectedSources.value,
        categoryId: importCategoryId.value || undefined
      })
      const scope = selectedSources.value.map((s) => (s === 'phone' ? '手机' : 'DJI')).join('+')
      ElMessage.success(brands.length ? `价签采集完成（${scope} · ${brands.join('、')}）` : `价签采集完成（${scope}）`)
      emit('success')
      return
    }

    if (activeTab.value === 'csv') {
      if (!csvContent.value.trim()) {
        ElMessage.warning('请先选择 CSV 文件')
        return
      }
      result.value = await request.post('/api/admin/products/import-csv', {
        csv: csvContent.value,
        fileName: csvFileName.value || 'products.csv',
        isShow: importShow.value,
        categoryId: importCategoryId.value || undefined
      })
      ElMessage.success(`CSV 导入完成：新增 ${result.value?.createdCount ?? 0} / 更新 ${result.value?.updatedCount ?? 0}`)
      emit('success')
      return
    }

    if (activeTab.value === 'crmeb') {
      if (!selectedCrmebIds.value.length) {
        ElMessage.warning('请勾选 CRMEB 商品')
        return
      }
      result.value = await request.post('/api/admin/products/collect-from-crmeb', {
        ids: selectedCrmebIds.value,
        isShow: importShow.value,
        categoryId: importCategoryId.value || undefined
      })
      ElMessage.success(result.value?.message || '导入完成')
      emit('success')
      return
    }

    if (activeTab.value === 'showcase' && props.mode === 'integral') {
      if (!selectedShowcaseIds.value.length) {
        ElMessage.warning('请勾选已上架展示商品')
        return
      }
      result.value = await request.post('/api/admin/integral-mall/products/collect-batch-showcase', {
        showcaseIds: selectedShowcaseIds.value
      })
      ElMessage.success(`导入完成：新增 ${result.value?.createdCount ?? 0}`)
      emit('success')
      return
    }

    const url = collectUrl.value.trim()
    if (!url) {
      ElMessage.warning('请输入商品链接')
      return
    }
    const data = await request.post('/api/admin/products/collect-url', { url, platform: platform.value })
    ElMessage.info(data?.message || '已提交，解析能力下一版接入')
  } catch { /* handled */ }
  finally { loading.value = false }
}
</script>

<style scoped>
.collect-category { display: flex; align-items: center; gap: 10px; margin-top: 4px; padding: 10px 12px; background: #f5f7fa; border-radius: 6px; }
.cat-label { font-size: 13px; color: rgba(0,0,0,0.65); }
.collect-result { font-size: 13px; margin-top: 12px; padding: 8px 12px; background: #f6ffed; border-radius: 6px; }
.muted { color: rgba(0,0,0,0.45); }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 8px; }
.brand-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.csv-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
.brand-count { color: rgba(0,0,0,0.35); font-size: 12px; }
.pager { margin-top: 8px; display: flex; justify-content: flex-end; }
</style>
