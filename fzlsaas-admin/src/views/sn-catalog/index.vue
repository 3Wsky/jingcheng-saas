<template>
  <PageShell title="SN 产品库" subtitle="SN 码 → 型号 / 价格 映射，供小程序拍照识别后自动回填；无数据时由店员手动输入">
    <template #actions>
      <el-space wrap :size="10">
        <el-tag type="info" effect="plain">共 {{ total }} 条</el-tag>
        <el-button @click="downloadTemplate">下载导入模板</el-button>
        <el-upload
          :show-file-list="false"
          accept=".csv,text/csv"
          :before-upload="handleCsvImport"
        >
          <el-button type="primary" icon="Upload">导入 CSV</el-button>
        </el-upload>
        <el-button icon="Plus" @click="openAdd">新增</el-button>
      </el-space>
    </template>

    <template #filter>
      <el-form :inline="true" @submit.prevent="reload(1)">
        <el-form-item label="搜索">
          <el-input
            v-model="keyword"
            placeholder="SN / 型号 / 品牌"
            clearable
            style="width: 260px"
            @keyup.enter="reload(1)"
            @clear="reload(1)"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="reload(1)">查询</el-button>
          <el-button @click="resetSearch">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="list" v-loading="loading" size="small">
      <template #empty>
        <el-empty description="暂无 SN 数据，可点右上角「导入 CSV」批量导入">
          <el-button type="primary" @click="downloadTemplate">下载导入模板</el-button>
        </el-empty>
      </template>
      <el-table-column prop="snCode" label="SN 码" min-width="180">
        <template #default="{ row }"><span class="mono">{{ row.snCode }}</span></template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="120">
        <template #default="{ row }">{{ row.brand || '—' }}</template>
      </el-table-column>
      <el-table-column prop="model" label="型号" min-width="160">
        <template #default="{ row }">{{ row.model || '—' }}</template>
      </el-table-column>
      <el-table-column prop="price" label="价格" width="110" align="right">
        <template #default="{ row }">¥{{ formatMoney(row.price) }}</template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="140">
        <template #default="{ row }">{{ row.remark || '—' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" align="center" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" size="small" @click="removeRow(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        layout="total, prev, pager, next, jumper"
        :total="total"
        :current-page="page"
        :page-size="pageSize"
        @current-change="reload"
      />
    </template>
  </PageShell>

  <el-dialog v-model="formOpen" :title="editing ? '编辑 SN' : '新增 SN'" width="440px">
    <el-form :model="form" label-width="72px">
      <el-form-item label="SN 码" required>
        <el-input v-model="form.snCode" placeholder="设备序列号 SN" :disabled="editing" />
      </el-form-item>
      <el-form-item label="品牌">
        <el-input v-model="form.brand" placeholder="如 华为 / vivo" />
      </el-form-item>
      <el-form-item label="型号">
        <el-input v-model="form.model" placeholder="如 Mate80 / X300S" />
      </el-form-item>
      <el-form-item label="价格">
        <el-input-number v-model="form.price" :min="0" :precision="2" :step="100" controls-position="right" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="form.remark" placeholder="选填" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="formOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="importOpen" title="导入结果" width="420px">
    <el-result
      :icon="importResult.processed ? 'success' : 'warning'"
      :title="`处理 ${importResult.processed || 0} 条`"
      :sub-title="`共读取 ${importResult.total || 0} 行，跳过 ${importResult.skipped || 0} 行（空 SN 或重复）`"
    />
    <template #footer>
      <el-button type="primary" @click="importOpen = false">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface SnRow {
  id: number
  snCode: string
  brand: string
  model: string
  price: number
  remark: string
}

const loading = ref(false)
const list = ref<SnRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')

const formOpen = ref(false)
const editing = ref(false)
const saving = ref(false)
const form = ref<{ snCode: string; brand: string; model: string; price: number; remark: string }>({
  snCode: '', brand: '', model: '', price: 0, remark: ''
})

const importOpen = ref(false)
const importResult = ref<{ processed?: number; total?: number; skipped?: number }>({})

onMounted(() => reload(1))

