<template>
  <PageShell title="财务设置" subtitle="保留锦程数码业务所需配置（不含 CRMEB 佣金/提现）">
    <el-row :gutter="20">
      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>现金券核销模式</span></template>
          <p class="desc">控制小程序/商家端核销现金券时的金额规则。</p>
          <el-radio-group v-model="verifyMode" @change="saveVerifyMode">
            <el-radio-button value="any">任意金额</el-radio-button>
            <el-radio-button value="hundred">整百金额</el-radio-button>
          </el-radio-group>
          <p class="hint">当前：{{ verifyMode === 'any' ? '可核销任意金额（如 ¥66）' : '仅允许整百核销（如 ¥100）' }}</p>
        </el-card>
      </el-col>

      <el-col :span="12">
        <el-card shadow="never">
          <template #header><span>财务概览</span></template>
          <el-descriptions :column="1" border size="small" v-loading="loading">
            <el-descriptions-item label="现金券累计发放">{{ fmtMoney(summary.cashVoucher?.grantTotal) }}</el-descriptions-item>
            <el-descriptions-item label="现金券累计核销">{{ fmtMoney(summary.cashVoucher?.verifyTotal) }}</el-descriptions-item>
            <el-descriptions-item label="积分累计增加">{{ summary.integral?.grantTotal ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="积分累计消耗">{{ summary.integral?.consumeTotal ?? 0 }}</el-descriptions-item>
            <el-descriptions-item label="商家待结算">{{ fmtMoney(summary.settlement?.pendingTotal) }}</el-descriptions-item>
            <el-descriptions-item label="充值已支付">{{ fmtMoney(summary.recharge?.paidAmount) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="mt-16">
      <template #header><span>消费档位规则（只读）</span></template>
      <el-table :data="tierRules" size="small" border>
        <el-table-column prop="range" label="消费区间" width="160" />
        <el-table-column prop="tier" label="会员档位" width="120" />
        <el-table-column prop="gift" label="赠现金券" />
      </el-table>
    </el-card>

    <el-card shadow="never" class="mt-16">
      <template #header><span>菜单对照说明</span></template>
      <el-table :data="menuMap" size="small" border>
        <el-table-column prop="crmeb" label="CRMEB 财务菜单" width="160" />
        <el-table-column prop="ours" label="锦程对应" width="160" />
        <el-table-column prop="status" label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="row.enabled ? 'success' : 'info'" size="small">{{ row.enabled ? '保留' : '不采用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="note" label="说明" />
      </el-table>
    </el-card>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import { fmtMoney } from '@/utils/format'

const loading = ref(false)
const verifyMode = ref('any')
const summary = ref<any>({})

const tierRules = [
  { range: '¥2,000 – ¥3,000', tier: '锦程199会员', gift: '¥100 现金券' },
  { range: '¥3,000 – ¥6,000', tier: '锦程199会员', gift: '¥300 现金券' },
  { range: '¥6,000 – ¥10,000', tier: '锦程299会员', gift: '¥500 现金券' },
  { range: '¥10,000 以上', tier: '锦程299会员', gift: '¥800 现金券' },
]

const menuMap = [
  { crmeb: '资金流水', ours: '现金券流水', enabled: true, note: '发放+核销记录' },
  { crmeb: '资金记录', ours: '积分记录', enabled: true, note: 'sw_integral_ledger' },
  { crmeb: '充值记录', ours: '积分充值', enabled: true, note: 'MVP3 微信充值订单' },
  { crmeb: '账单记录', ours: '商家结算', enabled: true, note: '异业商家待结算台账' },
  { crmeb: '提现申请', ours: '—', enabled: false, note: '小程序无提现，不采用' },
  { crmeb: '佣金记录', ours: '—', enabled: false, note: '隐藏分销佣金' },
  { crmeb: '余额记录', ours: '—', enabled: false, note: '改用现金券钱包' },
]

onMounted(() => {
  loadSummary()
  loadVerifyMode()
})

async function loadSummary() {
  loading.value = true
  try {
    summary.value = await request.get('/api/admin/finance/summary')
    if (summary.value?.verifyMode) verifyMode.value = summary.value.verifyMode
  } catch { summary.value = {} }
  finally { loading.value = false }
}

async function loadVerifyMode() {
  try {
    const data = await request.get('/api/admin/finance/verify-mode')
    if (data?.mode) verifyMode.value = data.mode
  } catch { /* ignore */ }
}

async function saveVerifyMode(mode: string) {
  try {
    await request.put('/api/admin/cash-voucher/verify-mode', { mode })
    ElMessage.success('核销模式已更新')
  } catch { /* handled */ }
}
</script>

<style scoped>
.desc { margin: 0 0 12px; color: rgba(0,0,0,.55); font-size: 13px; }
.hint { margin: 12px 0 0; font-size: 12px; color: rgba(0,0,0,.45); }
.mt-16 { margin-top: 16px; }
</style>
