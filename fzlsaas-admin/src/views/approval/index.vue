<template>
  <el-alert
    v-if="autoPassStatus.consumption || autoPassStatus.integralMall"
    type="info"
    :closable="false"
    show-icon
    class="status-bar"
  >
    免审已开启：
    <span v-if="autoPassStatus.consumption">消费审批</span>
    <span v-if="autoPassStatus.consumption && autoPassStatus.integralMall"> · </span>
    <span v-if="autoPassStatus.integralMall">积分商城</span>
  </el-alert>

  <PageShell title="审批管理">
    <template #actions>
      <el-button link type="primary" @click="$router.push('/system-settings')">系统设置</el-button>
    </template>

    <template #tabs>
      <el-tabs v-model="activeTab" @tab-change="onTabChange">
        <el-tab-pane name="pending">
          <template #label>
            <span>待终审</span>
            <el-badge v-if="pendingCount > 0" :value="pendingCount" class="tab-badge" />
          </template>
        </el-tab-pane>
        <el-tab-pane label="全部记录" name="all" />
      </el-tabs>
    </template>

    <template v-if="activeTab === 'all'" #filter>
      <el-form :inline="true" @submit.prevent="loadAll">
        <el-form-item label="状态">
          <el-select v-model="filters.status" clearable style="width: 140px">
            <el-option label="待店长" value="pending_store" />
            <el-option label="待超管" value="pending_admin" />
            <el-option label="已通过" value="approved" />
            <el-option label="已驳回" value="rejected" />
            <el-option label="已撤销" value="revoked" />
          </el-select>
        </el-form-item>
        <el-form-item label="店员UID">
          <el-input-number v-model="filters.staffUid" :min="0" controls-position="right" style="width: 130px" />
        </el-form-item>
        <el-form-item label="档位">
          <el-select v-model="filters.tierCode" clearable style="width: 110px">
            <el-option label="锦程199会员" value="SW199" />
            <el-option label="锦程299会员" value="SW299" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额">
          <el-input-number v-model="filters.amountMin" :min="0" controls-position="right" placeholder="最小" style="width: 110px" />
          <span class="range-sep">—</span>
          <el-input-number v-model="filters.amountMax" :min="0" controls-position="right" placeholder="最大" style="width: 110px" />
        </el-form-item>
        <el-form-item label="小票号">
          <el-input v-model="filters.receiptNo" clearable placeholder="模糊搜索" style="width: 140px" />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadAll">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <TableSkeleton v-if="loading && !tableData.length" :cols="6" />
    <el-table v-else :data="tableData" v-loading="loading && tableData.length > 0">
      <template #empty>
        <el-empty :description="activeTab === 'pending' ? '暂无待终审记录' : '暂无审批记录'">
          <el-button v-if="activeTab === 'pending'" link type="primary" @click="activeTab = 'all'; loadAll()">查看全部记录</el-button>
        </el-empty>
      </template>
      <el-table-column prop="requestId" label="ID" width="70" />
      <el-table-column prop="customerUid" label="客户" width="100">
        <template #default="{ row }">
          <UidLink :uid="row.customerUid" @click="openMember" />
        </template>
      </el-table-column>
      <el-table-column prop="consumptionAmount" label="消费金额" width="100">
        <template #default="{ row }">¥{{ row.consumptionAmount ?? row.consumeAmount }}</template>
      </el-table-column>
      <el-table-column prop="matchedTierCode" label="档位" width="110">
        <template #default="{ row }">{{ formatTier(row.matchedTierCode) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="110">
        <template #default="{ row }">
          <ApprovalStatusTag :status="row.status" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="260" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <template v-if="activeTab === 'pending'">
            <el-button link type="success" @click="handleApprove(row)">通过</el-button>
            <el-button link type="danger" @click="handleReject(row)">驳回</el-button>
          </template>
          <el-button
            v-else-if="row.canRevoke"
            link
            type="danger"
            @click="handleRevoke(row)"
          >
            撤销终批
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="!loading && !tableData.length" class="empty">暂无数据</div>

    <template v-if="activeTab === 'all'" #footer>
      <el-pagination
        v-model:current-page="page"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="loadAll"
      />
    </template>
  </PageShell>

  <ApprovalDetailDialog
    v-model="detailOpen"
    :request-id="detailRequestId"
    :show-actions="activeTab === 'pending'"
    @approve="onDetailApprove"
    @reject="onDetailReject"
    @revoke="onDetailRevoke"
  />

  <MemberDetailDrawer v-model="memberDrawerOpen" :uid="memberUid" />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import ApprovalStatusTag from './components/ApprovalStatusTag.vue'
import ApprovalDetailDialog from './components/ApprovalDetailDialog.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import UidLink from '@/components/UidLink.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'

const route = useRoute()
const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()
const pendingCount = ref(0)
const activeTab = ref(route.query.tab === 'pending' ? 'pending' : 'all')
const loading = ref(false)
const tableData = ref<any[]>([])
const page = ref(1)
const total = ref(0)
const filters = ref({
  status: (route.query.status as string) || '',
  staffUid: route.query.staffUid ? Number(route.query.staffUid) : undefined as number | undefined,
  tierCode: '',
  amountMin: undefined as number | undefined,
  amountMax: undefined as number | undefined,
  receiptNo: ''
})
const dateRange = ref<[string, string] | null>(null)
const detailOpen = ref(false)
const detailRequestId = ref<number | null>(null)
const autoPassStatus = ref({ consumption: false, integralMall: false })

