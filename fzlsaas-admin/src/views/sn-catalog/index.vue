<template>
  <PageShell title="SN 产品库" subtitle="IMEI1 / SN → 型号 映射；手机按 IMEI1 核对、其它按 SN 核对，供小程序识别后自动回填与终审自动通过">
    <template #actions>
      <el-space wrap :size="10">
        <el-tag type="info" effect="plain">共 {{ total }} 条</el-tag>
        <el-tooltip
          content="整库替换：清空后写入本次全量（推荐每次上传最新导出）。关闭则为增量追加，按 IMEI1 去重更新。"
          placement="bottom"
        >
          <el-switch
            v-model="replaceMode"
            inline-prompt
            active-text="整库替换"
            inactive-text="增量追加"
            style="--el-switch-on-color: #e6a23c"
          />
        </el-tooltip>
        <el-upload
          :show-file-list="false"
          accept=".xls,.xlsx,.csv"
          :before-upload="handleFileImport"
        >
          <el-button type="primary" icon="Upload" :loading="importing">导入 Excel / CSV</el-button>
        </el-upload>
        <el-button text @click="downloadTemplate">模板</el-button>
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
        <el-empty description="暂无数据，可点右上角「导入 Excel / CSV」批量导入（支持管家婆导出的序列号库存 .xls）">
          <el-button text @click="downloadTemplate">下载 CSV 模板</el-button>
        </el-empty>
      </template>
      <el-table-column prop="model" label="商品型号" min-width="240" fixed="left" show-overflow-tooltip>
        <template #default="{ row }">{{ row.model || '—' }}</template>
      </el-table-column>
      <el-table-column prop="imei1" label="IMEI1（手机）" min-width="160">
        <template #default="{ row }"><span class="mono">{{ row.imei1 || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="snCode" label="SN 码" min-width="160">
        <template #default="{ row }"><span class="mono">{{ row.snCode || '—' }}</span></template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="110">
        <template #default="{ row }">{{ row.brand || '—' }}</template>
      </el-table-column>
      <el-table-column prop="price" label="价格" width="100" align="right">
        <template #default="{ row }">¥{{ formatMoney(row.price) }}</template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="120">
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
      <el-form-item label="IMEI1">
        <el-input v-model="form.imei1" placeholder="手机 IMEI1（纯数字，选填）" />
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

  <el-dialog v-model="importOpen" title="导入结果" width="440px">
    <el-result
      :icon="importResult.processed ? 'success' : 'warning'"
      :title="`${importResult.mode === 'replace' ? '整库替换' : '增量导入'}完成：写入 ${importResult.processed || 0} 条`"
      :sub-title="`共读取 ${importResult.total || 0} 行，跳过 ${importResult.skipped || 0} 行（无 IMEI1/SN 或同机重复）`"
    />
    <template #footer>
      <el-button type="primary" @click="importOpen = false">知道了</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import * as XLSX from 'xlsx'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import { ElMessage, ElMessageBox } from 'element-plus'

interface SnRow {
  id: number
  snCode: string
  imei1: string
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
const form = ref<{ snCode: string; imei1: string; brand: string; model: string; price: number; remark: string }>({
  snCode: '', imei1: '', brand: '', model: '', price: 0, remark: ''
})

const importOpen = ref(false)
const importing = ref(false)
const replaceMode = ref(true)
const importResult = ref<{ processed?: number; total?: number; skipped?: number; mode?: string }>({})

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
  form.value = { snCode: '', imei1: '', brand: '', model: '', price: 0, remark: '' }
  formOpen.value = true
}

