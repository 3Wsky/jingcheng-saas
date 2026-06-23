<template>
  <PageShell title="商家管理">
    <template #tabs>
      <el-tabs v-model="activeTab">
        <el-tab-pane label="商家列表" name="list" />
        <el-tab-pane label="核销员排行" name="leaderboard" />
        <el-tab-pane label="开通商家" name="create" />
      </el-tabs>
    </template>

    <template v-if="activeTab === 'create'" #toolbar>
      <el-button type="primary" @click="handleCreate" :loading="creating">创建商家</el-button>
    </template>

    <!-- ============ 商家列表 ============ -->
    <template v-if="activeTab === 'list'">
      <el-row :gutter="12" class="overview-row" v-loading="overviewLoading">
        <el-col :xs="12" :sm="8" :md="6" v-for="card in overviewCards" :key="card.key">
          <StatCard :type="card.type" :icon="card.icon" :title="card.title" :value="card.value" />
        </el-col>
      </el-row>

      <div class="list-toolbar">
        <div class="toolbar-left">
          <el-input
            v-model="searchKeyword"
            placeholder="搜索名称/联系人/电话"
            clearable
            style="width: 220px"
            @keyup.enter="reloadList(1)"
            @clear="reloadList(1)"
          />
          <el-select v-model="filterCategory" placeholder="全部类目" clearable style="width: 130px" @change="reloadList(1)">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
          <el-select v-model="sortBy" style="width: 150px" @change="reloadList(1)">
            <el-option label="默认排序" value="id" />
            <el-option label="今日核销额" value="todayAmount" />
            <el-option label="本月核销额" value="monthAmount" />
            <el-option label="活跃核销员" value="staffActive" />
            <el-option label="绑定核销员" value="staffBound" />
            <el-option label="待结算金额" value="pending" />
            <el-option label="最近核销" value="lastVerify" />
          </el-select>
          <el-button :icon="sortOrder === 'desc' ? 'SortDown' : 'SortUp'" @click="toggleSortOrder">
            {{ sortOrder === 'desc' ? '降序' : '升序' }}
          </el-button>
          <el-button type="primary" @click="reloadList(1)">查询</el-button>
        </div>
        <div class="toolbar-right">
          <el-button @click="activeTab = 'create'">开通商家</el-button>
        </div>
      </div>

      <TableSkeleton v-if="loading && !list.length" :cols="8" />
      <el-table v-else :data="list" v-loading="loading && list.length > 0">
        <template #empty>
          <el-empty description="暂无商家">
            <el-button type="primary" @click="activeTab = 'create'">开通商家</el-button>
          </el-empty>
        </template>
        <el-table-column prop="id" label="ID" width="64" />
        <el-table-column prop="merchantName" label="名称" min-width="140" show-overflow-tooltip />
        <el-table-column prop="category" label="类目" width="90">
          <template #default="{ row }">{{ row.category || '—' }}</template>
        </el-table-column>
        <el-table-column label="核销员" width="110" align="center">
          <template #default="{ row }">
            <el-tooltip content="绑定核销员 / 本月活跃核销员" placement="top">
              <span class="staff-badge">
                <strong>{{ row.staffBound ?? 0 }}</strong>
                <span class="staff-sep">/</span>
                <span class="staff-active-num">{{ row.staffActive ?? 0 }}</span>
              </span>
            </el-tooltip>
          </template>
        </el-table-column>
        <el-table-column label="今日核销" width="130" align="right">
          <template #default="{ row }">
            <span v-if="row.todayCount" class="amount-cell">
              ¥{{ fmtAmount(row.todayAmount) }}
              <span class="count-sub">{{ row.todayCount }}笔</span>
            </span>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <el-table-column label="本月核销额" width="120" align="right">
          <template #default="{ row }">
            <span :class="row.monthAmount ? 'amount-cell' : 'muted'">
              {{ row.monthAmount ? '¥' + fmtAmount(row.monthAmount) : '—' }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="待结算" width="100" align="right">
          <template #default="{ row }">
            <el-link type="primary" :underline="false" @click="goSettlement(row)">
              ¥{{ fmtAmount(row.pendingSettlement) }}
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="最近核销" width="160">
          <template #default="{ row }">{{ fmtTs(row.lastVerifyAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)">详情</el-button>
            <el-button link type="danger" @click="deactivate(row)">停用</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-if="listTotal > 0"
        v-model:current-page="listPage"
        :page-size="listPageSize"
        :total="listTotal"
        layout="total, prev, pager, next"
        class="list-pagination"
        @current-change="reloadList"
      />
    </template>

    <!-- ============ 核销员排行 ============ -->
    <template v-if="activeTab === 'leaderboard'">
      <div class="list-toolbar">
        <div class="toolbar-left">
          <el-radio-group v-model="lbPeriod" @change="loadLeaderboard">
            <el-radio-button value="day">今日</el-radio-button>
            <el-radio-button value="week">本周</el-radio-button>
            <el-radio-button value="month">本月</el-radio-button>
          </el-radio-group>
          <el-select
            v-model="lbMerchantId"
            placeholder="全部商家"
            clearable
            filterable
            style="width: 200px"
            @change="loadLeaderboard"
          >
            <el-option v-for="m in merchantOptions" :key="m.id" :label="m.merchantName" :value="m.id" />
          </el-select>
        </div>
        <div class="toolbar-right">
          <span class="lb-summary" v-if="leaderboard.length">
            合计 <strong>{{ lbTotalCount }}</strong> 笔 ·
            <strong class="amount-cell">¥{{ fmtAmount(lbTotalAmount) }}</strong>
          </span>
        </div>
      </div>
      <el-table :data="leaderboard" v-loading="lbLoading">
        <template #empty>
          <el-empty description="该周期暂无核销数据" />
        </template>
        <el-table-column label="排名" width="70" align="center">
          <template #default="{ row }">
            <span class="rank-badge" :class="'rank-' + (row.rank <= 3 ? row.rank : 'n')">{{ row.rank }}</span>
          </template>
        </el-table-column>
        <el-table-column label="核销员" min-width="140">
          <template #default="{ row }">
            <span class="staff-name">{{ row.operatorName }}</span>
            <span class="staff-uid">（{{ row.operatorUid }}）</span>
          </template>
        </el-table-column>
        <el-table-column prop="merchantName" label="所属商家" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.merchantName || '—' }}</template>
        </el-table-column>
        <el-table-column label="核销笔数" width="100" align="right">
          <template #default="{ row }">{{ row.verifyCount }}</template>
        </el-table-column>
        <el-table-column label="核销总额" width="130" align="right">
          <template #default="{ row }"><span class="amount-cell">¥{{ fmtAmount(row.totalAmount) }}</span></template>
        </el-table-column>
        <el-table-column label="最近核销" width="160">
          <template #default="{ row }">{{ fmtTs(row.lastVerifyAt) }}</template>
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
      <el-form-item label="营业时间">
        <div class="time-range-picker">
          <el-time-select v-model="createTimeStart" start="00:00" end="23:30" step="00:30" placeholder="开始" style="width: 130px" @change="syncCreateBusinessHours" />
          <span class="time-sep">至</span>
          <el-time-select v-model="createTimeEnd" :start="createTimeStart || '00:00'" end="23:30" step="00:30" placeholder="结束" style="width: 130px" @change="syncCreateBusinessHours" />
        </div>
      </el-form-item>
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
          <el-form-item label="营业时间">
            <div class="time-range-picker">
              <el-time-select v-model="editTimeStart" start="00:00" end="23:30" step="00:30" placeholder="开始" style="width: 130px" @change="syncEditBusinessHours" />
              <span class="time-sep">至</span>
              <el-time-select v-model="editTimeEnd" :start="editTimeStart || '00:00'" end="23:30" step="00:30" placeholder="结束" style="width: 130px" @change="syncEditBusinessHours" />
            </div>
          </el-form-item>

          <el-divider content-position="left">权限与结算</el-divider>
          <el-form-item label="核销权限"><el-switch v-model="editForm.canVerify" /></el-form-item>
          <el-form-item label="结算备注"><el-input v-model="editForm.settlementNote" type="textarea" :rows="2" /></el-form-item>
          <el-form-item label="待结算">¥{{ editForm.pendingSettlement ?? 0 }}</el-form-item>

          <el-button type="primary" @click="saveMerchant">保存</el-button>
        </el-form>
      </el-tab-pane>
      <el-tab-pane label="核销员统计" name="staff-stats">
        <div class="stats-toolbar">
          <el-radio-group v-model="statsPeriod" size="small" @change="loadStaffStats">
            <el-radio-button value="day">按日</el-radio-button>
            <el-radio-button value="week">按周</el-radio-button>
            <el-radio-button value="month">按月</el-radio-button>
          </el-radio-group>
          <el-date-picker
            v-model="statsDateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px; margin-left: 12px"
            @change="loadStaffStats"
          />
        </div>
        <el-table :data="staffStats" size="small" v-loading="statsLoading" show-summary :summary-method="statsSummary">
          <template #empty>
            <el-empty description="暂无核销数据" />
          </template>
          <el-table-column prop="operatorName" label="核销员" min-width="100">
            <template #default="{ row }">
              <span class="staff-name">{{ row.operatorName }}</span>
              <span class="staff-uid">（{{ row.operatorUid }}）</span>
            </template>
          </el-table-column>
          <el-table-column prop="totalCount" label="核销笔数" width="100" align="right" />
          <el-table-column prop="totalAmount" label="核销总额" width="120" align="right">
            <template #default="{ row }">¥{{ row.totalAmount.toFixed(2) }}</template>
          </el-table-column>
          <el-table-column label="各期明细" min-width="200">
            <template #default="{ row }">
              <div class="period-chips">
                <el-tag
                  v-for="d in row.details"
                  :key="d.period"
                  size="small"
                  type="info"
                  class="period-chip"
                >
                  {{ d.period }}：{{ d.count }}笔 ¥{{ d.amount.toFixed(2) }}
                </el-tag>
              </div>
            </template>
          </el-table-column>
        </el-table>
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
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import StatCard from '@/components/StatCard.vue'
import ImageListInput from '@/components/ImageListInput.vue'
import UidLink from '@/components/UidLink.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'

