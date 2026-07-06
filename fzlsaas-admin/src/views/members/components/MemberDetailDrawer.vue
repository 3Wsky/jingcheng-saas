<template>
  <el-drawer v-model="visible" :title="`会员详情 · UID ${profile?.uid || ''}`" size="720px" destroy-on-close>
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
          <el-descriptions-item label="归属客户经理">
            {{ profile.spreadNickname ? `${profile.spreadNickname} (${profile.spreadUid})` : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="商家角色">
            <template v-if="merchantRoles.length">
              <el-tag v-for="item in merchantRoles" :key="item.merchantId" size="small" style="margin-right: 4px">
                {{ item.merchantName }} · {{ item.role === 'manager' ? '商家负责人' : '核销员' }}
              </el-tag>
            </template>
            <span v-else>—</span>
          </el-descriptions-item>
          <el-descriptions-item label="积分">{{ integralSummary?.totalIntegral ?? 0 }}</el-descriptions-item>
        </el-descriptions>

        <div class="asset-overview">
          <div class="asset-card">
            <div class="asset-label">积分余额</div>
            <div class="asset-value">{{ (integralSummary?.totalIntegral ?? 0).toLocaleString() }}</div>
          </div>
          <div class="asset-card">
            <div class="asset-label">现金券余额</div>
            <div class="asset-value money">¥{{ formatMoney(voucherBalance) }}</div>
          </div>
          <div class="asset-card">
            <div class="asset-label">累计核销消费</div>
            <div class="asset-value out">¥{{ formatMoney(cashVoucherUsedTotal) }}</div>
            <div class="asset-sub">{{ cashVoucherUsage.length }} 笔核销</div>
          </div>
        </div>

        <el-divider content-position="left">快捷操作</el-divider>
        <el-space wrap>
          <el-button type="primary" size="small" @click="showGrantIntegral = true">发放积分</el-button>
          <el-button size="small" @click="showGrantVoucher = true">发放现金券</el-button>
          <el-button type="warning" plain size="small" @click="showDemoAssets = true">发放演示资产</el-button>
          <el-button size="small" @click="showGrantMembership = true">手动开通会员</el-button>
          <el-button size="small" @click="changeSpread">变更归属</el-button>
          <el-button size="small" @click="clearSpread">清除归属</el-button>
          <el-button size="small" @click="toggleStaff">{{ profile.isStaff ? '撤销客户经理' : '开通客户经理' }}</el-button>
          <el-button size="small" @click="toggleStoreManager">{{ profile.isManager ? '撤销客户主管' : '设为客户主管' }}</el-button>
          <el-button size="small" @click="openMerchantRole">商家角色</el-button>
        </el-space>

        <template v-if="isSuperAdmin">
          <el-divider content-position="left">
            <span style="color: #F56C6C">回收操作（仅超管）</span>
          </el-divider>
          <el-space wrap>
            <el-button type="danger" size="small" plain @click="recallVoucher">回收现金券</el-button>
            <el-button type="danger" size="small" plain @click="recallMembership">回收会员</el-button>
            <el-button type="danger" size="small" plain @click="showRecallIntegral = true">回收积分</el-button>
          </el-space>
        </template>

        <el-tabs v-model="activeTab" class="mt-16">
          <el-tab-pane name="voucher">
            <template #label>
              <span>核销记录<el-badge v-if="cashVoucherUsage.length" :value="cashVoucherUsage.length" class="tab-badge" type="danger" /></span>
            </template>
            <div class="sub-head">
              消费明细（现金券核销）
              <span class="sub-sum">累计消费 ¥{{ formatMoney(cashVoucherUsedTotal) }}</span>
            </div>
            <el-table :data="cashVoucherUsage" size="small" max-height="320" stripe>
              <template #empty><el-empty description="该会员暂无现金券核销记录" :image-size="56" /></template>
              <el-table-column label="金额" width="92">
                <template #default="{ row }">
                  <span class="amt-out">-¥{{ formatMoney(row.amount) }}</span>
                </template>
              </el-table-column>
              <el-table-column label="核销商家" min-width="130">
                <template #default="{ row }">{{ row.merchantName || '—' }}</template>
              </el-table-column>
              <el-table-column label="核销员" min-width="110">
                <template #default="{ row }">
                  {{ row.operatorNickname || (row.operatorUid ? 'UID:' + row.operatorUid : '—') }}
                </template>
              </el-table-column>
              <el-table-column label="核销时间" width="150">
                <template #default="{ row }">{{ fmtDateTime(row.createdAt) }}</template>
              </el-table-column>
            </el-table>

            <div class="sub-head">
              现金券余额批次
              <span class="sub-sum money">当前余额 ¥{{ formatMoney(voucherBalance) }}</span>
            </div>
            <el-table :data="cashVoucherBatches" size="small" max-height="180">
              <template #empty><el-empty description="暂无现金券批次" :image-size="48" /></template>
              <el-table-column label="余额" width="90">
                <template #default="{ row }">¥{{ formatMoney(row.remainAmount) }}</template>
              </el-table-column>
              <el-table-column prop="sourceType" label="来源" min-width="120" />
              <el-table-column label="操作" width="72" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="isSuperAdmin && Number(row.remainAmount) > 0"
                    link
                    type="danger"
                    size="small"
                    @click="reclaimVoucher(row)"
                  >回收</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="积分批次" name="batches">
            <el-table :data="integralBatches" size="small" max-height="320">
              <el-table-column prop="batchType" label="类型" width="70" />
              <el-table-column prop="remainAmount" label="剩余" width="80" />
              <el-table-column prop="expireAt" label="过期" :formatter="fmtTime" />
            </el-table>
          </el-tab-pane>
          <el-tab-pane label="会员记录" name="membership">
            <el-table :data="membershipRecords" size="small" max-height="240">
              <el-table-column prop="tierCode" label="档位" width="72" />
              <el-table-column prop="sourceChannel" label="来源" width="100" />
              <el-table-column prop="grantedIntegral" label="赠积分" width="80" />
              <el-table-column label="状态" width="64">
                <template #default="{ row }">
                  {{ row.status === 1 ? '有效' : '已失效' }}
                </template>
              </el-table-column>
              <el-table-column label="操作" width="72" align="center">
                <template #default="{ row }">
                  <el-button
                    v-if="isSuperAdmin && row.status === 1"
                    link
                    type="danger"
                    size="small"
                    @click="reclaimMembership(row)"
                  >回收</el-button>
                </template>
              </el-table-column>
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

    <el-dialog v-model="showDemoAssets" title="发放演示资产" width="420px" append-to-body>
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
        演示资产用于拍摄测试：演示券核销不进入商家待结算；演示积分兑换不扣真实库存。
      </el-alert>
      <el-form :model="demoForm" label-width="96px">
        <el-form-item label="演示积分">
          <el-input-number v-model="demoForm.integralAmount" :min="0" :max="10000000" :step="1000" />
        </el-form-item>
        <el-form-item label="演示现金券">
          <el-input-number v-model="demoForm.cashVoucherAmount" :min="0" :max="100000" :step="100" />
        </el-form-item>
        <el-form-item label="备注"><el-input v-model="demoForm.remark" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDemoAssets = false">取消</el-button>
        <el-button type="warning" @click="confirmGrantDemoAssets">确认发放</el-button>
      </template>
    </el-dialog>

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

    <el-dialog v-model="showGrantStaff" title="开通客户经理" width="420px" append-to-body>
      <el-form label-width="88px">
        <el-form-item label="所属门店" required>
          <StoreNameSelect v-model="staffStoreName" placeholder="选择已有门店，或直接输入新门店名称" />
        </el-form-item>
        <p class="hint">输入新名称将自动创建门店；下次可直接从历史门店中选择。</p>
      </el-form>
      <template #footer>
        <el-button @click="showGrantStaff = false">取消</el-button>
        <el-button type="primary" @click="confirmGrantStaff">确认开通</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrantManager" title="设为客户主管" width="420px" append-to-body>
      <el-form label-width="88px">
        <el-form-item label="所属门店">
          <StoreNameSelect v-model="managerStoreName" placeholder="留空则使用用户当前门店 division_id" />
        </el-form-item>
        <p class="hint">设为客户主管会自动开通客户经理权限；同一门店可配置 1–2 名客户主管。</p>
      </el-form>
      <template #footer>
        <el-button @click="showGrantManager = false">取消</el-button>
        <el-button type="primary" @click="confirmGrantManager">确认设为客户主管</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showGrantMembership" title="手动开通会员" width="400px" append-to-body>
      <el-form :model="membershipForm" label-width="88px">
        <el-form-item label="会员档位">
          <el-select v-model="membershipForm.tierCode" style="width: 100%">
            <el-option label="199会员" value="SW199" />
            <el-option label="299会员" value="SW299" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showGrantMembership = false">取消</el-button>
        <el-button type="primary" @click="confirmGrantMembership">确认开通</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showRecallIntegral" title="回收积分" width="400px" append-to-body>
      <el-alert type="warning" :closable="false" style="margin-bottom: 12px">
        此操作将从该用户账户中扣减积分，请确认回收数量。
      </el-alert>
      <el-form :model="recallIntegralForm" label-width="80px">
        <el-form-item label="回收数量">
          <el-input-number v-model="recallIntegralForm.amount" :min="1" :max="integralSummary?.totalIntegral || 999999" />
        </el-form-item>
        <el-form-item label="原因"><el-input v-model="recallIntegralForm.reason" placeholder="超管回收积分" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showRecallIntegral = false">取消</el-button>
        <el-button type="danger" @click="confirmRecallIntegral">确认回收</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="showMerchantRole" title="商家角色" width="460px" append-to-body>
      <p class="hint">用户需先在小程序登录（有 UID/头像/昵称）。开通后可在「我的 → 商家核销与提现」入口使用。</p>
      <el-form label-width="88px">
        <el-form-item label="商家" required>
          <el-select v-model="merchantForm.merchantId" filterable placeholder="选择商家" style="width: 100%">
            <el-option v-for="item in merchantOptions" :key="item.id" :label="item.merchantName" :value="item.id" />
          </el-select>
        </el-form-item>
        <el-form-item label="角色" required>
          <el-radio-group v-model="merchantForm.role">
            <el-radio value="staff">核销员（可核销）</el-radio>
            <el-radio value="manager">商家负责人（核销+管理）</el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <div v-if="merchantRoles.length" class="current-roles">
        <div class="current-title">当前角色</div>
        <div v-for="item in merchantRoles" :key="item.merchantId" class="role-row">
          <span>{{ item.merchantName }} · {{ item.role === 'manager' ? '商家负责人' : '核销员' }}</span>
          <el-button link type="danger" @click="revokeMerchantRole(item.merchantId)">撤销</el-button>
        </div>
      </div>
      <template #footer>
        <el-button @click="showMerchantRole = false">取消</el-button>
        <el-button type="primary" @click="confirmMerchantRole">确认开通</el-button>
      </template>
    </el-dialog>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import MemberTag from '@/components/MemberTag.vue'
import StoreNameSelect from '@/components/StoreNameSelect.vue'
import { rememberStoreName } from '@/utils/recentStores'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
const isSuperAdmin = computed(() => userStore.isSuperAdmin)

const props = defineProps<{ uid: number | null }>()
const visible = defineModel<boolean>({ default: false })

const loading = ref(false)
const profile = ref<any>(null)
const integralSummary = ref<any>(null)
const integralBatches = ref<any[]>([])
const cashVoucherBatches = ref<any[]>([])
const cashVoucherUsage = ref<any[]>([])
const cashVoucherUsedTotal = ref(0)
const membershipRecords = ref<any[]>([])
const approvalHistory = ref<any[]>([])
const activeTab = ref('voucher')
const showDemoAssets = ref(false)
const showGrantIntegral = ref(false)
const showGrantVoucher = ref(false)
const showGrantStaff = ref(false)
const showGrantManager = ref(false)
const showGrantMembership = ref(false)
const staffStoreName = ref('')
const managerStoreName = ref('')
const grantForm = ref({ amount: 1000, batchType: 'gift', remark: '超管手动发放' })
const voucherForm = ref({ amount: 100, remark: '超管手动发放' })
const demoForm = ref({ integralAmount: 299000, cashVoucherAmount: 500, remark: '拍摄演示' })
const membershipForm = ref({ tierCode: 'SW199' as 'SW199' | 'SW299' })
const merchantRoles = ref<any[]>([])
const merchantOptions = ref<Array<{ id: number; merchantName: string }>>([])
const showMerchantRole = ref(false)
const merchantForm = ref({ merchantId: undefined as number | undefined, role: 'staff' as 'staff' | 'manager' })
const showRecallIntegral = ref(false)
const recallIntegralForm = ref({ amount: 1000, reason: '超管回收积分' })

const voucherBalance = computed(() =>
  cashVoucherBatches.value.reduce((sum: number, b: any) => sum + Number(b.remainAmount || 0), 0)
)

watch(() => [props.uid, visible.value], ([uid, open]) => {
  if (open && uid) loadDetail(uid as number)
}, { immediate: true })

function fmtTime(_row: any, _col: any, val: number) {
  if (!val) return '永久'
  return new Date(val * 1000).toLocaleDateString('zh-CN')
}

function fmtDateTime(val: number) {
  if (!val) return '—'
  const d = new Date(val * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

function formatMoney(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

async function loadDetail(uid: number) {
  loading.value = true
  activeTab.value = 'voucher'
  try {
    const data = await request.get(`/api/admin/members/${uid}/detail`)
    profile.value = data.profile
    integralSummary.value = data.integralSummary
    integralBatches.value = data.integralBatches || []
    cashVoucherBatches.value = data.cashVoucherBatches || []
    cashVoucherUsage.value = data.cashVoucherUsage || []
    cashVoucherUsedTotal.value = Number(data.cashVoucherUsedTotal || 0)
    membershipRecords.value = data.membershipRecords || []
    approvalHistory.value = data.approvalHistory || []
    merchantRoles.value = data.merchantRoles || []
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

async function confirmGrantDemoAssets() {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm(
      `确认给 UID ${props.uid} 发放演示积分 ${demoForm.value.integralAmount} 和演示现金券 ¥${demoForm.value.cashVoucherAmount}？`,
      '发放演示资产',
      { type: 'warning' }
    )
    await request.post(`/api/admin/members/${props.uid}/demo-assets`, demoForm.value)
    ElMessage.success('演示资产已发放')
    showDemoAssets.value = false
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
    const { value } = await ElMessageBox.prompt('请输入新归属客户经理的 UID', '变更归属', {
      inputPattern: /^\d+$/,
      inputErrorMessage: '请输入有效的数字 UID',
      confirmButtonText: '确认变更'
    })
    await request.put(`/api/admin/members/${props.uid}/spread`, {
      spreadUid: Number(value)
    })
    ElMessage.success('归属客户经理已更新')
    loadDetail(props.uid)
  } catch { /* cancel or error */ }
}

async function clearSpread() {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm('确认清除该会员的归属客户经理？', '清除归属', { type: 'warning' })
    await request.put(`/api/admin/members/${props.uid}/spread`, { spreadUid: 0 })
    ElMessage.success('归属已清除')
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function toggleStoreManager() {
  if (!props.uid || !profile.value) return
  const isManager = profile.value.isManager
  if (isManager) {
    try {
      await ElMessageBox.confirm('确认撤销该用户的客户主管身份？', '撤销客户主管', { type: 'warning' })
      await request.put(`/api/admin/members/${props.uid}/store-manager`, { action: 'revoke' })
      ElMessage.success('客户主管已撤销')
      loadDetail(props.uid)
    } catch { /* cancel */ }
    return
  }
  staffStoreName.value = ''
  showGrantManager.value = true
}

async function confirmGrantManager() {
  if (!props.uid) return
  const storeName = String(managerStoreName.value || '').trim()
  try {
    await request.put(`/api/admin/members/${props.uid}/store-manager`, {
      action: 'grant',
      ...(storeName ? { storeName } : {})
    })
    if (storeName) rememberStoreName(storeName)
    ElMessage.success('客户主管已设置')
    showGrantManager.value = false
    loadDetail(props.uid)
  } catch { /* handled */ }
}

async function toggleStaff() {
  if (!props.uid || !profile.value) return
  const isStaff = profile.value.isStaff
  if (!isStaff) {
    staffStoreName.value = ''
    showGrantStaff.value = true
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(
      '撤销客户经理为危险操作，请输入「确认撤销」以继续',
      '撤销客户经理',
      {
        confirmButtonText: '确认撤销',
        confirmButtonClass: 'el-button--danger',
        inputPattern: /^确认撤销$/,
        inputErrorMessage: '请输入「确认撤销」'
      }
    )
    if (value !== '确认撤销') return
    await request.put(`/api/admin/members/${props.uid}/staff-role`, { action: 'revoke' })
    ElMessage.success('客户经理权限已撤销')
  } catch { /* cancel or error */ }
  loadDetail(props.uid)
}

async function confirmGrantStaff() {
  if (!props.uid) return
  const storeName = String(staffStoreName.value || '').trim()
  if (!storeName) {
    ElMessage.warning('请选择或输入门店名称')
    return
  }
  try {
    await request.put(`/api/admin/members/${props.uid}/staff-role`, {
      action: 'grant',
      storeName
    })
    rememberStoreName(storeName)
    ElMessage.success('客户经理权限已开通')
    showGrantStaff.value = false
    loadDetail(props.uid)
  } catch { /* handled by request interceptor */ }
}

async function recallVoucher() {
  if (!props.uid) return
  const balance = cashVoucherBatches.value.reduce((sum: number, b: any) => sum + Number(b.remainAmount || 0), 0)
  if (balance <= 0) {
    ElMessage.warning('该用户当前无可回收的现金券')
    return
  }
  try {
    const { value } = await ElMessageBox.prompt(
      `该用户现金券余额 ¥${balance}，将全部回收。请输入回收原因：`,
      '回收现金券',
      {
        confirmButtonText: '确认回收',
        confirmButtonClass: 'el-button--danger',
        inputValue: '超管回收现金券',
        inputPlaceholder: '回收原因'
      }
    )
    await request.post(`/api/admin/members/${props.uid}/recall-voucher`, {
      reason: value || '超管回收现金券'
    })
    ElMessage.success('现金券回收成功')
    activeTab.value = 'voucher'
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function reclaimVoucher(row: any) {
  if (!props.uid) return
  try {
    const { value } = await ElMessageBox.prompt(
      `确认回收该批次现金券 ¥${row.remainAmount}？`,
      '回收现金券',
      {
        confirmButtonText: '确认回收',
        confirmButtonClass: 'el-button--danger',
        inputValue: '超管回收现金券',
        inputPlaceholder: '回收原因'
      }
    )
    await request.post(`/api/admin/members/${props.uid}/recall-voucher`, {
      batchId: row.batchId,
      reason: value || '超管回收现金券'
    })
    ElMessage.success('现金券已回收')
    activeTab.value = 'voucher'
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function recallMembership() {
  if (!props.uid || !profile.value) return
  if (!profile.value.tierCode) {
    ElMessage.warning('该用户当前无有效会员')
    return
  }
  const tierLabel = profile.value.tierCode === 'SW299' ? '299会员' : '199会员'
  try {
    await ElMessageBox.confirm(
      `确认回收 UID ${props.uid} 的 ${tierLabel} 权益？\n同时回收关联的赠送积分。`,
      '回收会员权益',
      {
        type: 'warning',
        confirmButtonText: '确认回收',
        confirmButtonClass: 'el-button--danger'
      }
    )
    await request.post(`/api/admin/members/${props.uid}/recall-membership`, {
      reclaimIntegral: true,
      reason: '超管回收会员权益'
    })
    ElMessage.success('会员权益已回收')
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function reclaimMembership(row: any) {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm(
      `确认回收 ${row.tierCode} 会员权益？将同时扣回关联赠送积分。`,
      '回收会员',
      {
        type: 'warning',
        confirmButtonText: '确认回收',
        confirmButtonClass: 'el-button--danger'
      }
    )
    await request.post(`/api/admin/members/${props.uid}/recall-membership`, {
      membershipId: row.id,
      reclaimIntegral: true,
      reason: '超管回收会员权益'
    })
    ElMessage.success('会员已回收')
    activeTab.value = 'membership'
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function confirmRecallIntegral() {
  if (!props.uid) return
  const amount = recallIntegralForm.value.amount
  if (!amount || amount <= 0) {
    ElMessage.warning('请输入有效的回收数量')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认从 UID ${props.uid} 回收 ${amount} 积分？`,
      '回收积分',
      {
        type: 'warning',
        confirmButtonText: '确认回收',
        confirmButtonClass: 'el-button--danger'
      }
    )
    await request.post(`/api/admin/members/${props.uid}/recall-integral`, {
      amount,
      reason: recallIntegralForm.value.reason || '超管回收积分'
    })
    ElMessage.success('积分回收成功')
    showRecallIntegral.value = false
    activeTab.value = 'batches'
    loadDetail(props.uid)
  } catch { /* cancel */ }
}

async function loadMerchantOptions() {
  try {
    const data = await request.get('/api/admin/merchant/options')
    merchantOptions.value = data?.list || []
  } catch {
    merchantOptions.value = []
  }
}

function openMerchantRole() {
  merchantForm.value = { merchantId: undefined, role: 'staff' }
  showMerchantRole.value = true
  loadMerchantOptions()
}

async function confirmMerchantRole() {
  if (!props.uid || !merchantForm.value.merchantId) {
    ElMessage.warning('请选择商家')
    return
  }
  try {
    await request.put(`/api/admin/members/${props.uid}/merchant-role`, {
      action: 'grant',
      merchantId: merchantForm.value.merchantId,
      role: merchantForm.value.role
    })
    ElMessage.success('商家角色已开通')
    showMerchantRole.value = false
    loadDetail(props.uid)
  } catch { /* handled */ }
}

async function revokeMerchantRole(merchantId: number) {
  if (!props.uid) return
  try {
    await ElMessageBox.confirm('确认撤销该用户的商家角色？', '撤销商家角色', { type: 'warning' })
    await request.put(`/api/admin/members/${props.uid}/merchant-role`, {
      action: 'revoke',
      merchantId
    })
    ElMessage.success('商家角色已撤销')
    loadDetail(props.uid)
  } catch { /* cancel */ }
}
</script>

<style scoped>
.mb-16 { margin-bottom: 16px; }
.mt-16 { margin-top: 16px; }
.hint { margin: 0 0 12px; font-size: 12px; color: #909399; line-height: 1.6; }
.sub-head { display: flex; align-items: center; justify-content: space-between; margin: 12px 0 6px; font-size: 13px; font-weight: 600; color: #303133; }
.sub-head:first-child { margin-top: 0; }
.sub-sum { font-size: 12px; font-weight: 500; color: #e34d59; }
.sub-sum.money { color: #0d9488; }
.amt-out { color: #e34d59; font-weight: 600; }
.asset-overview { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 16px; }
.asset-card { background: #f7f8fa; border: 1px solid #ebeef5; border-radius: 8px; padding: 10px 12px; }
.asset-label { font-size: 12px; color: #909399; margin-bottom: 4px; }
.asset-value { font-size: 20px; font-weight: 700; color: #303133; line-height: 1.2; }
.asset-value.money { color: #0d9488; }
.asset-value.out { color: #e34d59; }
.asset-sub { font-size: 11px; color: #c0c4cc; margin-top: 2px; }
.tab-badge { margin-left: 4px; }
.tab-badge :deep(.el-badge__content) { transform: translateY(-2px); }
.current-roles { margin-top: 8px; padding-top: 12px; border-top: 1px solid #eee; }
.current-title { font-size: 12px; color: #909399; margin-bottom: 8px; }
.role-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; font-size: 13px; }
</style>
