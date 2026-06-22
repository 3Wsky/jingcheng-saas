<template>
  <PageShell title="商家结算" subtitle="异业商家核销台账，线下结算后在此标记">
    <template #toolbar>
      <div class="toolbar-row">
        <div class="summary-bar">
          <span>全平台待结算 <b class="pending">{{ fmtMoney(summary.pendingTotal) }}</b></span>
          <span>累计已结算 <b>{{ fmtMoney(summary.settledTotal) }}</b></span>
        </div>
        <div class="toolbar-actions">
          <template v-if="activeTab === 'merchants'">
            <el-button
              type="primary"
              :disabled="!selectedRows.length"
              :loading="batchMarking"
              @click="batchMark"
            >
              批量标记已结算 ({{ selectedRows.length }})
            </el-button>
          </template>
          <el-button :loading="exporting" @click="exportCsv">导出 CSV</el-button>
        </div>
      </div>
    </template>

    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="商家">
          <el-input v-model="filters.keyword" placeholder="名称/联系人" clearable style="width: 200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #tabs>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane label="待结算商家" name="merchants" />
        <el-tab-pane label="结算记录" name="records" />
      </el-tabs>
    </template>

    <el-table
      v-if="activeTab === 'merchants'"
      ref="tableRef"
      :data="list"
      v-loading="loading"
      size="small"
      class="admin-table"
      row-key="id"
      @selection-change="onSelect"
    >
      <el-table-column type="selection" width="48" :selectable="canSelect" />
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="merchantName" label="商家名称" min-width="140" />
      <el-table-column prop="category" label="类目" width="100" />
      <el-table-column prop="contactPhone" label="电话" width="120" />
      <el-table-column label="待结算" width="110">
        <template #default="{ row }">
          <span class="pending">{{ fmtMoney(row.pendingSettlement) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="累计已结算" width="120">
        <template #default="{ row }">{{ fmtMoney(row.settledTotal) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button
            link
            type="primary"
            :disabled="row.pendingSettlement <= 0"
            @click="openMark(row)"
          >
            标记已结算
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-table v-else :data="records" v-loading="recordsLoading" size="small" class="admin-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="merchantName" label="商家" min-width="140" />
      <el-table-column label="结算金额" width="110">
        <template #default="{ row }">{{ fmtMoney(row.amount) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 'settled' ? 'success' : 'warning'" size="small">
            {{ row.status === 'settled' ? '已结算' : '待结算' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="remark" label="备注" min-width="160" show-overflow-tooltip />
      <el-table-column label="结算时间" width="165">
        <template #default="{ row }">{{ fmtUnixTime(row.settledAt || row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="120" fixed="right">
        <template #default="{ row }">
          <el-button v-if="row.status === 'pending'" link type="primary" @click="settleWithdrawal(row)">确认打款</el-button>
          <span v-else>—</span>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="activeTab === 'merchants' ? total : recordsTotal"
        layout="total, prev, pager, next"
        @current-change="onPageChange"
      />
    </template>
  </PageShell>

  <el-dialog v-model="markOpen" title="标记已结算" width="420px">
    <p class="mark-tip">确认商家 <b>{{ markForm.merchantName }}</b> 已在 offline 完成结算？</p>
    <el-form label-width="100px">
      <el-form-item label="结算金额">
        <el-input-number v-model="markForm.amount" :min="0.01" :max="markForm.maxAmount" :precision="2" style="width: 100%" />
      </el-form-item>
      <el-form-item label="备注">
        <el-input v-model="markForm.remark" placeholder="如：2026年6月线下打款" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="markOpen = false">取消</el-button>
      <el-button type="primary" :loading="marking" @click="submitMark">确认标记</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import type { TableInstance } from 'element-plus'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import { fmtUnixTime, fmtMoney } from '@/utils/format'
import { downloadCsv } from '@/utils/csvExport'
import { fetchAllPages } from '@/utils/fetchAllPages'

const route = useRoute()
const loading = ref(false)
const recordsLoading = ref(false)
const exporting = ref(false)
const batchMarking = ref(false)
const list = ref<any[]>([])
const records = ref<any[]>([])
const selectedRows = ref<any[]>([])
const total = ref(0)
const recordsTotal = ref(0)
const page = ref(1)
const pageSize = ref(20)
const activeTab = ref('merchants')
const filters = ref({ keyword: '' })
const summary = ref({ pendingTotal: 0, settledTotal: 0 })
const tableRef = ref<TableInstance>()

const markOpen = ref(false)
const marking = ref(false)
const markForm = ref({
  merchantId: 0,
  merchantName: '',
  amount: 0,
  maxAmount: 0,
  remark: '线下已结算',
})

onMounted(async () => {
  loadSummary()
  await load()
  const name = String(route.query.merchantName || '').trim()
  const mid = Number(route.query.merchantId || 0)
  if (name) {
    filters.value.keyword = name
    await load()
  }
  if (mid) {
    const row = list.value.find((r) => r.id === mid)
    if (row && row.pendingSettlement > 0) openMark(row)
  }
})

function canSelect(row: any) {
  return Number(row.pendingSettlement) > 0
}

function onSelect(rows: any[]) {
  selectedRows.value = rows
}

async function loadSummary() {
  try {
    const data = await request.get('/api/admin/finance/summary')
    summary.value = data?.settlement || { pendingTotal: 0, settledTotal: 0 }
  } catch { /* ignore */ }
}

async function load() {
  if (activeTab.value === 'records') return loadRecords()
  loading.value = true
  try {
    const data = await request.get('/api/admin/finance/settlement/list', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        keyword: filters.value.keyword || undefined,
      },
    })
    list.value = data?.list || []
    total.value = data?.total || 0
    selectedRows.value = []
    tableRef.value?.clearSelection()
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

async function loadRecords() {
  recordsLoading.value = true
  try {
    const data = await request.get('/api/admin/finance/settlement/records', {
      params: { page: page.value, pageSize: pageSize.value },
    })
    records.value = data?.list || []
    recordsTotal.value = data?.total || 0
  } catch {
    records.value = []
    recordsTotal.value = 0
  } finally {
    recordsLoading.value = false
  }
}

async function settleWithdrawal(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(
      `确认已向 ${row.merchantName} 打款 ${fmtMoney(row.amount)}？`,
      '确认提现到账',
      { inputValue: 'T+3线下打款完成', inputPlaceholder: '打款备注' },
    )
    await request.post(`/api/admin/finance/settlement/${row.id}/settle`, { remark: value || '' })
    ElMessage.success('已确认打款')
    await Promise.all([loadRecords(), loadSummary()])
  } catch { /* cancel or handled */ }
}

async function fetchAllMerchants() {
  return fetchAllPages('/api/admin/finance/settlement/list', {
    keyword: filters.value.keyword || undefined,
  })
}

async function fetchAllRecords() {
  return fetchAllPages('/api/admin/finance/settlement/records')
}

async function exportCsv() {
  exporting.value = true
  try {
    if (activeTab.value === 'merchants') {
      const rows = await fetchAllMerchants()
      if (!rows.length) {
        ElMessage.info('暂无数据可导出')
        return
      }
      downloadCsv(
        'merchant-settlement-pending.csv',
        ['ID', '商家名称', '类目', '电话', '待结算(元)', '累计已结算(元)', '备注'],
        rows.map((r: any) => [
          r.id,
          r.merchantName,
          r.category,
          r.contactPhone,
          r.pendingSettlement,
          r.settledTotal,
          r.settlementNote || '',
        ])
      )
    } else {
      const rows = await fetchAllRecords()
      if (!rows.length) {
        ElMessage.info('暂无数据可导出')
        return
      }
      downloadCsv(
        'merchant-settlement-records.csv',
        ['ID', '商家', '结算金额(元)', '状态', '备注', '结算时间'],
        rows.map((r: any) => [
          r.id,
          r.merchantName,
          r.amount,
          r.status === 'settled' ? '已结算' : '待结算',
          r.remark,
          fmtUnixTime(r.settledAt || r.createdAt),
        ])
      )
    }
    ElMessage.success('CSV 已导出')
  } catch { /* handled */ }
  finally { exporting.value = false }
}

async function batchMark() {
  if (!selectedRows.value.length) return
  const totalAmount = selectedRows.value.reduce((s, r) => s + Number(r.pendingSettlement || 0), 0)
  try {
    await ElMessageBox.confirm(
      `将批量标记 ${selectedRows.value.length} 家商家为已结算，合计 ${fmtMoney(totalAmount)}（按各商家全部待结算金额）。`,
      '批量结算确认',
      { type: 'warning', confirmButtonText: '确认批量标记' }
    )
  } catch {
    return
  }

  batchMarking.value = true
  try {
    const data = await request.post('/api/admin/finance/settlement/mark-batch', {
      items: selectedRows.value.map((r) => ({
        merchantId: r.id,
        amount: r.pendingSettlement,
      })),
      remark: '批量线下已结算',
    })
    ElMessage.success(`完成：成功 ${data?.success ?? 0} / 失败 ${data?.failed ?? 0}`)
    loadSummary()
    load()
    if (activeTab.value === 'records') loadRecords()
  } catch { /* handled */ }
  finally { batchMarking.value = false }
}

function onTabChange() {
  page.value = 1
  selectedRows.value = []
  if (activeTab.value === 'records') loadRecords()
  else load()
}

function onPageChange() {
  if (activeTab.value === 'records') loadRecords()
  else load()
}

function search() {
  page.value = 1
  load()
}

function reset() {
  filters.value = { keyword: '' }
  search()
}

function openMark(row: any) {
  markForm.value = {
    merchantId: row.id,
    merchantName: row.merchantName,
    amount: row.pendingSettlement,
    maxAmount: row.pendingSettlement,
    remark: '线下已结算',
  }
  markOpen.value = true
}

async function submitMark() {
  if (!markForm.value.amount || markForm.value.amount <= 0) {
    ElMessage.warning('请输入有效结算金额')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认标记商家「${markForm.value.merchantName}」已结算 ${fmtMoney(markForm.value.amount)}？`,
      '二次确认',
      { type: 'warning' }
    )
  } catch {
    return
  }

  marking.value = true
  try {
    await request.post('/api/admin/finance/settlement/mark', {
      merchantId: markForm.value.merchantId,
      amount: markForm.value.amount,
      remark: markForm.value.remark,
    })
    ElMessage.success('已标记结算')
    markOpen.value = false
    loadSummary()
    load()
    if (activeTab.value === 'records') loadRecords()
  } catch { /* handled */ }
  finally { marking.value = false }
}
</script>

<style scoped>
.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
}
.toolbar-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.summary-bar {
  display: flex;
  gap: 24px;
  font-size: 14px;
  color: rgba(0,0,0,.65);
}
.summary-bar b { font-size: 16px; color: rgba(0,0,0,.85); }
.pending { color: #d97706; }
.mark-tip { margin: 0 0 16px; color: rgba(0,0,0,.65); }
</style>
