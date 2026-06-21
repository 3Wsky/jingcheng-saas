<template>
  <el-drawer v-model="visible" :title="`店员详情 · UID ${profile?.uid || ''}`" size="640px" destroy-on-close>
    <div v-loading="loading">
      <template v-if="profile">
        <div class="profile-header">
          <el-avatar :size="56" :src="profile.avatar || undefined">{{ (profile.nickname || '?')[0] }}</el-avatar>
          <div class="profile-meta">
            <div class="profile-name">{{ profile.nickname || '—' }}</div>
            <div class="profile-sub">{{ profile.phone || '—' }} · {{ profile.divisionName || '—' }}</div>
          </div>
          <el-button size="small" @click="openStoreDialog">修改门店</el-button>
        </div>

        <el-row :gutter="12" class="stat-row">
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">发展会员</div>
              <div class="stat-value">{{ stats?.memberCount ?? 0 }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">待审批</div>
              <div class="stat-value">{{ stats?.approvalStats?.pending ?? 0 }}</div>
            </div>
          </el-col>
          <el-col :span="8">
            <div class="stat-card">
              <div class="stat-label">已通过</div>
              <div class="stat-value">{{ stats?.approvalStats?.approved ?? 0 }}</div>
            </div>
          </el-col>
        </el-row>

        <el-tabs v-model="activeTab" class="mt-16">
          <el-tab-pane label="发展会员" name="members">
            <el-table :data="stats?.members || []" size="small" max-height="320">
              <el-table-column prop="uid" label="UID" width="80" />
              <el-table-column prop="nickname" label="昵称" />
              <el-table-column prop="phone" label="手机" width="120" />
              <el-table-column label="注册时间" width="140">
                <template #default="{ row }">{{ fmtTime(row.registerAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="openMember(row.uid)">查看会员</el-button>
                </template>
              </el-table-column>
            </el-table>
            <div class="tab-actions">
              <el-button size="small" @click="exportMembers">导出 CSV</el-button>
            </div>
          </el-tab-pane>

          <el-tab-pane label="审批记录" name="approvals">
            <el-table :data="stats?.approvals || []" size="small" max-height="320">
              <el-table-column prop="requestId" label="ID" width="70" />
              <el-table-column prop="customerUid" label="客户" width="80" />
              <el-table-column prop="consumptionAmount" label="金额" width="90">
                <template #default="{ row }">¥{{ row.consumptionAmount }}</template>
              </el-table-column>
              <el-table-column prop="status" label="状态" width="110" />
              <el-table-column label="时间" width="140">
                <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
              </el-table-column>
              <el-table-column label="操作" width="100" fixed="right">
                <template #default="{ row }">
                  <el-button link type="primary" @click="goApproval(row.requestId)">查看详情</el-button>
                </template>
              </el-table-column>
            </el-table>
          </el-tab-pane>

          <el-tab-pane label="名片配置" name="card">
            <div v-if="cardPreview" class="card-preview">
              <el-avatar :size="48" :src="cardPreview.avatar || undefined">{{ (cardPreview.displayName || '?')[0] }}</el-avatar>
              <div>
                <div class="card-preview-name">{{ cardPreview.displayName || '—' }}</div>
                <div class="card-preview-sub">{{ cardPreview.jobTitle || '—' }} · {{ cardPreview.storeName || '—' }}</div>
              </div>
              <el-tag :type="cardForm.isPublished ? 'success' : 'info'" size="small">
                {{ cardForm.isPublished ? '已发布' : '未发布' }}
              </el-tag>
            </div>
            <el-form :model="cardForm" label-width="90px">
              <el-form-item label="头像">
                <ImageUrlInput v-model="cardForm.avatar" placeholder="头像 URL 或上传" />
              </el-form-item>
              <el-form-item label="展示名"><el-input v-model="cardForm.displayName" /></el-form-item>
              <el-form-item label="职位"><el-input v-model="cardForm.jobTitle" /></el-form-item>
              <el-form-item label="简介"><el-input v-model="cardForm.bio" type="textarea" maxlength="120" show-word-limit /></el-form-item>
              <el-form-item label="门店名"><el-input v-model="cardForm.storeName" /></el-form-item>
              <el-form-item label="地址"><el-input v-model="cardForm.storeAddress" /></el-form-item>
              <el-form-item label="电话"><el-input v-model="cardForm.storePhone" /></el-form-item>
              <el-form-item label="营业时间"><el-input v-model="cardForm.businessHours" /></el-form-item>
              <el-form-item label="经纬度">
                <el-input-number v-model="cardForm.latitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
                <span class="coord-sep">,</span>
                <el-input-number v-model="cardForm.longitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
              </el-form-item>
              <el-form-item label="微信二维码">
                <ImageUrlInput v-model="cardForm.wechatQrcode" placeholder="二维码 URL 或上传" />
              </el-form-item>
              <el-form-item label="发布"><el-switch v-model="cardForm.isPublished" /></el-form-item>
              <el-button type="primary" @click="saveCard">保存名片</el-button>
            </el-form>
          </el-tab-pane>
        </el-tabs>
      </template>
    </div>
  </el-drawer>

  <MemberDetailDrawer v-model="memberOpen" :uid="memberUid" />

  <el-dialog v-model="storeDialogOpen" title="修改所属门店" width="420px" append-to-body>
    <StoreNameSelect v-model="storeFormName" placeholder="选择或输入门店名称" />
    <template #footer>
      <el-button @click="storeDialogOpen = false">取消</el-button>
      <el-button type="primary" :loading="storeSaving" @click="saveStore">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import { downloadCsv } from '@/utils/csvExport'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import ImageUrlInput from '@/components/ImageUrlInput.vue'
import StoreNameSelect from '@/components/StoreNameSelect.vue'
import { rememberStoreName } from '@/utils/recentStores'

const props = defineProps<{ uid: number | null; initialTab?: string }>()
const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{ updated: [] }>()

const router = useRouter()
const loading = ref(false)
const activeTab = ref('members')
const profile = ref<any>(null)
const stats = ref<any>(null)
const cardForm = ref<any>({
  displayName: '', avatar: '', jobTitle: '', bio: '', storeName: '', storeAddress: '',
  storePhone: '', businessHours: '', latitude: 0, longitude: 0, wechatQrcode: '', isPublished: true
})
const cardPreview = computed(() => ({
  displayName: cardForm.value.displayName || profile.value?.nickname || '',
  avatar: cardForm.value.avatar || profile.value?.avatar || '',
  jobTitle: cardForm.value.jobTitle || '',
  storeName: cardForm.value.storeName || profile.value?.divisionName || ''
}))
const memberOpen = ref(false)
const memberUid = ref<number | null>(null)
const storeDialogOpen = ref(false)
const storeFormName = ref('')
const storeSaving = ref(false)

watch(() => [props.uid, visible.value, props.initialTab], async ([uid, open]) => {
  if (!open || !uid) return
  activeTab.value = props.initialTab || 'members'
  loading.value = true
  try {
    const row = await request.get('/api/admin/staff/list', { params: { keyword: String(uid), pageSize: 1 } })
    profile.value = row?.list?.[0] || { uid, nickname: '', phone: '', divisionName: '' }
    stats.value = await request.get(`/api/admin/staff/${uid}/stats`)
    const card = await request.get(`/api/admin/staff/${uid}/card`).catch(() => ({}))
    cardForm.value = {
      displayName: card.displayName || '',
      avatar: card.avatar || profile.value?.avatar || '',
      jobTitle: card.jobTitle || '',
      bio: card.bio || '',
      storeName: card.storeName || '',
      storeAddress: card.storeAddress || '',
      storePhone: card.storePhone || '',
      businessHours: card.businessHours || '',
      latitude: Number(card.latitude || 0),
      longitude: Number(card.longitude || 0),
      wechatQrcode: card.wechatQrcode || '',
      isPublished: card.isPublished !== false
    }
  } catch {
    profile.value = null
    stats.value = null
  } finally {
    loading.value = false
  }
})

function fmtTime(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function openMember(uid: number) {
  memberUid.value = uid
  memberOpen.value = true
}

function goApproval(requestId: number) {
  visible.value = false
  router.push({ path: '/approval', query: { tab: 'all', requestId: String(requestId) } })
}

function exportMembers() {
  const rows = (stats.value?.members || []).map((m: any) => [
    m.uid, m.nickname, m.phone, fmtTime(m.registerAt)
  ])
  if (!rows.length) {
    ElMessage.info('暂无发展会员可导出')
    return
  }
  downloadCsv(`staff-${props.uid}-members.csv`, ['UID', '昵称', '手机', '注册时间'], rows)
  ElMessage.success('已导出 CSV')
}

async function saveCard() {
  if (!props.uid) return
  try {
    await request.put(`/api/admin/staff/${props.uid}/card`, cardForm.value)
    ElMessage.success('名片已保存')
  } catch { /* handled */ }
}

function openStoreDialog() {
  storeFormName.value = profile.value?.divisionName || ''
  storeDialogOpen.value = true
}

async function saveStore() {
  if (!props.uid) return
  const storeName = String(storeFormName.value || '').trim()
  if (!storeName) {
    ElMessage.warning('请选择或输入门店名称')
    return
  }
  storeSaving.value = true
  try {
    const data = await request.put(`/api/admin/staff/${props.uid}/store`, { storeName })
    rememberStoreName(storeName)
    if (profile.value) {
      profile.value.divisionName = data.storeName
      profile.value.divisionId = data.divisionId
    }
    ElMessage.success('门店已更新')
    storeDialogOpen.value = false
    emit('updated')
  } finally {
    storeSaving.value = false
  }
}
</script>

<style scoped>
.profile-header { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.profile-meta { flex: 1; min-width: 0; }
.profile-name { font-size: 16px; font-weight: 600; }
.profile-sub { font-size: 13px; color: #9CA3AF; margin-top: 4px; }
.stat-row { margin-bottom: 8px; }
.stat-card { background: #FAFAFA; border-radius: 8px; padding: 12px; text-align: center; }
.stat-label { font-size: 12px; color: #9CA3AF; }
.stat-value { font-size: 22px; font-weight: 700; margin-top: 4px; }
.mt-16 { margin-top: 16px; }
.tab-actions { margin-top: 12px; }
.coord-sep { margin: 0 8px; color: #9CA3AF; }
.card-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  margin-bottom: 16px;
  background: #FAFAFA;
  border-radius: 8px;
}
.card-preview-name { font-size: 15px; font-weight: 600; }
.card-preview-sub { font-size: 12px; color: #9CA3AF; margin-top: 4px; }
</style>
