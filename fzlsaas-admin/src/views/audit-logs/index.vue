<template>
  <PageShell title="审计日志">
    <template #filter>
      <el-form :inline="true" @submit.prevent="load">
        <el-form-item label="操作">
          <el-input v-model="filters.action" placeholder="如 integral_grant" clearable style="width:160px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="filters.action = ''; load()">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="pagedList" v-loading="loading" size="small">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="adminUsername" label="操作人" width="100" />
      <el-table-column prop="action" label="动作" width="140" />
      <el-table-column prop="targetType" label="目标" width="80" />
      <el-table-column prop="targetId" label="目标ID" width="100" />
      <el-table-column prop="resultStatus" label="结果" width="80" />
      <el-table-column prop="createdAt" label="时间" :formatter="fmtTime" width="160" />
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="list.length"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next"
        @current-change="syncPage"
        @size-change="onSizeChange"
      />
    </template>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'

const loading = ref(false)
const list = ref<any[]>([])
const filters = ref({ action: '' })
const page = ref(1)
const pageSize = ref(20)

const pagedList = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return list.value.slice(start, start + pageSize.value)
})

onMounted(() => load())

async function load() {
  loading.value = true
  page.value = 1
  try {
    const data = await request.get('/api/admin/audit-logs', { params: { action: filters.value.action || undefined } })
    list.value = data?.list || []
  } catch { list.value = [] }
  finally { loading.value = false }
}

function syncPage() {}
function onSizeChange() { page.value = 1 }

function fmtTime(_r: any, _c: any, val: number) {
  return val ? new Date(val * 1000).toLocaleString('zh-CN') : '—'
}
</script>
