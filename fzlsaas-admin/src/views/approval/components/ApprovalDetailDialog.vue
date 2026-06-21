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
            UID {{ detail.customerUid }} · {{ detail.customerNickname || '—' }}
            <el-button link type="primary" @click="goMember(detail.customerUid)">查看会员详情 →</el-button>
          </p>
        </section>

        <section class="detail-section">
          <h4>消费信息</h4>
          <p>消费金额 ¥{{ formatNum(detail.consumptionAmount) }} · 小票号 {{ detail.receiptNo || '—' }}</p>
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

        <section v-if="showActions" class="detail-section">
          <h4>终审操作</h4>
          <el-input v-model="comment" placeholder="审批意见（选填）" />
        </section>

        <section v-else-if="detail.canRevoke" class="detail-section">
          <h4>撤销终批</h4>
          <p class="text-muted">终批通过后 24 小时内可撤销，将回滚已发放的权益。</p>
          <el-button type="danger" plain @click="emitRevoke">撤销终批</el-button>
        </section>
      </template>
    </div>

    <template v-if="showActions" #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="danger" plain @click="emitReject">驳回</el-button>
      <el-button type="primary" @click="emitApprove">通过并发放权益</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import ApprovalStatusTag from './ApprovalStatusTag.vue'

const props = defineProps<{ requestId: number | null; showActions?: boolean }>()
const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{ approve: [detail: any, comment: string]; reject: [detail: any]; revoke: [detail: any] }>()

const router = useRouter()
const loading = ref(false)
const detail = ref<any>(null)
const comment = ref('')

const roleLabel: Record<string, string> = {
  clerk: '店员',
  staff: '店员',
  manager: '店长',
  store: '店长',
  admin: '超管',
}

watch(() => [props.requestId, visible.value], async ([id, open]) => {
  if (!open || !id) return
  comment.value = ''
  loading.value = true
  try {
    detail.value = await request.get(`/api/admin/approval/${id}`)
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
})

const timelineItems = computed(() => {
  if (!detail.value) return []
  const items: { text: string; type?: string; hollow?: boolean }[] = []
  for (const step of detail.value.steps || []) {
    const role = roleLabel[step.stepRole] || step.stepRole || '操作人'
    const time = fmtTime(step.createdAt)
    const action = step.action === 'approve' ? '通过' : step.action === 'reject' ? '驳回' : step.action === 'revoke' ? '撤销' : step.action || '处理'
    const suffix = step.comment ? ` 「${step.comment}」` : ''
    items.push({ text: `${time}  ${role} ${action}${suffix}`, type: step.action === 'reject' ? 'danger' : 'primary' })
  }
  if (detail.value.status === 'pending_admin') {
    items.push({ text: '待超管终审', type: 'warning', hollow: true })
  } else if (detail.value.status === 'pending_store') {
    items.push({ text: '待店长初审', type: 'warning', hollow: true })
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
