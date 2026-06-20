<template>
  <PageShell title="数据看板">
    <template #actions>
      <el-space wrap :size="12">
        <el-radio-group v-model="range" size="default" @change="loadSummary">
          <el-radio-button value="today">今日</el-radio-button>
          <el-radio-button value="7d">近7日</el-radio-button>
          <el-radio-button value="30d">近30日</el-radio-button>
        </el-radio-group>
        <el-button :loading="exporting" @click="exportReport">导出报表</el-button>
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
        <span class="section-title">积分趋势</span>
        <span class="section-desc">新增 vs 消耗（{{ rangeLabel }}）</span>
      </div>
      <LazyIntegralTrendChart
        :labels="trend.labels"
        :granted="trend.integralGranted"
        :consumed="trend.integralConsumed"
      />
    </div>

    <div class="quick-section">
      <span class="quick-label">快捷入口</span>
      <el-space wrap :size="16">
        <el-link type="primary" @click="router.push('/approval?tab=pending')">
          待审批 {{ cards.pendingApproval ?? 0 }} 条
        </el-link>
        <el-link @click="router.push('/approval?status=approved')">
          今日通过 {{ cards.approvalApprovedToday ?? 0 }} 条
        </el-link>
        <el-link type="primary" @click="router.push('/finance-settlement')">
          待结算 ¥{{ formatNum(cards.pendingSettlement) }}
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
  { key: 'member', type: 'member', icon: 'User', title: '会员总数', value: cards.value.memberTotal },
  { key: 'newuser', type: 'newuser', icon: 'UserFilled', title: '今日新注册', value: cards.value.newUsersToday },
  { key: 'grant', type: 'grant', icon: 'TrendCharts', title: '今日积分新增', value: cards.value.integralGrantedToday },
  { key: 'consume', type: 'consume', icon: 'Minus', title: '今日积分消耗', value: cards.value.integralConsumedToday },
  { key: 'verify', type: 'verify', icon: 'Checked', title: '今日核销', value: cards.value.verifyToday },
  {
    key: 'approval',
    type: 'approval',
    icon: 'Document',
    title: '待审批',
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
.stat-row { margin-bottom: 4px; }
.chart-section {
  margin-top: 8px;
  padding-top: 20px;
  border-top: 1px solid #f0f0f0;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 16px;
}
.section-title {
  font-size: 16px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}
.section-desc {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
.quick-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px dashed #f0f0f0;
}
.quick-label {
  display: block;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
  margin-bottom: 10px;
}
</style>