const router = useRouter()
const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()
const activeTab = ref('list')
const loading = ref(false)
const list = ref<any[]>([])
const listPage = ref(1)
const listPageSize = 20
const listTotal = ref(0)
const searchKeyword = ref('')
const filterCategory = ref('')
const sortBy = ref('id')
const sortOrder = ref<'asc' | 'desc'>('desc')
const categories = ref<string[]>([])

const overviewLoading = ref(false)
const overview = ref<Record<string, number>>({})
const overviewCards = computed(() => [
  { key: 'merchant', type: 'member', icon: 'Shop', title: '商家总数', value: overview.value.merchantCount ?? 0 },
  { key: 'staff', type: 'approval', icon: 'Avatar', title: '核销员总数', value: overview.value.staffCount ?? 0 },
  { key: 'todayCount', type: 'verify', icon: 'Checked', title: '今日核销笔数', value: overview.value.todayCount ?? 0 },
  { key: 'todayAmount', type: 'grant', icon: 'Money', title: '今日核销金额', value: '¥' + fmtAmount(overview.value.todayAmount) },
  { key: 'monthAmount', type: 'newuser', icon: 'TrendCharts', title: '本月核销金额', value: '¥' + fmtAmount(overview.value.monthAmount) },
  { key: 'pending', type: 'consume', icon: 'Wallet', title: '待结算总额', value: '¥' + fmtAmount(overview.value.pendingTotal) },
])

