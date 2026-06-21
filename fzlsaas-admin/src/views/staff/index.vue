<template>
  <PageShell title="店员管理">
    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="搜索">
          <el-input v-model="keyword" placeholder="UID/手机/昵称" clearable style="width:200px" />
        </el-form-item>
        <el-form-item label="门店">
          <StoreNameSelect v-model="storeName" placeholder="按门店名称筛选" style="width: 220px" />
        </el-form-item>
        <el-form-item label="店长">
          <el-select v-model="managerFilter" clearable placeholder="全部" style="width:100px">
            <el-option label="是" value="yes" />
            <el-option label="否" value="no" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #toolbar>
      <el-button type="primary" @click="openBatchGrant">从归属关系批量开通</el-button>
      <el-button @click="exportList">导出 CSV</el-button>
    </template>

    <TableSkeleton v-if="loading && !pagedList.length" :cols="7" />
    <el-table v-else :data="pagedList" v-loading="loading && pagedList.length > 0">
      <template #empty>
        <el-empty description="暂无店员">
          <el-button type="primary" @click="$router.push('/members')">前往会员管理开通店员</el-button>
        </el-empty>
      </template>
      <el-table-column prop="uid" label="UID" width="80" />
      <el-table-column prop="nickname" label="姓名" />
      <el-table-column prop="divisionName" label="门店" />
      <el-table-column prop="memberCount" label="发展会员" width="100" />
      <el-table-column prop="pendingApproval" label="待审批" width="90" />
      <el-table-column prop="approvedCount" label="已通过" width="90" />
      <el-table-column label="店长" width="72" align="center">
        <template #default="{ row }">
          <el-tag v-if="row.isManager" type="warning" size="small">店长</el-tag>
          <span v-else class="text-muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="名片" width="90">
        <template #default="{ row }">
          <el-tag :type="row.cardConfigured ? 'success' : 'info'" size="small">
            {{ row.cardConfigured ? '已配置' : '未配置' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.uid)">详情</el-button>
          <el-button link type="primary" @click="openCard(row.uid)">名片</el-button>
          <el-button link type="primary" @click="goApproval(row.uid)">审批记录</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filteredList.length"
        :page-sizes="[20, 50]"
        layout="total, sizes, prev, pager, next"
        @size-change="onSizeChange"
      />
    </template>
  </PageShell>

  <StaffDetailDrawer v-model="drawerOpen" :uid="selectedUid" :initial-tab="drawerTab" @updated="loadList" />

  <el-dialog v-model="batchDialogOpen" title="从归属关系批量开通店员" width="560px">
    <p class="batch-tip">将把「至少 1 名会员归属其 UID」且尚未开通店员的用户，批量加入店员管理。</p>
    <el-form label-width="88px">
      <el-form-item label="默认门店">
        <StoreNameSelect v-model="batchStoreName" placeholder="默认：米古里" />
      </el-form-item>
    </el-form>
    <el-alert v-if="batchPreview" type="info" :closable="false" show-icon class="batch-alert">
      <template #title>
        待开通 {{ batchPreview.pendingCount }} 人 · 已是店员 {{ batchPreview.existingCount }} 人 · 归属店员共 {{ batchPreview.totalCandidates }} 人
      </template>
    </el-alert>
    <el-table v-if="batchPreview?.pending?.length" :data="batchPreview.pending.slice(0, 8)" size="small" max-height="220" class="batch-table">
      <el-table-column prop="uid" label="UID" width="80" />
      <el-table-column prop="nickname" label="昵称" />
      <el-table-column prop="memberCount" label="名下会员" width="90" />
    </el-table>
    <template #footer>
      <el-button @click="batchDialogOpen = false">取消</el-button>
      <el-button type="primary" :loading="batchSubmitting" :disabled="!batchPreview?.pendingCount" @click="confirmBatchGrant">
        确认开通 {{ batchPreview?.pendingCount || 0 }} 人
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import { downloadCsv } from '@/utils/csvExport'
import PageShell from '@/components/PageShell.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import StoreNameSelect from '@/components/StoreNameSelect.vue'
import { rememberStoreName } from '@/utils/recentStores'
import StaffDetailDrawer from './components/StaffDetailDrawer.vue'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const keyword = ref('')
const storeName = ref('')
const managerFilter = ref<'yes' | 'no' | ''>('')
const page = ref(1)
const pageSize = ref(20)
const drawerOpen = ref(false)
const selectedUid = ref<number | null>(null)
const drawerTab = ref('members')
const batchDialogOpen = ref(false)
const batchStoreName = ref('米古里')
const batchPreview = ref<any>(null)
const batchSubmitting = ref(false)

const filteredList = computed(() => {
  let rows = list.value
  if (managerFilter.value === 'yes') rows = rows.filter(r => r.isManager)
  else if (managerFilter.value === 'no') rows = rows.filter(r => !r.isManager)
  return rows
})

const pagedList = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
})

onMounted(() => loadList())

async function loadList() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/staff/list', {
      params: {
        keyword: keyword.value || undefined,
        storeName: storeName.value || undefined,
        page: 1,
        pageSize: 100,
      },
    })
    list.value = data?.list || []
  } catch { list.value = [] }
  finally { loading.value = false }
}

function resetFilters() {
  keyword.value = ''
  storeName.value = ''
  managerFilter.value = ''
  search()
}

function search() {
  page.value = 1
  loadList()
}

function onSizeChange() {
  page.value = 1
}

function openDetail(uid: number) {
  selectedUid.value = uid
  drawerTab.value = 'members'
  drawerOpen.value = true
}

function openCard(uid: number) {
  selectedUid.value = uid
  drawerTab.value = 'card'
  drawerOpen.value = true
}

function goApproval(uid: number) {
  router.push({ path: '/approval', query: { tab: 'all', staffUid: String(uid) } })
}

function exportList() {
  if (!list.value.length) {
    ElMessage.info('暂无数据可导出')
    return
  }
  downloadCsv(
    'staff-list.csv',
    ['UID', '姓名', '门店', '发展会员', '待审批', '已通过', '名片配置'],
    list.value.map((r) => [
      r.uid, r.nickname, r.divisionName, r.memberCount, r.pendingApproval, r.approvedCount,
      r.cardConfigured ? '已配置' : '未配置'
    ])
  )
  ElMessage.success('已导出 CSV')
}

async function openBatchGrant() {
  batchStoreName.value = '米古里'
  batchDialogOpen.value = true
  batchPreview.value = null
  try {
    batchPreview.value = await request.get('/api/admin/staff/batch-grant/preview')
  } catch {
    batchPreview.value = null
  }
}

async function confirmBatchGrant() {
  const store = String(batchStoreName.value || '米古里').trim() || '米古里'
  try {
    await ElMessageBox.confirm(
      `确认为 ${batchPreview.value?.pendingCount || 0} 人开通店员，并设置门店为「${store}」？`,
      '批量开通确认',
      { type: 'warning' }
    )
  } catch {
    return
  }
  batchSubmitting.value = true
  try {
    const data = await request.post('/api/admin/staff/batch-grant-from-spread', { storeName: store })
    rememberStoreName(store)
    ElMessage.success(`已开通 ${data.granted} 人${data.failed ? `，失败 ${data.failed} 人` : ''}`)
    batchDialogOpen.value = false
    loadList()
  } finally {
    batchSubmitting.value = false
  }
}
</script>

<style scoped>
.batch-tip { margin: 0 0 12px; color: #606266; font-size: 13px; line-height: 1.6; }
.batch-alert { margin: 12px 0; }
.batch-table { margin-top: 8px; }
</style>
