<template>
  <PageShell title="数据看板" subtitle="系统实时运行状态与核心业务指标概览">
    <template #actions>
      <el-space wrap :size="12">
        <el-radio-group v-model="range" size="default" @change="loadSummary">
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="7d">近7日</el-radio-button>
          <el-radio-button value="30d">近30日</el-radio-button>
        </el-radio-group>
        <el-button :loading="exporting" @click="exportReport" icon="Download">导出报表</el-button>
      </el-space>
    </template>

    <el-row :gutter="16" v-loading="loading" class="stat-row">
      <el-col :xs="24" :sm="12" :md="8" v-for="card in statCards" :key="card.key">
        <StatCard
          :type="card.type"
          :icon="card.icon"
          :title="card.title"
          :value="card.value"
          :clickable="!!card.onClick"
          @click="card.onClick?.()"
        />
      </el-col>
    </el-row>

    <div class="chart-section">
      <div class="section-head">
        <span class="section-title">积分趋势分析</span>
        <span class="section-desc">积分新增与消耗对比趋势（{{ rangeLabel }}）</span>
      </div>
      <LazyIntegralTrendChart
        :labels="trend.labels"
        :granted="trend.integralGranted"
        :consumed="trend.integralConsumed"
      />
    </div>

    <div class="quick-section">
      <span class="quick-label">业务快捷入口</span>
      <el-space wrap :size="24">
        <el-link type="primary" @click="router.push('/approval?tab=pending')" class="quick-link">
          <el-icon><Stamp /></el-icon>
          待审批业务 <strong class="badge-num">{{ cards.pendingApproval ?? 0 }}</strong> 项
        </el-link>
        <el-link @click="router.push('/approval?status=approved')" class="quick-link">
          <el-icon><CircleCheck /></el-icon>
          今日已通过 <strong class="badge-num">{{ cards.approvalApprovedToday ?? 0 }}</strong> 项
        </el-link>
        <el-link type="primary" @click="router.push('/finance-settlement')" class="quick-link">
          <el-icon><Wallet /></el-icon>
          待结算金额 <strong class="badge-num">¥{{ formatNum(cards.pendingSettlement) }}</strong>
        </el-link>
      </el-space>
    </div>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import StatCard from '@/components/StatCard.vue'
import LazyIntegralTrendChart from '@/components/LazyIntegralTrendChart'
import { downloadCsv } from '@/utils/csvExport'
import { ElMessage } from 'element-plus'

const router = useRouter()
const loading = ref(false)
const exporting = ref(false)
const range = ref<'today' | '7d' | '30d'>('today')
const cards = ref<Record<string, any>>({})
const trend = ref({ labels: [] as string[], integralGranted: [] as number[], integralConsumed: [] as number[] })

let timer: ReturnType<typeof setInterval> | null = null

const statCards = computed(() => [
  { key: 'member', type: 'member', icon: 'User', title: '全网会员总数', value: cards.value.memberTotal },
  { key: 'newuser', type: 'newuser', icon: 'UserFilled', title: '今日新注册会员', value: cards.value.newUsersToday, onClick: () => router.push('/members') },
  { key: 'grant', type: 'grant', icon: 'TrendCharts', title: '今日积分发放总量', value: cards.value.integralGrantedToday },
  { key: 'consume', type: 'consume', icon: 'Minus', title: '今日积分消耗总量', value: cards.value.integralConsumedToday },
  { key: 'verify', type: 'verify', icon: 'Checked', title: '今日核销订单数', value: cards.value.verifyToday },
  {
    key: 'approval',
    type: 'approval',
    icon: 'Document',
    title: '待审批申请数',
    value: cards.value.pendingApproval,
    onClick: () => router.push('/approval?tab=pending')
  },
])

const rangeLabel = computed(() => ({ today: '今日', '7d': '近7日', '30d': '近30日' }[range.value]))

function formatNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '--'
}

async function loadSummary() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/dashboard/summary', { params: { range: range.value } })
    cards.value = data?.cards || {}
    trend.value = data?.trend || { labels: [], integralGranted: [], integralConsumed: [] }
  } catch {
    cards.value = {}
    trend.value = { labels: [], integralGranted: [], integralConsumed: [] }
  } finally {
    loading.value = false
  }
}

function exportReport() {
  exporting.value = true
  try {
    const label = rangeLabel.value
    const c = cards.value
    const summaryRows: unknown[][] = [
      ['会员总数', c.memberTotal ?? 0],
      ['今日新注册', c.newUsersToday ?? 0],
      ['今日积分新增', c.integralGrantedToday ?? 0],
      ['今日积分消耗', c.integralConsumedToday ?? 0],
      ['今日核销', c.verifyToday ?? 0],
      ['待审批', c.pendingApproval ?? 0],
      ['今日审批通过', c.approvalApprovedToday ?? 0],
      ['待结算(元)', c.pendingSettlement ?? 0],
    ]
    downloadCsv(
      `dashboard-${range.value}.csv`,
      ['分类', '项目', '数值'],
      [
        ['范围', label, ''],
        ...summaryRows.map(([k, v]) => ['汇总', k, v]),
        ['', '', ''],
        ...(trend.value.labels || []).map((day, i) => [
          '趋势',
          day,
          `新增 ${trend.value.integralGranted[i] ?? 0} / 消耗 ${trend.value.integralConsumed[i] ?? 0}`,
        ]),
      ]
    )
    ElMessage.success('报表已导出')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  loadSummary()
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadSummary()
  }, 5 * 60 * 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<style scoped>
.stat-row {
  margin-bottom: 8px;
}

.chart-section {
  margin-top: 16px;
  padding-top: 24px;
  border-top: 1px solid var(--gov-border);
}

.section-head {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 20px;
}

.section-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--gov-text-primary);
}

.section-desc {
  font-size: 12px;
  color: var(--gov-text-secondary);
}

.quick-section {
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px dashed var(--gov-border);
}

.quick-label {
  display: block;
  font-size: 13px;
  font-weight: 600;
  color: var(--gov-text-secondary);
  margin-bottom: 12px;
}

.quick-link {
  font-size: 13px;
  font-weight: 500;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.quick-link :deep(.el-icon) {
  font-size: 14px;
}

.badge-num {
  font-weight: 700;
  margin: 0 2px;
}
</style>