const lbPeriod = ref<'day' | 'week' | 'month'>('day')
const lbMerchantId = ref<number | undefined>(undefined)
const leaderboard = ref<any[]>([])
const lbLoading = ref(false)
const lbTotalCount = ref(0)
const lbTotalAmount = ref(0)
const merchantOptions = ref<{ id: number; merchantName: string }[]>([])
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
const staffStats = ref<any[]>([])
const statsLoading = ref(false)
const statsPeriod = ref<'day' | 'week' | 'month'>('day')
const statsDateRange = ref<[string, string] | null>(null)

const createTimeStart = ref('')
const createTimeEnd = ref('')
const editTimeStart = ref('')
const editTimeEnd = ref('')

function parseBusinessHours(val: string) {
  const m = String(val || '').match(/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/)
  return m ? [m[1], m[2]] : ['', '']
}

function syncCreateBusinessHours() {
  createForm.value.businessHours = (createTimeStart.value && createTimeEnd.value)
    ? `${createTimeStart.value}-${createTimeEnd.value}` : ''
}

function syncEditBusinessHours() {
  editForm.value.businessHours = (editTimeStart.value && editTimeEnd.value)
    ? `${editTimeStart.value}-${editTimeEnd.value}` : ''
}

onMounted(() => {
  loadList()
  loadOverview()
})

async function loadOverview() {
  overviewLoading.value = true
  try {
    const data = await request.get('/api/admin/merchant/overview')
    overview.value = data || {}
    categories.value = data?.categories || []
  } catch {
    overview.value = {}
  } finally {
    overviewLoading.value = false
  }
}

async function loadList() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: listPage.value,
      pageSize: listPageSize,
      sortBy: sortBy.value,
      sortOrder: sortOrder.value
    }
    if (searchKeyword.value.trim()) params.keyword = searchKeyword.value.trim()
    if (filterCategory.value) params.category = filterCategory.value
    const data = await request.get('/api/admin/merchant/list', { params })
    list.value = data?.list || []
    listTotal.value = data?.total || 0
  } catch { list.value = []; listTotal.value = 0 }
  finally { loading.value = false }
}

function reloadList(page = 1) {
  listPage.value = page
  loadList()
}

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  reloadList(1)
}