onMounted(async () => {
  await loadAutoPassConfig()
  if (route.query.tab === 'pending') activeTab.value = 'pending'
  else activeTab.value = 'all'
  if (activeTab.value === 'pending') loadPending()
  else loadAll()
})

function onTabChange(name: string | number) {
  if (name === 'pending') loadPending()
  else loadAll()
}

async function loadPending() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/approval/todos')
    const rows = Array.isArray(data) ? data : []
    tableData.value = rows.map(mapTodoRow)
    pendingCount.value = rows.length
  } catch {
    tableData.value = []
    pendingCount.value = 0
  } finally {
    loading.value = false
  }
}

async function loadAll() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      pageSize: 20,
      status: filters.value.status || 'all'
    }
    if (filters.value.staffUid) params.staffUid = filters.value.staffUid
    if (filters.value.tierCode) params.tierCode = filters.value.tierCode
    if (filters.value.amountMin != null) params.amountMin = filters.value.amountMin
    if (filters.value.amountMax != null) params.amountMax = filters.value.amountMax
    if (filters.value.receiptNo) params.receiptNo = filters.value.receiptNo
    if (dateRange.value?.[0]) params.dateFrom = dateRange.value[0]
    if (dateRange.value?.[1]) params.dateTo = dateRange.value[1]

    const data = await request.get('/api/admin/approval/list', { params })
    tableData.value = data?.list || []
    total.value = data?.total || 0
  } catch {
    tableData.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function resetFilters() {
  filters.value = {
    status: '',
    staffUid: undefined,
    tierCode: '',
    amountMin: undefined,
    amountMax: undefined,
    receiptNo: ''
  }
  dateRange.value = null
  page.value = 1
  loadAll()
}

function formatTier(code?: string) {
  if (code === 'SW199') return '锦程199'
  if (code === 'SW299') return '锦程299'
  return code || '—'
}

function mapTodoRow(row: any) {
  return {
    requestId: row.requestId,
    customerUid: row.customerUid,
    consumptionAmount: row.consumeAmount,
    matchedTierCode: row.matchedTierCode,
    status: 'pending_admin',
    ...row
  }
}

function openDetail(row: any) {
  detailRequestId.value = row.requestId
  detailOpen.value = true
}

async function handleApprove(row: any) {
  try {
    const { value } = await ElMessageBox.prompt('确认通过该审批并发放权益？可填写审批备注。', '终审通过', {
      type: 'warning',
      inputPlaceholder: '审批备注（选填）',
      inputValidator: (text: string) => text.length <= 200 || '备注不能超过200字'
    })
    await request.post('/api/admin/approval/review', {
      requestId: row.requestId,
      action: 'approve',
      reason: value?.trim() || undefined
    })
    ElMessage.success('已通过')
    loadPending()
  } catch { /* cancel or error */ }
}

async function handleReject(row: any) {
  await promptReject(row.requestId)
}

async function onDetailApprove(detail: any, comment: string) {
  try {
    await request.post('/api/admin/approval/review', {
      requestId: detail.requestId,
      action: 'approve',
      reason: comment || undefined
    })
    ElMessage.success('已通过')
    detailOpen.value = false
    loadPending()
  } catch { /* handled */ }
}

async function onDetailReject(detail: any) {
  const ok = await promptReject(detail.requestId)
  if (ok) detailOpen.value = false
}

async function handleRevoke(row: any) {
  await promptRevoke(row.requestId)
}

async function onDetailRevoke(detail: any) {
  const ok = await promptRevoke(detail.requestId)
  if (ok) detailOpen.value = false
}

async function promptRevoke(requestId: number): Promise<boolean> {
  try {
    const { value } = await ElMessageBox.prompt(
      '撤销终批将回滚已发放的会员/积分/现金券，请输入「确认撤销」以继续',
      '撤销终批',
      {
        type: 'warning',
        confirmButtonText: '确认撤销',
        inputPattern: /^确认撤销$/,
        inputErrorMessage: '请输入「确认撤销」'
      }
    )
    if (value !== '确认撤销') return false
    await request.post(`/api/admin/approval/${requestId}/revoke`, { reason: value })
    ElMessage.success('终批已撤销')
    if (activeTab.value === 'pending') loadPending()
    else loadAll()
    return true
  } catch {
    return false
  }
}

async function promptReject(requestId: number): Promise<boolean> {
  try {
    const { value } = await ElMessageBox.prompt('请输入驳回原因（不少于 5 字）', '驳回', {
      type: 'warning',
      inputValidator: (v) => {
        if (!v || v.trim().length < 5) return '驳回原因不少于 5 字'
        return true
      },
      inputErrorMessage: '驳回原因不少于 5 字'
    })
    await request.post('/api/admin/approval/review', { requestId, action: 'reject', reason: value.trim() })
    ElMessage.info('已驳回')
    if (activeTab.value === 'pending') loadPending()
    else loadAll()
    return true
  } catch {
    return false
  }
}

async function loadAutoPassConfig() {
  try {
    autoPassStatus.value = await request.get('/api/admin/config/approval-auto-pass')
  } catch { /* ignore */ }
}
</script>

<style scoped>
.empty { text-align: center; padding: 40px; color: #999; }
.status-bar { margin-bottom: 16px; }
.range-sep { margin: 0 6px; color: #9CA3AF; }
.tab-badge { margin-left: 6px; vertical-align: middle; }
</style>
