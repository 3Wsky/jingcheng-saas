<template>
  <PageShell title="会员管理">
    <div v-if="selectedRows.length" class="selection-bar">
      <span class="selection-count">已选 <strong>{{ selectedRows.length }}</strong> 条</span>
      <el-button link type="primary" @click="clearSelection">取消选择</el-button>
    </div>

    <template #filter>
      <el-form :inline="true" class="filter-form" @submit.prevent="search">
        <el-form-item label="用户搜索">
          <el-select v-model="filters.searchType" style="width: 110px">
            <el-option label="全部" value="all" />
            <el-option label="UID" value="uid" />
            <el-option label="手机号" value="phone" />
            <el-option label="昵称" value="nickname" />
          </el-select>
          <el-input
            v-model="filters.keyword"
            placeholder="请输入"
            clearable
            style="width: 200px; margin-left: 8px"
          />
        </el-form-item>
        <el-form-item label="用户标签">
          <el-select v-model="filters.tag" placeholder="请选择" clearable style="width: 140px">
            <el-option label="普通用户" value="normal" />
            <el-option label="199会员" value="tier199" />
            <el-option label="299会员" value="tier299" />
            <el-option label="店员" value="staff" />
            <el-option label="店长" value="manager" />
            <el-option label="商家" value="merchant" />
          </el-select>
        </el-form-item>
        <template v-if="filterExpanded">
          <el-form-item label="付费会员">
            <el-select v-model="filters.paidOnly" placeholder="全部" clearable style="width: 120px">
              <el-option label="是" value="yes" />
              <el-option label="否" value="no" />
            </el-select>
          </el-form-item>
          <el-form-item label="归属店员UID">
            <el-input-number v-model="filters.spreadUid" :min="0" controls-position="right" style="width: 140px" />
          </el-form-item>
          <el-form-item label="无归属">
            <el-switch v-model="filters.unownedOnly" />
          </el-form-item>
        </template>
        <el-form-item class="filter-actions">
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button link type="primary" @click="filterExpanded = !filterExpanded">
            {{ filterExpanded ? '收起' : '展开' }}
            <el-icon><component :is="filterExpanded ? 'ArrowUp' : 'ArrowDown'" /></el-icon>
          </el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #tabs>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="全部" name="all" />
        <el-tab-pane label="199会员" name="tier199" />
        <el-tab-pane label="299会员" name="tier299" />
        <el-tab-pane label="店员" name="staff" />
        <el-tab-pane label="普通用户" name="normal" />
      </el-tabs>
    </template>

    <template #toolbar>
      <div class="toolbar-left">
        <el-button type="primary" :disabled="!selectedRows.length" @click="openBatch('integral')">
          批量发积分
        </el-button>
        <el-button :disabled="!selectedRows.length" @click="openBatch('cash_voucher')">
          发送优惠券
        </el-button>
        <el-button :disabled="!selectedRows.length" @click="openBatch('membership')">
          批量设置
        </el-button>
        <el-button :disabled="!selectedRows.length" @click="openSpreadBatch">
          批量指定归属
        </el-button>
        <el-button @click="downloadTemplate">查看导入模板</el-button>
        <el-upload
          :show-file-list="false"
          accept=".csv,text/csv"
          :before-upload="handleCsvImport"
        >
          <el-button>用户导入</el-button>
        </el-upload>
        <el-button @click="exportData">数据导出</el-button>
      </div>
      <div class="toolbar-right">
        <span class="select-hint">全选({{ selectedRows.length }})</span>
      </div>
    </template>

    <TableSkeleton v-if="loading && !list.length" :cols="8" />
    <el-table
      v-else
      ref="tableRef"
      :data="list"
      v-loading="loading && list.length > 0"
      row-key="uid"
      @selection-change="onSelect"
    >
      <template #empty>
        <el-empty description="暂无会员">
          <el-button type="primary" @click="downloadTemplate">查看导入模板</el-button>
        </el-empty>
      </template>
      <el-table-column type="selection" width="48" />
      <el-table-column prop="uid" label="UID" width="88" />
      <el-table-column label="头像" width="72" align="center">
        <template #default="{ row }">
          <el-avatar :size="36" :src="row.avatar">
            {{ (row.nickname || '?').slice(0, 1) }}
          </el-avatar>
        </template>
      </el-table-column>
      <el-table-column label="昵称" min-width="120">
        <template #default="{ row }">{{ row.nickname || maskPhone(row.phone) || '—' }}</template>
      </el-table-column>
      <el-table-column label="付费会员" width="88" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.tierCode" type="success" size="small">是</el-tag>
          <span v-else class="text-muted">否</span>
        </template>
      </el-table-column>
      <el-table-column label="用户等级" width="104" align="center">
        <template #default="{ row }">
          <MemberTag v-if="row.tierCode === 'SW199'" tag="tier199" />
          <MemberTag v-else-if="row.tierCode === 'SW299'" tag="tier299" />
          <MemberTag v-else tag="normal" />
        </template>
      </el-table-column>
      <el-table-column label="分组" width="96" align="center">
        <template #default="{ row }">
          <MemberTag v-for="t in roleTags(row)" :key="t" :tag="t" style="margin: 2px" />
          <span v-if="!roleTags(row).length" class="text-muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="手机号" width="120">
        <template #default="{ row }">{{ maskPhone(row.phone) }}</template>
      </el-table-column>
      <el-table-column label="归属店员" min-width="108">
        <template #default="{ row }">
          {{ row.spreadNickname || (row.spreadUid ? `#${row.spreadUid}` : '—') }}
        </template>
      </el-table-column>
      <el-table-column label="积分" width="100" align="right">
        <template #default="{ row }">{{ formatNum(row.integralBalance) }}</template>
      </el-table-column>
      <el-table-column label="现金券" width="90" align="right">
        <template #default="{ row }">¥{{ row.cashVoucherBalance ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.uid)">详情</el-button>
          <el-button link type="primary" @click="openDetail(row.uid)">编辑</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadList"
        @size-change="onSizeChange"
      />
    </template>
  </PageShell>

  <MemberDetailDrawer v-model="drawerOpen" :uid="selectedUid" />

  <el-dialog v-model="batchOpen" :title="batchTitle" width="480px" destroy-on-close>
    <el-alert
      type="info"
      :closable="false"
      show-icon
      :title="`已选 ${selectedRows.length} 位用户`"
      style="margin-bottom: 16px"
    />
    <el-form label-width="88px">
      <el-form-item v-if="batchAction !== 'membership'" label="数量">
        <el-input-number v-model="batchAmount" :min="1" style="width: 100%" />
      </el-form-item>
      <el-form-item v-else label="会员档位">
        <el-select v-model="batchTier" style="width: 100%">
          <el-option label="199会员" value="SW199" />
          <el-option label="299会员" value="SW299" />
        </el-select>
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="batchRemark" />
      </el-form-item>
    </el-form>
    <el-progress v-if="batchRunning" :percentage="batchProgress" />
    <div v-if="batchResults.length" class="batch-results">
      <div v-for="r in batchResults" :key="r.row" :class="{ fail: !r.ok }">
        UID {{ r.uid }}: {{ r.ok ? '成功' : r.error }}
      </div>
    </div>
    <template #footer>
      <el-button @click="batchOpen = false">取消</el-button>
      <el-button type="primary" :loading="batchRunning" @click="runBatch">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="spreadOpen" title="批量指定归属店员" width="480px" destroy-on-close>
    <p class="batch-tip">将已勾选的会员归属到指定店员；默认跳过已有归属的会员。</p>
    <el-form label-width="120px">
      <el-form-item label="归属店员 UID" required>
        <el-input-number v-model="spreadTargetUid" :min="1" controls-position="right" style="width: 100%" />
      </el-form-item>
      <el-form-item label="仅无归属">
        <el-switch v-model="spreadOnlyUnowned" />
      </el-form-item>
      <el-form-item label="已选会员">
        <span>{{ selectedRows.length }} 人</span>
      </el-form-item>
    </el-form>
    <div v-if="spreadResults.length" class="batch-results">
      <div v-for="r in spreadResults" :key="r.uid" :class="{ fail: !r.ok }">
        UID {{ r.uid }}: {{ r.ok ? '成功' : r.error }}
      </div>
    </div>
    <template #footer>
      <el-button @click="spreadOpen = false">取消</el-button>
      <el-button type="primary" :loading="spreadRunning" @click="runSpreadBatch">确定</el-button>
    </template>
  </el-dialog>

  <el-dialog v-model="csvOpen" title="CSV 导入结果" width="480px" destroy-on-close>
    <el-alert
      v-if="csvSummary"
      type="info"
      :closable="false"
      show-icon
      :title="`共 ${csvSummary.total} 条，成功 ${csvSummary.success} / 失败 ${csvSummary.failed}`"
      style="margin-bottom: 12px"
    />
    <div v-if="csvResults.length" class="batch-results">
      <div v-for="(r, idx) in csvResults" :key="idx" :class="{ fail: !r.ok }">
        UID {{ r.uid }} ({{ r.action }}): {{ r.ok ? '成功' : r.error }}
      </div>
    </div>
    <template #footer>
      <el-button type="primary" @click="csvOpen = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import type { TableInstance } from 'element-plus'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import MemberDetailDrawer from './components/MemberDetailDrawer.vue'