function openEdit(row: SnRow) {
  editing.value = true
  form.value = { snCode: row.snCode, imei1: row.imei1 || '', brand: row.brand, model: row.model, price: Number(row.price || 0), remark: row.remark }
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
  const content = bom + 'SN,IMEI1,品牌,型号,价格,备注\n'
    + 'SN123456789,,华为,Mate80,5199,智能穿戴/平板按 SN 录入示例\n'
    + 'SNPHONE0001,351234567890123,Apple,iPhone15,5999,手机请填 IMEI1（无 SN 可与 SN 列相同占位）\n'
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

// 列名映射（管家婆「序列号库存状况」导出口径）：
//   序列号     → IMEI1（主码：手机=IMEI1，非手机=SN 串）
//   序列号备注 → SN 码（部分设备额外的厂商 SN）
//   商品全名   → 型号（小程序产品型号）
// 注意：「序列号备注」含「序列号」子串 → IMEI 列必须精确匹配「序列号」，避免误匹配到备注列。
const IMEI_KEYS = ['imei1', 'imei 1', 'imei', '串号', '串号1', 'imei串号', 'meid', '序列号', '序列號']
const SN_KEYS = ['序列号备注', '序列號備註', 'sn', 'sn码', 'sn 码', 'serial', 'serialno', 'imei/sn', 'sncode', 'sn备注']
const BRAND_KEYS = ['品牌', 'brand']
const MODEL_KEYS = ['商品全名', '商品名称', '货品名称', '存货名称', '型号', '型號', '规格型号', '规格', 'model', '商品', '名称']
const PRICE_KEYS = ['零售价', '预设售价', '售价', '单价', '价格', '金额', 'price', '销售单价']
const REMARK_KEYS = ['备注', 'remark', '说明']

/** 精确匹配（归一化大小写/空格后完全相等） */
function exactIdx(headers: string[], keys: string[]): number {
  const ks = keys.map((k) => k.toLowerCase().replace(/\s+/g, ''))
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim().toLowerCase().replace(/\s+/g, '')
    if (ks.includes(h)) return i
  }
  return -1
}

/** 先精确匹配，未命中再退化为包含匹配；excludeIdx 用于避免抢占已被其它列占用的列 */
function matchIdx(headers: string[], keys: string[], excludeIdx: number[] = []): number {
  const exact = exactIdx(headers, keys)
  if (exact >= 0 && !excludeIdx.includes(exact)) return exact
  const ks = keys.map((k) => k.toLowerCase().replace(/\s+/g, ''))
  for (let i = 0; i < headers.length; i++) {
    if (excludeIdx.includes(i)) continue
    const h = headers[i].trim().toLowerCase().replace(/\s+/g, '')
    if (ks.some((k) => h.includes(k))) return i
  }
  return -1
}

function cell(v: any): string {
  if (v === null || v === undefined) return ''
  return String(v).trim()
}

/** 把文件解析成二维单元格矩阵：Excel 走 SheetJS，CSV 走自带解析 */
async function readMatrix(file: File): Promise<string[][]> {
  const name = (file.name || '').toLowerCase()
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) {
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: '', raw: false })
    return aoa.map((r) => (Array.isArray(r) ? r.map(cell) : []))
  }
  // CSV
  let text = await file.text()
  text = text.replace(/^\ufeff/, '')
  return text.split(/\r?\n/).filter((l) => l.length).map((l) => parseCsvLine(l).map(cell))
}

/**
 * 在前若干行里定位表头行：真正的表头是「多列、且含序列号/商品/编号等多个字段名」的那一行，
 * 而不是只含标题文字（如「序列号库存状况」）的首行。要求 ≥2 个非空单元格 + 命中 ≥2 个字段关键词。
 */
function findHeaderRow(matrix: string[][]): number {
  const FIELD_HINTS = ['序列号', '商品', '编号', '型号', '名称', '仓库', 'imei', 'sn']
  const limit = Math.min(matrix.length, 15)
  for (let i = 0; i < limit; i++) {
    const cells = matrix[i].map((c) => c.trim()).filter((c) => c.length)
    if (cells.length < 2) continue
    const lc = cells.map((c) => c.toLowerCase())
    const hits = FIELD_HINTS.filter((k) => lc.some((c) => c.includes(k))).length
    if (hits >= 2) return i
  }
  // 退化：找第一个含「序列号」的多列行
  for (let i = 0; i < limit; i++) {
    const cells = matrix[i].filter((c) => c.trim().length)
    if (cells.length >= 2 && cells.some((c) => c.includes('序列号'))) return i
  }
  return 0
}

