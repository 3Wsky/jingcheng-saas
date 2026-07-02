<template>
  <el-dialog
    v-model="visible"
    :title="`审批详情 #${detail?.requestId || ''}`"
    width="720px"
    destroy-on-close
    class="approval-detail-dialog"
  >
    <div v-loading="loading">
      <template v-if="detail">
        <div class="detail-header">
          <ApprovalStatusTag :status="detail.status" />
          <span class="detail-time">提交于 {{ fmtTime(detail.createdAt) }}</span>
        </div>

        <section class="detail-section">
          <h4>客户信息</h4>
          <p>
            {{ detail.customerNickname || '（未设昵称）' }} · UID {{ detail.customerUid }}
            <el-button link type="primary" @click="goMember(detail.customerUid)">查看会员详情 →</el-button>
          </p>
        </section>

        <section class="detail-section">
          <h4>提交人（客户经理）</h4>
          <p>{{ detail.staffNickname || '（未设昵称）' }} · UID {{ detail.staffUid }}</p>
        </section>

        <section class="detail-section">
          <h4>消费信息</h4>
          <p>消费金额 ¥{{ formatNum(detail.consumptionAmount) }} · 小票号 {{ detail.receiptNo || '—' }}</p>
          <p v-if="detail.codeVerify" class="code-verify">
            <template v-if="!detail.codeVerify.hasCode">
              <el-tag size="small" type="info" effect="plain">无 IMEI/SN 码</el-tag>
            </template>
            <template v-else-if="detail.codeVerify.matched">
              <el-tag size="small" type="success">
                IMEI/SN 已核对（按 {{ detail.codeVerify.matchedBy === 'imei1' ? 'IMEI1' : 'SN' }} 命中产品库）
              </el-tag>
              <span v-if="detail.codeVerify.hit" class="code-hit">
                匹配：{{ detail.codeVerify.hit.model || '—' }}
                <template v-if="detail.codeVerify.hit.price"> · ¥{{ formatNum(detail.codeVerify.hit.price) }}</template>
              </span>
              <el-tag v-if="detail.codeVerify.category === '无人机'" size="small" type="warning" effect="dark">大疆</el-tag>
            </template>
            <template v-else>
              <el-tag size="small" type="danger">IMEI/SN 未在产品库匹配到</el-tag>
            </template>
            <el-tag v-if="detail.codeVerify.reused" size="small" type="danger" effect="dark">
              ⚠️ 此码已被使用过，疑似重复申请
            </el-tag>
            <el-button
              v-if="detail.codeVerify.hasCode"
              size="small"
              icon="Refresh"
              :loading="rechecking"
              class="recheck-btn"
              @click="recheckCode"
            >复核</el-button>
          </p>
          <p v-if="detail.codeVerify && detail.codeVerify.hasCode" class="recheck-hint">
            更新产品库后点「复核」可按最新产品库重新比对 IMEI/SN
          </p>
          <div v-if="detail.receiptImages?.length" class="receipt-images">
            <el-image
              v-for="(img, i) in detail.receiptImages"
              :key="i"
              :src="img"
              :preview-src-list="detail.receiptImages"
              :initial-index="i"
              fit="cover"
              class="receipt-thumb"
            />
          </div>
          <p v-else class="text-muted">暂无小票图片</p>
        </section>

        <section class="detail-section">
          <h4>权益演算</h4>
          <el-row :gutter="12">
            <el-col :span="8">
              <div class="benefit-box">
                <div class="benefit-label">匹配档位</div>
                <div class="benefit-value">{{ formatTier(detail.matchedTierCode) }}</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="benefit-box">
                <div class="benefit-label">赠送现金券</div>
                <div class="benefit-value">¥{{ formatNum(detail.matchedVoucherAmount) }}</div>
              </div>
            </el-col>
            <el-col :span="8">
              <div class="benefit-box">
                <div class="benefit-label">赠送积分</div>
                <div class="benefit-value">{{ formatNum(detail.matchedIntegral) }}</div>
              </div>
            </el-col>
          </el-row>
        </section>

        <section class="detail-section">
          <h4>审批链路</h4>
          <el-timeline v-if="timelineItems.length">
            <el-timeline-item
              v-for="(item, idx) in timelineItems"
              :key="idx"
              :type="item.type"
              :hollow="item.hollow"
            >
              {{ item.text }}
            </el-timeline-item>
          </el-timeline>
          <p v-else class="text-muted">暂无审批记录</p>
        </section>

        <section v-if="canAct" class="detail-section">
          <h4>终审操作</h4>
          <el-input v-model="comment" placeholder="审批意见（选填）" />
        </section>

        <section v-else-if="detail.canRevoke && isSuperAdmin" class="detail-section">
          <h4>撤销终批</h4>
          <p class="text-muted">终批通过后 24 小时内可撤销，将回滚已发放的权益。</p>
          <el-button type="danger" plain @click="emitRevoke">撤销终批</el-button>
        </section>
      </template>
    </div>

    <template v-if="canAct" #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="danger" plain @click="emitReject">驳回</el-button>
      <el-button type="primary" @click="emitApprove">通过并发放权益</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import ApprovalStatusTag from './ApprovalStatusTag.vue'
