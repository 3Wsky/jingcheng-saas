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
      <template #header>
        <div style="display: flex; justify-content: space-between; align-items: center">
          <span>消费档位规则</span>
          <el-button type="primary" size="small" @click="openTierForm()">新增档位</el-button>
        </div>
      </template>
      <el-table :data="tierRules" size="small" border v-loading="tierLoading">
        <el-table-column label="消费区间" width="180">
          <template #default="{ row }">
            ¥{{ row.minAmount?.toLocaleString() }} — {{ row.maxAmount ? '¥' + row.maxAmount.toLocaleString() : '无上限' }}
          </template>
        </el-table-column>
        <el-table-column label="会员档位" width="120">
          <template #default="{ row }">{{ row.tierCode === 'SW299' ? '锦程299' : '锦程199' }}</template>
        </el-table-column>
        <el-table-column label="赠现金券" width="120">
          <template #default="{ row }">¥{{ row.voucherAmount }}</template>
        </el-table-column>
        <el-table-column label="赠积分" width="120">
          <template #default="{ row }">{{ row.giftIntegral?.toLocaleString() }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.isActive ? 'success' : 'info'" size="small">{{ row.isActive ? '启用' : '停用' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openTierForm(row)">编辑</el-button>
            <el-button link type="danger" @click="deleteTierRule(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="tierDialogOpen" :title="tierFormId ? '编辑档位规则' : '新增档位规则'" width="480px" destroy-on-close>
      <el-form :model="tierForm" label-width="100px">
        <el-form-item label="最低消费">
          <el-input-number v-model="tierForm.minAmount" :min="0" :step="1000" style="width: 100%" />
        </el-form-item>
        <el-form-item label="最高消费">
          <el-input-number v-model="tierForm.maxAmount" :min="0" :step="1000" style="width: 100%" />
          <p class="hint">填 0 表示无上限</p>
        </el-form-item>
        <el-form-item label="会员档位">
          <el-select v-model="tierForm.tierCode" style="width: 100%">
            <el-option label="锦程199会员" value="SW199" />
            <el-option label="锦程299会员" value="SW299" />
          </el-select>
        </el-form-item>
        <el-form-item label="赠现金券">
          <el-input-number v-model="tierForm.voucherAmount" :min="0" :step="100" style="width: 100%" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="tierForm.isActive" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="tierDialogOpen = false">取消</el-button>
        <el-button type="primary" :loading="tierSaving" @click="saveTierRule">保存</el-button>
      </template>
    </el-dialog>

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
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import { fmtMoney } from '@/utils/format'

const loading = ref(false)
const verifyMode = ref('any')
const summary = ref<any>({})
const tierRules = ref<any[]>([])
const tierLoading = ref(false)
const tierDialogOpen = ref(false)
const tierFormId = ref<number | null>(null)
const tierForm = ref({ minAmount: 0, maxAmount: 0, tierCode: 'SW199' as string, voucherAmount: 0, isActive: true })
const tierSaving = ref(false)

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
  loadTierRules()
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

async function loadTierRules() {
  tierLoading.value = true
  try {
    const data = await request.get('/api/admin/tier-rules')
    tierRules.value = Array.isArray(data) ? data : []
  } catch {
    tierRules.value = []
  } finally {
    tierLoading.value = false
  }
}

function openTierForm(row?: any) {
  if (row) {
    tierFormId.value = row.id
    tierForm.value = {
      minAmount: row.minAmount ?? 0,
      maxAmount: row.maxAmount ?? 0,
      tierCode: row.tierCode || 'SW199',
      voucherAmount: row.voucherAmount ?? 0,
      isActive: row.isActive !== false
    }
  } else {
    tierFormId.value = null
    tierForm.value = { minAmount: 0, maxAmount: 0, tierCode: 'SW199', voucherAmount: 0, isActive: true }
  }
  tierDialogOpen.value = true
}

async function saveTierRule() {
  tierSaving.value = true
  try {
    const payload = {
      ...tierForm.value,
      maxAmount: tierForm.value.maxAmount || null
    }
    if (tierFormId.value) {
      await request.put(`/api/admin/tier-rules/${tierFormId.value}`, payload)
      ElMessage.success('档位规则已更新')
    } else {
      await request.post('/api/admin/tier-rules', payload)
      ElMessage.success('档位规则已创建')
    }
    tierDialogOpen.value = false
    loadTierRules()
  } catch { /* handled */ }
  finally { tierSaving.value = false }
}

async function deleteTierRule(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除消费区间 ¥${row.minAmount} 的档位规则？`, '删除档位', { type: 'warning' })
    await request.delete(`/api/admin/tier-rules/${row.id}`)
    ElMessage.success('档位规则已停用')
    loadTierRules()
  } catch { /* cancel */ }
}
</script>

<style scoped>
.desc { margin: 0 0 12px; color: rgba(0,0,0,.55); font-size: 13px; }
.hint { margin: 12px 0 0; font-size: 12px; color: rgba(0,0,0,.45); }
.mt-16 { margin-top: 16px; }
</style>
