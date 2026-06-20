<template>
  <el-drawer v-model="visible" :title="`会员详情 · UID ${profile?.uid || ''}`" size="560px" destroy-on-close>
    <div v-loading="loading">
      <template v-if="profile">
        <el-descriptions :column="1" border size="small" class="mb-16">
          <el-descriptions-item label="昵称">{{ profile.nickname || '—' }}</el-descriptions-item>
          <el-descriptions-item label="手机">{{ profile.phone || '—' }}</el-descriptions-item>
          <el-descriptions-item label="等级">
            <MemberTag v-if="profile.tierCode" :tag="profile.tierCode" />
            <MemberTag v-else tag="normal" />
            <MemberTag v-for="t in (profile.tags || []).filter((x: string) => !['tier199','tier299','normal'].includes(x))" :key="t" :tag="t" style="margin-left: 4px" />
          </el-descriptions-item>
          <el-descriptions-item label="归属店员">
            {{ profile.spreadNickname ? `${profile.spreadNickname} (${profile.spreadUid})` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="积分">{{ integralSummary?.totalIntegral ?? 0 }}</el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">快捷操作</el-divider>
        <el-space wrap>
          <el-button type="primary" size="small" @click="showGrantIntegral = true">发放积分</el-button>
          <el-button size="small" @click="showGrantVoucher = true">发放现金券</el-button>
          <el-button size="small" @click="showGrantMembership = true">手动开通会员</el-button>
          <el-button size="small" @click="changeSpread">变更归属</el-button>
          <el-button size="small" @click="toggleStaff">{{ profile.isStaff ? '撤销店员' : '开通店员' }}</el-button>
        </el-space>

        <el-tabs v-model="activeTab" class="mt-16">
          <el-tab-pane label="积分批次" name="batches">
            <el-table :data="integralBatches" size="small" max-height="240">
              <el-table-column prop="batchType" label="类型" width="70" />
              <el-table-column prop="remainAmount" label="剩余" width="80" />
              <el-table-column prop="expireAt" label="过期" :formatter="fmtTime" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="现金券" name="voucher">
            <el-table :data="cashVoucherBatches" size="small" max-height="240">
              <el-table-column prop="remainAmount" label="余额" width="80" />
              <el-table-column prop="sourceType" label="来源" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="审批历史" name="approval">
            <el-table :data="approvalHistory" size="small" max-height="240">
              <el-table-column prop="requestId" label="ID" width="60" />
              <el-table-column prop="consumptionAmount" label="金额" width="80" />
              <el-table-column prop="status" label="状态" />
            </el-table>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>

    <el-dialog v-model="showGrantIntegral" title="发放积分" width="400px" append-to-body>
      <el-form :model="grantForm" label-width="80px">
        <el-form-item label="数量"><el-input-number v-model="grantForm.amount" :min="1" /></el-form-item>
        <el-form-item label="类型">
          <el-select v-model="grantForm.batchType">
            <el-option label="赠送" value="gift" />
            <el-option label="调整" value="adjust" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="grantForm.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGrantIntegral = false">取消</el-button>
        <el-button type="primary" @click="confirmGrant">确认发放</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrantVoucher" title="发放现金券" width="400px" append-to-body>
      <el-form :model="voucherForm" label-width="80px">
        <el-form-item label="金额"><el-input-number v-model="voucherForm.amount" :min="1" :max="100000" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="voucherForm.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGrantVoucher = false">取消</el-button>
        <el-button type="primary" @click="confirmGrantVoucher">确认发放</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrantMembership" title="手动开通会员" width="400px" append-to-body>
      <el-form :model="membershipForm" label-width="88px">
        <el-form-item label="会员档位">
          <el-select v-model="membershipForm.tierCode" style="width: 100%">
            <el-option label="199会员 (SW199)" value="SW199" />
            <el-option label="299会员 (SW299)" value="SW299" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGrantMembership = false">取消</el-button>
        <el-button type="primary" @click="confirmGrantMembership">确认开通</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import MemberTag from '@/components/MemberTag.vue'

const props = defineProps<{ uid: number | null }>()
const visible = defineModel<boolean>({ default: false })

const loading = ref(false)
const profile = ref<any>(null)
const integralSummary = ref<any>(null)
const integralBatches = ref<any[]>([])
const cashVoucherBatches = ref<any[]>([])
const approvalHistory = ref<any[]>([])
const activeTab = ref('batches')
const showGrantIntegral = ref(false)
const showGrantVoucher = ref(false)
const showGrantMembership = ref(false)
const grantForm = ref({ amount: 1000, batchType: 'gift', remark: '超管手动发放' })
const voucherForm = ref({ amount: 100, remark: '超管手动发放' })
const membershipForm = ref({ tierCode: 'SW199' as 'SW199' | 'SW299' })

watch(() => [props.uid, visible.value], ([uid, open]) => {
  if (open && uid) loadDetail(uid as number)
}, { immediate: true })

function fmtTime(_row: any, _col: any, val: number) {
  if (!val) return '永久'
  return new Date(val * 1000).toLocaleDateString('zh-CN')
}

async function loadDetail(uid: number) {
  loading.value = true
  try {
    const data = await request.get(`/api/admin/members/${uid}/detail`)
    profile.value = data.profile
    integralSummary.value = data.integralSummary
    integralBatches.value = data.integralBatches || []
    cashVoucherBatches.value = data.cashVoucherBatches || []
    approvalHistory.value = data.approvalHistory || []
  } catch {
    profile.value = null
  } finally {
    loading.value = false
  }
}

async function confirmGrant() {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm(
      `确认为 UID ${props.uid} 发放 ${grantForm.value.amount} 积分？`,
      '二次确认',
      { type: 'warning' }
    )
    await submitGrant()
  } catch { /* cancel */ }
}

async function submitGrant() {
  if (!props.uid) return
  await request.post('/api/admin/integral/grant', {
    uid: props.uid,
    ...grantForm.value
  })
  ElMessage.success('积分发放成功')
  showGrantIntegral.value = false
  activeTab.value = 'batches'
  loadDetail(props.uid)
}

async function confirmGrantVoucher() {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm(
      `确认为 UID ${props.uid} 发放 ¥${voucherForm.value.amount} 现金券？`,
      '二次确认',
      { type: 'warning' }
    )
    await request.post('/api/admin/cash-voucher/grant', {
      uid: props.uid,
      ...voucherForm.value
    })
    ElMessage.success('现金券发放成功')
    showGrantVoucher.value = false
    activeTab.value = 'voucher'
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function confirmGrantMembership() {
  if (!props.uid) return
  const label = membershipForm.value.tierCode === 'SW199' ? '199会员' : '299会员'
  try {
    await ElMessageBox.confirm(
      `确认为 UID ${props.uid} 开通 ${label}？`,
      '二次确认',
      { type: 'warning' }
    )
    await request.post('/api/admin/membership/grant', {
      uid: props.uid,
      tierCode: membershipForm.value.tierCode
    })
    ElMessage.success('会员开通成功')
    showGrantMembership.value = false
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function changeSpread() {
  if (!props.uid) return
  try {
    const { value } = await ElMessageBox.prompt('请输入新归属店员的 UID', '变更归属', {
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入有效的数字 UID',
      confirmButtonText: '确认变更'
    })
    await request.put(`/api/admin/members/${props.uid}/spread`, {
      spreadUid: Number(value)
    })
    ElMessage.success('归属店员已更新')
    loadDetail(props.uid)
  } catch { /* cancel or error */ }
}

async function toggleStaff() {
  if (!props.uid || !profile.value) return
  const isStaff = profile.value.isStaff
  if (!isStaff) {
    const { value } = await ElMessageBox.prompt('请输入 divisionId（门店ID）', '开通店员', {
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入数字'
    })
    await request.put(`/api/admin/members/${props.uid}/staff-role`, {
      action: 'grant',
      divisionId: Number(value)
    })
    ElMessage.success('店员权限已开通')
  } else {
    const { value } = await ElMessageBox.prompt(
      '撤销店员为危险操作，请输入「确认撤销」以继续',
      '撤销店员',
      {
        confirmButtonText: '确认撤销',
        confirmButtonClass: 'el-button--danger',
        inputPattern: /^确认撤销$/,
        inputErrorMessage: '请输入「确认撤销」'
      }
    )
    if (value !== '确认撤销') return
    await request.put(`/api/admin/members/${props.uid}/staff-role`, { action: 'revoke' })
    ElMessage.success('店员权限已撤销')
  }
  loadDetail(props.uid)
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.mt-16 { margin-top: 16px; }
</style>
