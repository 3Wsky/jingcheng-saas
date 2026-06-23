<template>
  <PageShell title="商家管理">
    <template #tabs>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="商家列表" name="list" />
        <el-tab-pane label="开通商家" name="create" />
      </el-tabs>
    </template>

    <template v-if="activeTab === 'create'" #toolbar>
      <el-button type="primary" @click="handleCreate" :loading="creating">创建商家</el-button>
    </template>

    <template v-if="activeTab === 'list'">
      <TableSkeleton v-if="loading && !list.length" :cols="6" />
      <el-table v-else :data="list" v-loading="loading && list.length > 0">
        <template #empty>
          <el-empty description="暂无商家">
            <el-button type="primary" @click="activeTab = 'create'">开通商家</el-button>
          </el-empty>
        </template>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="merchantName" label="名称" />
        <el-table-column prop="category" label="类目" width="100" />
        <el-table-column prop="contactPhone" label="电话" width="120" />
        <el-table-column label="待结算" width="100">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="goSettlement(row)">
              ¥{{ row.pendingSettlement }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="最近核销" width="160">
          <template #default="{ row }">{{ fmtTs(row.lastVerifyAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" @click="deactivate(row)">停用</el-button>
          </template>
        </el-table-column>
      </el-table>
    </template>

    <el-form v-else :model="createForm" label-width="120px" style="max-width:600px">
      <el-alert type="info" :closable="false" show-icon class="create-tip">
        商家资料用于小程序「现金券 → 可核销商家」展示。人员权限请在<strong>会员管理 → 商家角色</strong>开通（用户需先登录小程序）。
      </el-alert>

      <el-divider content-position="left">基础信息</el-divider>
      <el-form-item label="商家名称"><el-input v-model="createForm.merchantName" /></el-form-item>
      <el-form-item label="类目"><el-input v-model="createForm.category" placeholder="如：数码、餐饮" /></el-form-item>
      <el-form-item label="联系人"><el-input v-model="createForm.contactName" /></el-form-item>
      <el-form-item label="联系电话"><el-input v-model="createForm.contactPhone" /></el-form-item>
      <el-form-item label="绑定UID">
        <el-input-number v-model="createForm.loginUid" :min="0" />
        <p class="field-hint">可选。也可稍后在会员详情开通「商家店长」自动绑定。</p>
      </el-form-item>
      <el-form-item label="核销权限"><el-switch v-model="createForm.canVerify" /></el-form-item>

      <el-divider content-position="left">门店资料</el-divider>
      <el-form-item label="门头照">
        <ImageListInput v-model="createStoreImages" :max="6" />
        <p class="field-hint">上传门店门头照片，最多 6 张</p>
      </el-form-item>
      <el-form-item label="省"><el-input v-model="createForm.province" placeholder="如：新疆维吾尔自治区" /></el-form-item>
      <el-form-item label="市"><el-input v-model="createForm.city" placeholder="如：乌鲁木齐市" /></el-form-item>
      <el-form-item label="区"><el-input v-model="createForm.district" placeholder="如：天山区" /></el-form-item>
      <el-form-item label="详细地址"><el-input v-model="createForm.storeAddress" type="textarea" :rows="2" placeholder="街道门牌号等详细地址" /></el-form-item>
      <el-form-item label="经纬度">
        <el-input-number v-model="createForm.latitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" placeholder="纬度" />
        <span class="coord-sep">,</span>
        <el-input-number v-model="createForm.longitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" placeholder="经度" />
        <p class="field-hint">可选。用于小程序门店定位导航</p>
      </el-form-item>
      <el-form-item label="营业时间"><el-input v-model="createForm.businessHours" placeholder="如：09:00-21:00" /></el-form-item>
    </el-form>
  </PageShell>

  <el-drawer v-model="editOpen" title="商家详情" size="640px">
    <el-tabs v-model="editTab">
      <el-tab-pane label="门店资料" name="base">
        <el-form :model="editForm" label-width="100px">
          <el-divider content-position="left">基础信息</el-divider>
          <el-form-item label="名称"><el-input v-model="editForm.merchantName" /></el-form-item>
          <el-form-item label="类目"><el-input v-model="editForm.category" /></el-form-item>
          <el-form-item label="联系人"><el-input v-model="editForm.contactName" /></el-form-item>
          <el-form-item label="电话"><el-input v-model="editForm.contactPhone" /></el-form-item>
          <el-form-item label="绑定UID"><el-input-number v-model="editForm.loginUid" :min="1" disabled /></el-form-item>

          <el-divider content-position="left">门店资料</el-divider>
          <el-form-item label="省"><el-input v-model="editForm.province" placeholder="如：广东省" /></el-form-item>
          <el-form-item label="市"><el-input v-model="editForm.city" placeholder="如：深圳市" /></el-form-item>
          <el-form-item label="区"><el-input v-model="editForm.district" placeholder="如：南山区" /></el-form-item>
          <el-form-item label="详细地址"><el-input v-model="editForm.storeAddress" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="经纬度">
            <el-input-number v-model="editForm.latitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
            <span class="coord-sep">,</span>
            <el-input-number v-model="editForm.longitude" :precision="6" :step="0.0001" controls-position="right" style="width: 140px" />
          </el-form-item>
          <el-form-item label="门头图">
            <ImageListInput v-model="storeImages" :max="6" />
          </el-form-item>
          <el-form-item label="营业时间"><el-input v-model="editForm.businessHours" placeholder="09:00-21:00" /></el-form-item>

          <el-divider content-position="left">权限与结算</el-divider>
          <el-form-item label="核销权限"><el-switch v-model="editForm.canVerify" /></el-form-item>
          <el-form-item label="结算备注"><el-input v-model="editForm.settlementNote" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="待结算">¥{{ editForm.pendingSettlement ?? 0 }}</el-form-item>

          <el-button type="primary" @click="saveMerchant">保存</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="核销明细" name="logs">
        <el-form :inline="true" class="log-filter" @submit.prevent="loadVerifyLogs(1)">
          <el-form-item label="日期">
            <el-date-picker
              v-model="logDateRange"
              type="daterange"
              value-format="YYYY-MM-DD"
              start-placeholder="开始"
              end-placeholder="结束"
              style="width: 240px"
            />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="loadVerifyLogs(1)">查询</el-button>
            <el-button @click="resetLogFilter">重置</el-button>
          </el-form-item>
        </el-form>
        <el-table :data="verifyLogs" size="small" v-loading="logsLoading">
          <template #empty>
            <el-empty description="暂无核销记录" />
          </template>
          <el-table-column prop="createdAt" label="时间" width="160">
            <template #default="{ row }">{{ fmtTs(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="customerUid" label="客户 UID" width="100">
            <template #default="{ row }">
              <UidLink :uid="row.customerUid" @click="openMember" />
            </template>
          </el-table-column>
          <el-table-column prop="amount" label="核销金额" width="100">
            <template #default="{ row }">¥{{ row.amount }}</template>
          </el-table-column>
          <el-table-column prop="operatorUid" label="操作人" width="90">
            <template #default="{ row }">{{ row.operatorUid || '—' }}</template>
          </el-table-column>
          <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
          <el-table-column label="结算" width="90">
            <template #default>待结算</template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-if="logTotal > 0"
          v-model:current-page="logPage"
          :page-size="logPageSize"
          :total="logTotal"
          layout="total, prev, pager, next"
          class="log-pagination"
          @current-change="loadVerifyLogs"
        />
      </el-tab-pane>
    </el-tabs>
  </el-drawer>

  <MemberDetailDrawer v-model="memberDrawerOpen" :uid="memberUid" />
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import ImageListInput from '@/components/ImageListInput.vue'
import UidLink from '@/components/UidLink.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'

const router = useRouter()
const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()
const activeTab = ref('list')
const loading = ref(false)
const list = ref<any[]>([])
const creating = ref(false)
const createForm = ref({
  merchantName: '', category: '', contactName: '', contactPhone: '', loginUid: 0, canVerify: true,
  storeAddress: '', province: '', city: '', district: '', latitude: 0, longitude: 0, businessHours: ''
})
const createStoreImages = ref<string[]>([''])
const editOpen = ref(false)
const editTab = ref('base')
const editForm = ref<any>({})
const storeImages = ref<string[]>([''])
const verifyLogs = ref<any[]>([])
const logsLoading = ref(false)
const logPage = ref(1)
const logPageSize = 20
const logTotal = ref(0)
const logDateRange = ref<[string, string] | null>(null)
const canVerifyOriginal = ref(true)

onMounted(() => loadList())

async function loadList() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/merchant/list')
    list.value = data?.list || []
  } catch { list.value = [] }
  finally { loading.value = false }
}

