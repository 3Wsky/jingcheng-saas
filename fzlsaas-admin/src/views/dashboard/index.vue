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
          :prefix="card.prefix"
          :clickable="!!card.onClick"
          @click="card.onClick?.()"
        />
      </el-col>
    </el-row>

    <div class="pool-section" v-if="pool.budget">
      <div class="section-head">
        <span class="section-title">现金池额度</span>
        <span class="section-desc">积分（1000积分=¥1）+ 现金券已发放总额</span>
      </div>
      <div class="pool-body">
        <LiquidFillChart
          :ratio="1 - pool.ratio"
          label="剩余"
          :size="200"
          :color1="pool.ratio > 0.8 ? '#e34d59' : pool.ratio > 0.6 ? '#ed7b2f' : '#0052d9'"
          :color2="pool.ratio > 0.8 ? '#ff6a6a' : pool.ratio > 0.6 ? '#f5a623' : '#00a870'"
        />
        <div class="pool-stats">
          <div class="ps-row">
            <span class="ps-label">总预算</span>
            <span class="ps-value main">¥{{ formatNum(pool.budget) }}</span>
          </div>
          <div class="ps-row">
            <span class="ps-label">已使用</span>
            <span class="ps-value used">¥{{ formatNum(pool.used) }}</span>
          </div>
          <div class="ps-row sub">
            <span class="ps-label">　├ 积分折现</span>
            <span class="ps-value">¥{{ formatNum(Math.round(pool.integralGrantedTotal / 1000 * 100) / 100) }}</span>
          </div>
          <div class="ps-row sub">
            <span class="ps-label">　└ 现金券</span>
            <span class="ps-value">¥{{ formatNum(pool.cashVoucherGrantedTotal) }}</span>
          </div>
          <div class="ps-row">
            <span class="ps-label">剩余额度</span>
            <span class="ps-value remain">¥{{ formatNum(pool.remain) }}</span>
          </div>
          <div class="pause-controls">
            <div class="pause-item" :class="{ active: pauseStatus.grant }">
              <span class="pause-label">发放开关</span>
              <el-switch
                :model-value="!pauseStatus.grant"
                :loading="pauseLoading"
                active-text="正常"
                inactive-text="已暂停"
                inline-prompt
                style="--el-switch-on-color: #00a870; --el-switch-off-color: #e34d59"
                @change="(val: boolean) => togglePause('grant', !val)"
              />
            </div>
            <div class="pause-item" :class="{ active: pauseStatus.verify }">
              <span class="pause-label">核销开关</span>
              <el-switch
                :model-value="!pauseStatus.verify"
                :loading="pauseLoading"
                active-text="正常"
                inactive-text="已暂停"
                inline-prompt
                style="--el-switch-on-color: #00a870; --el-switch-off-color: #e34d59"
                @change="(val: boolean) => togglePause('verify', !val)"
              />
            </div>
          </div>
        </div>
      </div>
    </div>

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
import LiquidFillChart from '@/components/LiquidFillChart.vue'
import { downloadCsv } from '@/utils/csvExport'
import { ElMessage, ElMessageBox } from 'element-plus'

const router = useRouter()
const loading = ref(false)
const exporting = ref(false)
const range = ref<'today' | '7d' | '30d'>('today')
const cards = ref<Record<string, any>>({})
const trend = ref({ labels: [] as string[], integralGranted: [] as number[], integralConsumed: [] as number[] })
const pool = ref({ budget: 0, integralGrantedTotal: 0, cashVoucherGrantedTotal: 0, used: 0, remain: 0, ratio: 0 })
const pauseStatus = ref({ grant: false, verify: false })
const pauseLoading = ref(false)

let timer: ReturnType<typeof setInterval> | null = null

const periodGrantTitle = computed(() => ({
  today: '今日现金券发放',
  '7d': '近7日现金券发放',
  '30d': '近30日现金券发放',
}[range.value]))