async function loadMerchantOptions() {
  if (merchantOptions.value.length) return
  try {
    const data = await request.get('/api/admin/merchant/list', { params: { page: 1, pageSize: 100, sortBy: 'monthAmount' } })
    merchantOptions.value = (data?.list || []).map((m: any) => ({ id: m.id, merchantName: m.merchantName }))
  } catch {
    merchantOptions.value = []
  }
}

async function loadLeaderboard() {
  lbLoading.value = true
  try {
    const params: Record<string, unknown> = { period: lbPeriod.value, limit: 100 }
    if (lbMerchantId.value) params.merchantId = lbMerchantId.value
    const data = await request.get('/api/admin/merchant/staff-leaderboard', { params })
    leaderboard.value = data?.list || []
    lbTotalCount.value = data?.totalCount || 0
    lbTotalAmount.value = data?.totalAmount || 0
  } catch {
    leaderboard.value = []
    lbTotalCount.value = 0
    lbTotalAmount.value = 0
  } finally {
    lbLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'leaderboard') {
    loadMerchantOptions()
    if (!leaderboard.value.length) loadLeaderboard()
  }
})

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
    createTimeStart.value = ''
    createTimeEnd.value = ''
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
  const [es, ee] = parseBusinessHours(editForm.value.businessHours)
  editTimeStart.value = es
  editTimeEnd.value = ee
  canVerifyOriginal.value = Boolean(editForm.value.canVerify)
  logPage.value = 1
  logDateRange.value = null
  statsDateRange.value = null
  statsPeriod.value = 'day'
  await Promise.all([loadVerifyLogs(1), loadStaffStats()])
}

async function loadStaffStats() {
  if (!editForm.value?.id) return
  statsLoading.value = true
  try {
    const params: Record<string, unknown> = { period: statsPeriod.value }
    if (statsDateRange.value?.[0]) params.dateFrom = statsDateRange.value[0]
    if (statsDateRange.value?.[1]) params.dateTo = statsDateRange.value[1]
    const data = await request.get(`/api/admin/merchant/${editForm.value.id}/staff-verify-stats`, { params })
    staffStats.value = data?.staff || []
  } catch {
    staffStats.value = []
  } finally {
    statsLoading.value = false
  }
}

function statsSummary({ columns, data }: { columns: any[]; data: any[] }) {
  return columns.map((_: any, idx: number) => {
    if (idx === 0) return '合计'
    if (idx === 1) return data.reduce((sum, r) => sum + (r.totalCount || 0), 0)
    if (idx === 2) return '¥' + data.reduce((sum, r) => sum + (r.totalAmount || 0), 0).toFixed(2)
    return ''
  })
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
  if (tab === 'staff-stats' && editForm.value?.id) loadStaffStats()
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

function fmtAmount(val?: number) {
  const n = Number(val || 0)
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
</script>

<style scoped>
.create-tip { margin-bottom: 16px; }
.coord-sep { margin: 0 8px; color: #9CA3AF; }
.field-hint { margin: 4px 0 0; font-size: 12px; color: #9CA3AF; line-height: 1.4; }
.stats-toolbar { display: flex; align-items: center; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
.staff-name { font-weight: 600; }
.staff-uid { color: #909399; font-size: 12px; }
.period-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.period-chip { font-size: 11px; }
.log-filter { margin-bottom: 12px; }
.log-pagination { margin-top: 12px; justify-content: flex-end; }
.time-range-picker { display: flex; align-items: center; gap: 4px; }
.time-sep { color: #606266; font-size: 13px; padding: 0 4px; }

.overview-row { margin-bottom: 8px; }
.list-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.list-toolbar .toolbar-left,
.list-toolbar .toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.list-pagination { margin-top: 12px; justify-content: flex-end; }

.staff-badge { font-size: 13px; }
.staff-badge strong { color: var(--gov-primary, #0052D9); }
.staff-sep { margin: 0 3px; color: #c0c4cc; }
.staff-active-num { color: var(--gov-success, #00a870); font-weight: 600; }

.amount-cell { color: var(--gov-warning, #ed7b2f); font-weight: 600; font-variant-numeric: tabular-nums; }
.count-sub { color: #909399; font-size: 11px; font-weight: 400; margin-left: 4px; }
.muted { color: #c0c4cc; }

.lb-summary { font-size: 13px; color: var(--gov-text-secondary); }
.rank-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 12px;
  font-weight: 700;
  background: #f0f2f5;
  color: #909399;
}
.rank-badge.rank-1 { background: #fff3e0; color: #f59e0b; }
.rank-badge.rank-2 { background: #f0f4f8; color: #94a3b8; }
.rank-badge.rank-3 { background: #fdf0e6; color: #cd7f32; }
</style>