async function handleCreate() {
  creating.value = true
  try {
    const payload = {
      ...createForm.value,
      storeImages: createStoreImages.value.filter(Boolean)
    }
    await request.post('/api/admin/merchant/create', payload)
    ElMessage.success('创建成功')
    createForm.value = {
      merchantName: '', category: '', contactName: '', contactPhone: '', loginUid: 0, canVerify: true,
      storeAddress: '', province: '', city: '', district: '', latitude: 0, longitude: 0, businessHours: ''
    }
    createStoreImages.value = ['']
    activeTab.value = 'list'
    loadList()
  } catch { /* handled */ }
  finally { creating.value = false }
}

async function openEdit(row: any) {
  editOpen.value = true
  editTab.value = 'base'
  try {
    editForm.value = await request.get(`/api/admin/merchant/${row.id}`)
  } catch {
    editForm.value = { ...row }
  }
  storeImages.value = editForm.value.storeImages?.length ? [...editForm.value.storeImages] : ['']
  canVerifyOriginal.value = Boolean(editForm.value.canVerify)
  logPage.value = 1
  logDateRange.value = null
  await loadVerifyLogs(1)
}

async function loadVerifyLogs(page = logPage.value) {
  if (!editForm.value?.id) return
  logPage.value = page
  logsLoading.value = true
  try {
    const params: Record<string, unknown> = { page, pageSize: logPageSize }
    if (logDateRange.value?.[0]) params.dateFrom = logDateRange.value[0]
    if (logDateRange.value?.[1]) params.dateTo = logDateRange.value[1]
    const data = await request.get(`/api/admin/merchant/${editForm.value.id}/verify-logs`, { params })
    verifyLogs.value = data?.list || []
    logTotal.value = data?.total || 0
  } catch {
    verifyLogs.value = []
    logTotal.value = 0
  } finally {
    logsLoading.value = false
  }
}