const statCards = computed(() => [
  { key: 'member', type: 'member', icon: 'User', title: '全网会员总数', value: cards.value.memberTotal },
  { key: 'newuser', type: 'newuser', icon: 'UserFilled', title: '今日新注册会员', value: cards.value.newUsersToday, onClick: () => router.push('/members') },
  { key: 'grant', type: 'grant', icon: 'TrendCharts', title: '今日积分发放总量', value: cards.value.integralGrantedToday },
  { key: 'consume', type: 'consume', icon: 'Minus', title: '今日积分消耗总量', value: cards.value.integralConsumedToday },
  {
    key: 'cash-grant-total',
    type: 'voucher',
    icon: 'Money',
    title: '已发放现金券金额汇总',
    value: cards.value.cashVoucherGrantTotal,
    prefix: '¥',
    onClick: () => router.push('/finance-cash'),
  },
  {
    key: 'cash-grant-period',
    type: 'grant',
    icon: 'Wallet',
    title: periodGrantTitle.value,
    value: cards.value.cashVoucherGrantedInPeriod,
    prefix: '¥',
    onClick: () => router.push('/finance-cash'),
  },
  { key: 'verify', type: 'verify', icon: 'Checked', title: '今日核销订单数', value: cards.value.verifyToday },
  {
    key: 'verify-amount-total',
    type: 'voucher',
    icon: 'GoldMedal',
    title: '已核销总金额',
    value: cards.value.verifyAmountTotal,
    prefix: '¥',
    onClick: () => router.push('/finance-cash'),
  },
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
    pool.value = data?.fundPool || { budget: 0, integralGrantedTotal: 0, cashVoucherGrantedTotal: 0, used: 0, remain: 0, ratio: 0 }
    if (data?.pauseStatus) pauseStatus.value = data.pauseStatus
  } catch {
    cards.value = {}
    trend.value = { labels: [], integralGranted: [], integralConsumed: [] }
    pool.value = { budget: 0, integralGrantedTotal: 0, cashVoucherGrantedTotal: 0, used: 0, remain: 0, ratio: 0 }
  } finally {
    loading.value = false
  }
}

async function togglePause(type: 'grant' | 'verify', enabled: boolean) {
  const label = type === 'grant' ? '发放' : '核销'
  if (enabled) {
    try {
      await ElMessageBox.confirm(
        `确认暂停所有${label}操作？用户端将提示"网络传输故障"`,
        `暂停${label}`,
        { type: 'warning', confirmButtonText: '确认暂停', cancelButtonText: '取消' }
      )
    } catch { return }
  }
  pauseLoading.value = true
  try {
    await request.post('/api/admin/dashboard/pause', { type, enabled })
    pauseStatus.value[type] = enabled
    ElMessage.success(enabled ? `${label}已暂停` : `${label}已恢复`)
  } catch (e: any) {
    ElMessage.error(e.message || '操作失败')
  } finally {
    pauseLoading.value = false
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
      ['已发放现金券汇总(元)', c.cashVoucherGrantTotal ?? 0],
      [`${label}现金券发放(元)`, c.cashVoucherGrantedInPeriod ?? 0],
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

.pool-section {
  margin-top: 16px;
  padding: 24px;
  background: var(--gov-bg-card, #fff);
  border-radius: var(--gov-radius-card, 8px);
  border: 1px solid var(--gov-border, #e8e8e8);
  box-shadow: var(--gov-shadow-card);
}

.pool-body {
  display: flex;
  align-items: center;
  gap: 48px;
  margin-top: 20px;
}

.pool-stats {
  flex: 1;
  min-width: 0;
}

.ps-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 8px 0;
  border-bottom: 1px dashed var(--gov-border, #e8e8e8);
}

.ps-row:last-child {
  border-bottom: none;
}

.ps-row.sub {
  padding: 4px 0;
  border-bottom: none;
}

.ps-label {
  font-size: 13px;
  color: var(--gov-text-secondary, #8b95a5);
}

.ps-row.sub .ps-label {
  font-size: 12px;
  color: var(--gov-text-muted, #c0c4cc);
}

.ps-value {
  font-size: 15px;
  font-weight: 600;
  color: var(--gov-text-primary, #1a1a1a);
  font-variant-numeric: tabular-nums;
}

.ps-value.main {
  font-size: 18px;
  font-weight: 700;
}

.ps-value.used {
  color: var(--gov-primary, #0052d9);
}

.ps-value.remain {
  color: #00a870;
  font-size: 16px;
}

.ps-row.sub .ps-value {
  font-size: 13px;
  font-weight: 500;
  color: var(--gov-text-secondary, #8b95a5);
}

.pause-controls {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--gov-border, #e8e8e8);
  display: flex;
  gap: 24px;
}

.pause-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 8px;
  transition: background 0.2s;
}

.pause-item.active {
  background: #fff0f0;
}

.pause-label {
  font-size: 13px;
  color: var(--gov-text-secondary, #8b95a5);
  font-weight: 500;
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