import { useUserStore } from '@/store/user'

const userStore = useUserStore()
const isSuperAdmin = computed(() => userStore.isSuperAdmin)

const props = defineProps<{ requestId: number | null; showActions?: boolean }>()
const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{ approve: [detail: any, comment: string]; reject: [detail: any]; revoke: [detail: any] }>()

const router = useRouter()
const loading = ref(false)
const rechecking = ref(false)
const detail = ref<any>(null)
const comment = ref('')

// 拉取详情（后端每次都会重新比对 IMEI/SN 与最新产品库）
async function loadDetail(id: number) {
  loading.value = true
  try {
    detail.value = await request.get(`/api/admin/approval/${id}`)
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
}

// 复核：重新拉产品库比对 IMEI/SN（更新产品库后用），刷新展示并给出明确结果提示
async function recheckCode() {
  const id = props.requestId
  if (!id || rechecking.value) return
  rechecking.value = true
  try {
    const fresh = await request.get(`/api/admin/approval/${id}`)
    detail.value = fresh
    const cv = fresh?.codeVerify
    if (!cv || !cv.hasCode) {
      ElMessage.info('该单收据无 IMEI/SN 码，无需复核')
    } else if (cv.matched) {
      const by = cv.matchedBy === 'imei1' ? 'IMEI1' : 'SN'
      ElMessage.success(`复核完成：IMEI/SN 现已命中产品库（按 ${by}）`)
    } else {
      ElMessage.warning('复核完成：IMEI/SN 仍未在产品库匹配到，请确认已把该 IMEI/SN 录入产品库')
    }
  } catch (e: any) {
    ElMessage.error(e?.message || '复核失败，请稍后再试')
  } finally {
    rechecking.value = false
  }
}

// 是否展示终审操作：显式传入 showActions 优先；否则按详情状态判定（待超管 pending_admin 可终审）
const canAct = computed(() => props.showActions ?? detail.value?.status === 'pending_admin')

const roleLabel: Record<string, string> = {
  clerk: '客户经理',
  staff: '客户经理',
  manager: '客户主管',
  store: '客户主管',
  admin: '超管',
}

watch(() => [props.requestId, visible.value], async ([id, open]) => {
  if (!open || !id) return
  comment.value = ''
  await loadDetail(Number(id))
})

const timelineItems = computed(() => {
  if (!detail.value) return []
  const items: { text: string; type?: string; hollow?: boolean }[] = []
  for (const step of detail.value.steps || []) {
    const role = roleLabel[step.stepRole] || step.stepRole || '操作人'
    const time = fmtTime(step.createdAt)
    const action = step.action === 'submit' ? '提交' : step.action === 'approve' ? '通过' : step.action === 'reject' ? '驳回' : step.action === 'revoke' ? '撤销' : step.action || '处理'
    const who = step.operatorNickname ? `${step.operatorNickname}（UID ${step.operatorUid}）` : `UID ${step.operatorUid || '—'}`
    const suffix = step.comment ? ` 「${step.comment}」` : ''
    items.push({ text: `${time}  ${role} ${who} ${action}${suffix}`, type: step.action === 'reject' ? 'danger' : 'primary' })
  }
  if (detail.value.status === 'pending_admin') {
    items.push({ text: '待超管终审', type: 'warning', hollow: true })
  } else if (detail.value.status === 'pending_store') {
    items.push({ text: '待客户主管初审', type: 'warning', hollow: true })
  }
  return items
})

function fmtTime(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatNum(v: any) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0'
}

function formatTier(code?: string) {
  if (code === 'SW199') return '锦程199会员'
  if (code === 'SW299') return '锦程299会员'
  return code || '—'
}

function goMember(uid: number) {
  visible.value = false
  router.push(`/members?uid=${uid}`)
}

function emitApprove() {
  if (detail.value) emit('approve', detail.value, comment.value)
}

function emitReject() {
  if (detail.value) emit('reject', detail.value)
}

function emitRevoke() {
  if (detail.value) emit('revoke', detail.value)
}
</script>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.detail-time { font-size: 13px; color: #9CA3AF; }
.detail-section { margin-bottom: 20px; }
.detail-section h4 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #1A1A2E;
}
.code-verify { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.code-hit { font-size: 13px; color: #4B5563; }
.recheck-btn { margin-left: 4px; }
.recheck-hint { font-size: 12px; color: #9CA3AF; margin: 4px 0 0; }
.receipt-images { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.receipt-thumb {
  width: 120px;
  height: 120px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid #E5E7EB;
}
.benefit-box {
  background: #FAFAFA;
  border-radius: 8px;
  padding: 12px;
  text-align: center;
}
.benefit-label { font-size: 12px; color: #9CA3AF; }
.benefit-value { font-size: 18px; font-weight: 700; color: #1A1A2E; margin-top: 4px; }
.text-muted { color: #9CA3AF; font-size: 13px; }
</style>