import MemberTag from '@/components/MemberTag.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { downloadCsv } from '@/utils/csvExport'

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const filterExpanded = ref(false)
const activeTab = ref('all')
const filters = ref({
  searchType: 'all',
  keyword: '',
  tag: '',
  paidOnly: '' as '' | 'yes' | 'no',
  spreadUid: undefined as number | undefined,
  unownedOnly: false
})
const drawerOpen = ref(false)
const selectedUid = ref<number | null>(null)
const selectedRows = ref<any[]>([])
const batchOpen = ref(false)
const csvOpen = ref(false)
const csvResults = ref<any[]>([])
const csvSummary = ref<{ total: number; success: number; failed: number } | null>(null)
const batchAction = ref<'integral' | 'cash_voucher' | 'membership'>('integral')
const batchAmount = ref(1000)
const batchTier = ref('SW199')
const batchRemark = ref('批量发放')
const batchRunning = ref(false)
const batchProgress = ref(0)
const batchResults = ref<any[]>([])
const spreadOpen = ref(false)
const spreadTargetUid = ref<number | undefined>(undefined)
const spreadOnlyUnowned = ref(true)
const spreadRunning = ref(false)
const spreadResults = ref<any[]>([])
const tableRef = ref<TableInstance>()

const batchTitle = computed(() => ({
  integral: '批量发积分',
  cash_voucher: '批量发送优惠券',
  membership: '批量开通会员'
}[batchAction.value]))