function resetLogFilter() {
  logDateRange.value = null
  loadVerifyLogs(1)
}

watch(editTab, (tab) => {
  if (tab === 'logs' && editForm.value?.id) loadVerifyLogs(1)
})

async function saveMerchant() {
  if (canVerifyOriginal.value && editForm.value.canVerify === false) {
    try {
      const { value } = await ElMessageBox.prompt(
        '关闭核销权限为危险操作，请输入「确认撤销」以继续',
        '确认关闭核销',
        {
          confirmButtonText: '确认',
          cancelButtonText: '取消',
          inputPattern: /^确认撤销$/,
          inputErrorMessage: '请输入「确认撤销」'
        }
      )
      if (value !== '确认撤销') return
    } catch {
      editForm.value.canVerify = true
      return
    }
  }
  try {
    const payload = {
      ...editForm.value,
      storeImages: storeImages.value.filter(Boolean)
    }
    await request.put(`/api/admin/merchant/${editForm.value.id}`, payload)
    ElMessage.success('已保存')
    editOpen.value = false
    loadList()
  } catch { /* handled */ }
}

function goSettlement(row: any) {
  router.push({
    path: '/finance-settlement',
    query: { merchantId: String(row.id), merchantName: row.merchantName || '' }
  })
}

async function deactivate(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(
      `停用商家「${row.merchantName}」后不可核销，请输入「确认撤销」以继续`,
      '停用商家',
      {
        confirmButtonText: '确认停用',
        cancelButtonText: '取消',
        inputPattern: /^确认撤销$/,
        inputErrorMessage: '请输入「确认撤销」'
      }
    )
    if (value !== '确认撤销') return
    await request.patch(`/api/admin/merchant/${row.id}/deactivate`)
    ElMessage.success('商家已停用')
    loadList()
  } catch {
    /* cancel or error */
  }
}

function fmtTs(val?: number) {
  return val ? new Date(val * 1000).toLocaleString('zh-CN') : '—'
}
</script>

<style scoped>
.create-tip { margin-bottom: 16px; }
.coord-sep { margin: 0 8px; color: #9CA3AF; }
.field-hint { margin: 4px 0 0; font-size: 12px; color: #9CA3AF; line-height: 1.4; }
.log-filter { margin-bottom: 12px; }
.log-pagination { margin-top: 12px; justify-content: flex-end; }
</style>