function formatMoney(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

async function reload(p = 1) {
  page.value = p
  loading.value = true
  try {
    const data = await request.get('/api/admin/sn-catalog', {
      params: { page: p, pageSize, keyword: keyword.value.trim() || undefined }
    })
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function resetSearch() {
  keyword.value = ''
  reload(1)
}

function openAdd() {
  editing.value = false
  form.value = { snCode: '', brand: '', model: '', price: 0, remark: '' }
  formOpen.value = true
}

function openEdit(row: SnRow) {
  editing.value = true
  form.value = { snCode: row.snCode, brand: row.brand, model: row.model, price: Number(row.price || 0), remark: row.remark }
  formOpen.value = true
}

async function save() {
  if (!form.value.snCode.trim()) {
    ElMessage.warning('请输入 SN 码')
    return
  }
  saving.value = true
  try {
    await request.post('/api/admin/sn-catalog', { ...form.value })
    ElMessage.success('已保存')
    formOpen.value = false
    reload(page.value)
  } catch { /* handled */ } finally {
    saving.value = false
  }
}

async function removeRow(row: SnRow) {
  try {
    await ElMessageBox.confirm(`确认删除 SN「${row.snCode}」？`, '删除', { type: 'warning' })
    await request.delete(`/api/admin/sn-catalog/${row.id}`)
    ElMessage.success('已删除')
    reload(page.value)
  } catch { /* cancel */ }
}

function downloadTemplate() {
  const bom = '\ufeff'
  const content = bom + 'SN,品牌,型号,价格,备注\nSN123456789,华为,Mate80,5199,示例行（导入时可删除）\n'
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'sn-catalog-template.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/** 简易 CSV 解析（支持引号包裹与逗号转义） */
function parseCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else { inQuotes = false }
      } else { cur += ch }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      out.push(cur); cur = ''
    } else {
      cur += ch
    }
  }
  out.push(cur)
  return out
}

const SN_KEYS = ['sn', 'sn码', 'sn 码', '序列号', '序列號', 'serial', 'serialno', 'imei/sn', 'sncode']
const BRAND_KEYS = ['品牌', 'brand']
const MODEL_KEYS = ['型号', '型號', '规格', '规格型号', 'model', '商品名称', '货品名称', '存货名称', '商品', '名称']
const PRICE_KEYS = ['价格', '单价', '售价', '零售价', '金额', 'price', '销售单价']
const REMARK_KEYS = ['备注', 'remark', '说明']

function matchIdx(headers: string[], keys: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase().replace(/\s+/g, '')
    if (keys.some((k) => h === k.toLowerCase().replace(/\s+/g, ''))) return i
  }
  // 退化：包含匹配
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase().replace(/\s+/g, '')
    if (keys.some((k) => h.includes(k.toLowerCase().replace(/\s+/g, '')))) return i
  }
  return -1
}

async function handleCsvImport(file: File) {
  try {
    let text = await file.text()
    text = text.replace(/^\ufeff/, '')
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length)
    if (lines.length < 2) {
      ElMessage.warning('CSV 没有数据行')
      return false
    }
    const headers = parseCsvLine(lines[0])
    const snIdx = matchIdx(headers, SN_KEYS)
    if (snIdx < 0) {
      ElMessage.error('未找到 SN 列（表头需含 SN / 序列号），请用「下载导入模板」参考')
      return false
    }
    const brandIdx = matchIdx(headers, BRAND_KEYS)
    const modelIdx = matchIdx(headers, MODEL_KEYS)
    const priceIdx = matchIdx(headers, PRICE_KEYS)
    const remarkIdx = matchIdx(headers, REMARK_KEYS)

    const items: any[] = []
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i])
      const snCode = (cols[snIdx] || '').trim()
      if (!snCode) continue
      const priceRaw = priceIdx >= 0 ? (cols[priceIdx] || '').replace(/[¥￥,\s]/g, '') : ''
      items.push({
        snCode,
        brand: brandIdx >= 0 ? (cols[brandIdx] || '').trim() : '',
        model: modelIdx >= 0 ? (cols[modelIdx] || '').trim() : '',
        price: priceRaw && !isNaN(Number(priceRaw)) ? Number(priceRaw) : 0,
        remark: remarkIdx >= 0 ? (cols[remarkIdx] || '').trim() : ''
      })
    }
    if (!items.length) {
      ElMessage.warning('没有解析到有效的 SN 行')
      return false
    }

    const data = await request.post('/api/admin/sn-catalog/import', { items })
    importResult.value = { ...data, total: data?.total ?? items.length }
    importOpen.value = true
    reload(1)
  } catch (e: any) {
    ElMessage.error(e?.message || '导入失败')
  }
  return false
}
</script>

<style scoped>
.mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
</style>