onMounted(() => loadList())

function maskPhone(phone?: string) {
  if (!phone || phone.length < 7) return phone || '—'
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
}

function formatNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0'
}

function roleTags(row: any) {
  return (row.tags || []).filter((x: string) => !['tier199', 'tier299', 'normal'].includes(x))
}

function onSelect(rows: any[]) {
  selectedRows.value = rows
}

function clearSelection() {
  tableRef.value?.clearSelection()
  selectedRows.value = []
}

function onTabChange(name: string | number) {
  if (name === 'all') filters.value.tag = ''
  else filters.value.tag = String(name)
  search()
}

function openBatch(action: 'integral' | 'cash_voucher' | 'membership') {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选用户')
    return
  }
  batchAction.value = action
  batchResults.value = []
  batchProgress.value = 0
  batchOpen.value = true
}

async function runBatch() {
  if (!selectedRows.value.length) return
  batchRunning.value = true
  batchResults.value = []
  try {
    const items = selectedRows.value.map((r) => ({
      uid: r.uid,
      amount: batchAmount.value,
      tierCode: batchTier.value,
      remark: batchRemark.value
    }))
    const data = await request.post('/api/admin/members/batch-grant', {
      action: batchAction.value,
      items
    })
    batchResults.value = data?.results || []
    batchProgress.value = 100
    ElMessage.success(`完成：成功 ${data?.success ?? 0} / 失败 ${data?.failed ?? 0}`)
    loadList()
  } catch { /* handled */ }
  finally { batchRunning.value = false }
}

function openSpreadBatch() {
  if (!selectedRows.value.length) {
    ElMessage.warning('请先勾选用户')
    return
  }
  spreadResults.value = []
  spreadOpen.value = true
}

async function runSpreadBatch() {
  if (!selectedRows.value.length || !spreadTargetUid.value) {
    ElMessage.warning('请填写归属店员 UID')
    return
  }
  spreadRunning.value = true
  spreadResults.value = []
  try {
    const data = await request.post('/api/admin/members/batch-spread', {
      spreadUid: spreadTargetUid.value,
      uids: selectedRows.value.map((r) => r.uid),
      onlyUnowned: spreadOnlyUnowned.value
    })
    spreadResults.value = data?.results || []
    ElMessage.success(`完成：成功 ${data?.success ?? 0} / 失败 ${data?.failed ?? 0}`)
    loadList()
  } catch { /* handled */ }
  finally { spreadRunning.value = false }
}