/**
 * 智能分流主码：手机的「序列号」是 IMEI1（纯数字≥10 位），非手机（手表/耳机/电脑等）的
 * 「序列号」其实是带字母的 SN。据此把主码归位到 IMEI1 或 SN，保证两类设备都能被正确核对。
 *   primary=序列号列、secondary=序列号备注列
 */
function routeCodes(primary: string, secondary: string): { imei1: string; snCode: string } {
  const p = (primary || '').trim()
  const s = (secondary || '').trim()
  const pDigits = p.replace(/\D/g, '')
  const isImei = p.length > 0 && /^[0-9]+$/.test(p) && pDigits.length >= 10
  if (isImei) return { imei1: p, snCode: s } // 手机：序列号=IMEI1，备注=SN
  return { imei1: '', snCode: p || s }       // 非手机：序列号即 SN
}

async function handleFileImport(file: File) {
  importing.value = true
  try {
    const matrix = await readMatrix(file)
    if (!matrix.length) {
      ElMessage.warning('文件没有内容')
      return false
    }
    const hr = findHeaderRow(matrix)
    const headers = matrix[hr]

    // 「序列号」列取主码（手机=IMEI1/非手机=SN），「序列号备注」列取附加 SN；两列互斥
    const primaryIdx = matchIdx(headers, IMEI_KEYS)
    const secondaryIdx = matchIdx(headers, SN_KEYS, primaryIdx >= 0 ? [primaryIdx] : [])
    if (primaryIdx < 0 && secondaryIdx < 0) {
      ElMessage.error('未找到「序列号 / 序列号备注 / SN」列，请确认是管家婆「序列号库存状况」导出表')
      return false
    }
    const used = [primaryIdx, secondaryIdx].filter((x) => x >= 0)
    const modelIdx = matchIdx(headers, MODEL_KEYS, used)
    const brandIdx = matchIdx(headers, BRAND_KEYS, [...used, modelIdx].filter((x) => x >= 0))
    const priceIdx = matchIdx(headers, PRICE_KEYS, used)

    const items: any[] = []
    for (let i = hr + 1; i < matrix.length; i++) {
      const cols = matrix[i]
      if (!cols || !cols.length) continue
      const primary = primaryIdx >= 0 ? (cols[primaryIdx] || '').trim() : ''
      const secondary = secondaryIdx >= 0 ? (cols[secondaryIdx] || '').trim() : ''
      if (!primary && !secondary) continue // 跳过合计/空行
      const { imei1, snCode } = routeCodes(primary, secondary)
      const priceRaw = priceIdx >= 0 ? (cols[priceIdx] || '').replace(/[¥￥,\s]/g, '') : ''
      items.push({
        imei1,
        snCode,
        model: modelIdx >= 0 ? (cols[modelIdx] || '').trim() : '',
        brand: brandIdx >= 0 ? (cols[brandIdx] || '').trim() : '',
        price: priceRaw && !isNaN(Number(priceRaw)) ? Number(priceRaw) : 0,
        remark: ''
      })
    }
    if (!items.length) {
      ElMessage.warning('没有解析到有效设备行（IMEI1/SN 均为空）')
      return false
    }

    if (replaceMode.value) {
      await ElMessageBox.confirm(
        `将「整库替换」为本次上传的 ${items.length} 台设备（先清空旧数据再写入）。确认继续？`,
        '整库替换确认',
        { type: 'warning', confirmButtonText: '替换', cancelButtonText: '取消' }
      )
    }

    const data = await request.post('/api/admin/sn-catalog/import', { items, replace: replaceMode.value })
    importResult.value = { ...data, total: data?.total ?? items.length }
    importOpen.value = true
    reload(1)
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e?.message || '导入失败')
  } finally {
    importing.value = false
  }
  return false
}
</script>

<style scoped>
.mono { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; font-size: 12px; }
</style>
