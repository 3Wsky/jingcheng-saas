<template>
  <PageShell title="现金券流水" subtitle="对应 CRMEB「资金流水」，记录发放与核销">
    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="用户UID">
          <el-input-number v-model="filters.uid" :min="0" controls-position="right" style="width: 140px" />
        </el-form-item>
        <el-form-item label="类型">
          <el-select v-model="filters.direction" clearable placeholder="全部" style="width: 120px">
            <el-option label="发放" :value="1" />
            <el-option label="核销" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item label="按月">
          <el-date-picker
            v-model="month"
            type="month"
            value-format="YYYY-MM"
            placeholder="选择整月"
            style="width: 130px"
            @change="onMonthPick"
          />
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px"
            @change="month = ''"
          />
        </el-form-item>
        <el-form-item label="关键词">
          <el-input v-model="filters.keyword" placeholder="单号/备注/UID" clearable style="width: 180px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
          <el-button type="success" plain :loading="exporting" @click="exportCsv">导出 CSV</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="list" v-loading="loading" size="small" class="admin-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="用户" min-width="120">
        <template #default="{ row }">
          <div>{{ row.userNickname || '—' }}</div>
          <UidLink :uid="row.uid" @click="openMember" />
        </template>
      </el-table-column>
      <el-table-column label="类型" width="90">
        <template #default="{ row }">
          <el-tag :type="row.direction === 1 ? 'success' : 'warning'" size="small">
            {{ row.direction === 1 ? '发放' : '核销' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="110">
        <template #default="{ row }">
          <span :class="row.direction === 1 ? 'amt-plus' : 'amt-minus'">
            {{ row.direction === 1 ? '+' : '-' }}{{ fmtMoney(row.amount) }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="merchantName" label="商户" width="120" />
      <el-table-column prop="bizId" label="业务单号" min-width="140" show-overflow-tooltip />
      <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <el-tooltip
            v-if="row.reversedAt"
            :content="`撤回原因：${row.reversalReason || '—'}；操作人：${row.reversedBy || '—'}；时间：${fmtUnixTime(row.reversedAt)}`"
            placement="top"
          >
            <el-tag type="info" size="small">已撤回</el-tag>
          </el-tooltip>
          <el-tag v-else type="success" size="small">有效</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="时间" width="165">
        <template #default="{ row }">{{ fmtUnixTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </template>
  </PageShell>

  <MemberDetailDrawer v-model="memberDrawerOpen" :uid="memberUid" />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import UidLink from '@/components/UidLink.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'
import { ElMessage } from 'element-plus'
import { fmtUnixTime, fmtMoney } from '@/utils/format'
import { lastNDaysRange, dateRangeToUnix, monthRange } from '@/utils/dateDefaults'
import { downloadCsv } from '@/utils/csvExport'

const route = useRoute()
const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()
const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const dateRange = ref<[string, string] | null>(lastNDaysRange(7))
const month = ref('')
const exporting = ref(false)
const filters = ref<{ uid?: number; direction?: number; keyword: string }>({ keyword: '' })

// 支持从看板卡片带参跳转：?direction=0(核销)/1(发放) & range=today/7d/30d（或 startAt/endAt）
function applyQuery() {
  const q = route.query
  if (q.direction !== undefined && q.direction !== '') {
    const d = Number(q.direction)
    if (d === 0 || d === 1) filters.value.direction = d
  }
  const rangeMap: Record<string, number> = { today: 1, '7d': 7, '30d': 30 }
  if (typeof q.range === 'string' && rangeMap[q.range]) {
    dateRange.value = lastNDaysRange(rangeMap[q.range])
    month.value = ''
  } else if (q.startAt && q.endAt) {
    const s = new Date(Number(q.startAt) * 1000)
    const e = new Date(Number(q.endAt) * 1000)
    const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
    dateRange.value = [fmt(s), fmt(e)]
    month.value = ''
  }
}

onMounted(() => {
  applyQuery()
  load()
})

function onMonthPick(m: string) {
  if (m) {
    dateRange.value = monthRange(m)
    search()
  }
}

async function exportCsv() {
  exporting.value = true
  const rows: any[] = []
  try {
    const { startAt, endAt } = dateRangeToUnix(dateRange.value)
    let p = 1
    const size = 100
    let totalCount = 0
    do {
      const data = await request.get('/api/admin/finance/cash-voucher-ledger', {
        params: {
          page: p, pageSize: size,
          uid: filters.value.uid || undefined,
          direction: filters.value.direction ?? undefined,
          keyword: filters.value.keyword || undefined,
          startAt, endAt,
        },
      })
      rows.push(...(data?.list || []))
      totalCount = data?.total || rows.length
      p += 1
    } while (rows.length < totalCount && p <= 200)
  } catch {
    exporting.value = false
    return
  }
  exporting.value = false
  if (!rows.length) { ElMessage.info('暂无数据可导出'); return }
  const dirLabel = filters.value.direction === 1 ? '发放记录' : filters.value.direction === 0 ? '核销记录' : '现金券流水'
  const stamp = (month.value || new Date().toISOString().slice(0, 10))
  downloadCsv(
    `${dirLabel}-${stamp}.csv`,
    ['ID', '类型', '用户昵称', '用户手机号', 'UID', '金额', '批次ID', '商户', '操作人', '操作人UID', '业务单号', '备注', '状态', '撤回原因', '撤回操作人', '撤回时间', '时间'],
    rows.map((r) => [
      r.id,
      r.direction === 1 ? '发放' : '核销',
      r.userNickname || '',
      r.userPhone || '',
      r.uid,
      (r.direction === 1 ? '+' : '-') + fmtMoney(r.amount),
      r.batchId || '',
      r.merchantName || '',
      r.operatorNickname || (r.operatorUid ? 'UID:' + r.operatorUid : ''),
      r.operatorUid || '',
      r.bizId || '',
      r.remark || '',
      r.reversedAt ? '已撤回' : '有效',
      r.reversalReason || '',
      r.reversedBy || '',
      r.reversedAt ? fmtUnixTime(r.reversedAt) : '',
      fmtUnixTime(r.createdAt),
    ])
  )
  ElMessage.success(`已导出 ${rows.length} 条`)
}

async function load() {
  loading.value = true
  try {
    const { startAt, endAt } = dateRangeToUnix(dateRange.value)
    const data = await request.get('/api/admin/finance/cash-voucher-ledger', {
      params: {
        page: page.value,
        pageSize: pageSize.value,
        uid: filters.value.uid || undefined,
        direction: filters.value.direction ?? undefined,
        keyword: filters.value.keyword || undefined,
        startAt,
        endAt,
      },
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

function search() {
  page.value = 1
  load()
}

function reset() {
  filters.value = { keyword: '' }
  dateRange.value = lastNDaysRange(7)
  month.value = ''
  search()
}
</script>

<style scoped>
.amt-plus { color: #059669; font-weight: 600; }
.amt-minus { color: #d97706; font-weight: 600; }
</style>