async function loadList() {
  loading.value = true
  try {
    const params: Record<string, any> = {
      page: page.value,
      pageSize: pageSize.value,
      keyword: filters.value.keyword || undefined,
      searchType: filters.value.searchType !== 'all' ? filters.value.searchType : undefined,
      tag: filters.value.tag || undefined,
      spreadUid: filters.value.spreadUid || undefined,
      unownedOnly: filters.value.unownedOnly || undefined
    }
    const data = await request.get('/api/admin/members/list', { params })
    let rows = data?.list || []
    if (filters.value.paidOnly === 'yes') {
      rows = rows.filter((r: any) => !!r.tierCode)
    } else if (filters.value.paidOnly === 'no') {
      rows = rows.filter((r: any) => !r.tierCode)
    }
    list.value = rows
    total.value = data?.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  loadList()
}

function reset() {
  filters.value = { searchType: 'all', keyword: '', tag: '', paidOnly: '', spreadUid: undefined, unownedOnly: false }
  activeTab.value = 'all'
  search()
}

function onSizeChange() {
  page.value = 1
  loadList()
}

function openDetail(uid: number) {
  selectedUid.value = uid
  drawerOpen.value = true
}

function downloadTemplate() {
  const base = import.meta.env.VITE_API_BASE || ''
  window.open(`${base}/api/admin/members/batch-grant/template`, '_blank')
}

async function handleCsvImport(file: File) {
  try {
    const csv = await file.text()
    const data = await request.post('/api/admin/members/batch-grant/csv', { csv })
    csvSummary.value = {
      total: data?.total ?? 0,
      success: data?.success ?? 0,
      failed: data?.failed ?? 0
    }
    csvResults.value = data?.results || []
    csvOpen.value = true
    ElMessage.success(`导入完成：成功 ${data?.success ?? 0} / 失败 ${data?.failed ?? 0}`)
    loadList()
  } catch { /* handled */ }
  return false
}

function tierLabel(code?: string) {
  if (code === 'SW199') return '199会员'
  if (code === 'SW299') return '299会员'
  return ''
}

async function exportData() {
  const rows: any[] = []
  let p = 1
  const size = 100
  let totalCount = 0
  try {
    do {
      const params: Record<string, any> = {
        page: p,
        pageSize: size,
        keyword: filters.value.keyword || undefined,
        tag: filters.value.tag || undefined
      }
      const data = await request.get('/api/admin/members/list', { params })
      let batch = data?.list || []
      if (filters.value.paidOnly === 'yes') batch = batch.filter((r: any) => !!r.tierCode)
      else if (filters.value.paidOnly === 'no') batch = batch.filter((r: any) => !r.tierCode)
      rows.push(...batch)
      totalCount = data?.total || rows.length
      p += 1
    } while (rows.length < totalCount && p <= 50)
  } catch { /* handled */ }

  if (!rows.length) {
    ElMessage.info('暂无数据可导出')
    return
  }
  downloadCsv(
    'members-list.csv',
    ['UID', '昵称', '手机号', '付费会员', '等级', '分组', '归属店员', '积分', '现金券'],
    rows.map((r) => [
      r.uid,
      r.nickname || '',
      r.phone || '',
      r.tierCode ? '是' : '否',
      tierLabel(r.tierCode),
      roleTags(r).join('/') || '',
      r.spreadNickname || (r.spreadUid ? `#${r.spreadUid}` : ''),
      r.integralBalance ?? 0,
      r.cashVoucherBalance ?? 0
    ])
  )
  ElMessage.success(`已导出 ${rows.length} 条`)
}
</script>

<style scoped>
.selection-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 10px 14px;
  background: #e6f7ff;
  border: 1px solid #91d5ff;
  border-radius: 2px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}
.selection-count strong {
  color: var(--el-color-primary);
  font-weight: 600;
}
.filter-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.filter-actions {
  margin-left: auto;
}
.toolbar-left {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
  font-size: 13px;
}
.select-hint {
  color: rgba(0, 0, 0, 0.45);
}
.text-muted {
  color: rgba(0, 0, 0, 0.25);
}
.batch-results {
  max-height: 160px;
  overflow: auto;
  font-size: 12px;
  margin-top: 12px;
  background: #fafafa;
  padding: 8px;
  border-radius: 2px;
}
.batch-results .fail { color: #ff4d4f; }
</style>
