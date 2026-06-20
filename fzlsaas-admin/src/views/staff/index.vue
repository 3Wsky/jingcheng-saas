<template>
  <PageShell title="店员管理">
    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="搜索">
          <el-input v-model="keyword" placeholder="UID/手机/昵称" clearable style="width:200px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="keyword = ''; search()">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #toolbar>
      <el-button @click="exportList">导出 CSV</el-button>
    </template>

    <el-table :data="pagedList" v-loading="loading">
      <template #empty>
        <el-empty description="暂无店员" />
      </template>
      <el-table-column prop="uid" label="UID" width="80" />
      <el-table-column prop="nickname" label="姓名" />
      <el-table-column prop="divisionName" label="门店" />
      <el-table-column prop="memberCount" label="发展会员" width="100" />
      <el-table-column prop="pendingApproval" label="待审批" width="90" />
      <el-table-column label="名片" width="90">
        <template #default="{ row }">
          <el-tag :type="row.cardConfigured ? 'success' : 'info'" size="small">
            {{ row.cardConfigured ? '已配置' : '未配置' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="200" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row.uid)">详情</el-button>
          <el-button link type="primary" @click="goApproval(row.uid)">审批记录</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="list.length"
        :page-sizes="[20, 50]"
        layout="total, sizes, prev, pager, next"
        @size-change="onSizeChange"
      />
    </template>
  </PageShell>

  <StaffDetailDrawer v-model="drawerOpen" :uid="selectedUid" />
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import { downloadCsv } from '@/utils/csvExport'
import PageShell from '@/components/PageShell.vue'
import StaffDetailDrawer from './components/StaffDetailDrawer.vue'

const router = useRouter()
const loading = ref(false)
const list = ref<any[]>([])
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const drawerOpen = ref(false)
const selectedUid = ref<number | null>(null)

const pagedList = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return list.value.slice(start, start + pageSize.value)
})

onMounted(() => loadList())

async function loadList() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/staff/list', {
      params: { keyword: keyword.value || undefined, pageSize: 500 }
    })
    list.value = data?.list || []
  } catch { list.value = [] }
  finally { loading.value = false }
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
</script>
