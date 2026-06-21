<template>
  <PageShell title="审计日志">
    <template #filter>
      <el-form :inline="true" @submit.prevent="load">
        <el-form-item label="操作类型">
          <el-select v-model="filters.action" clearable placeholder="全部" style="width:180px">
            <el-option label="积分发放" value="integral_grant" />
            <el-option label="会员开通" value="membership_grant" />
            <el-option label="现金券发放" value="cash_voucher_grant" />
            <el-option label="审批终审" value="approval_review" />
            <el-option label="归属变更" value="member_spread_update" />
            <el-option label="店员名片" value="staff_card_update" />
          </el-select>
        </el-form-item>
        <el-form-item label="日期">
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始"
            end-placeholder="结束"
            style="width: 240px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="load">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="pagedList" v-loading="loading" size="small" class="admin-table">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="adminUsername" label="操作人" width="100" />
      <el-table-column prop="action" label="动作" width="160" />
      <el-table-column prop="targetType" label="目标" width="80" />
      <el-table-column prop="targetId" label="目标ID" width="100" />
      <el-table-column prop="resultStatus" label="结果" width="80" />
      <el-table-column prop="createdAt" label="时间" :formatter="fmtTime" width="160" />
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="filteredList.length"
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
import { lastNDaysRange, dateRangeToUnix } from '@/utils/dateDefaults'

const loading = ref(false)
const list = ref<any[]>([])
const filters = ref({ action: '' })
const dateRange = ref<[string, string] | null>(lastNDaysRange(7))
const page = ref(1)
const pageSize = ref(20)

const filteredList = computed(() => {
  const { startAt, endAt } = dateRangeToUnix(dateRange.value)
  return list.value.filter((row) => {
    const ts = Number(row.createdAt || 0)
    if (startAt && ts < startAt) return false
    if (endAt && ts > endAt) return false
    return true
  })
})

const pagedList = computed(() => {
  const start = (page.value - 1) * pageSize.value
  return filteredList.value.slice(start, start + pageSize.value)
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

function reset() {
  filters.value = { action: '' }
  dateRange.value = lastNDaysRange(7)
  load()
}

function syncPage() {}
function onSizeChange() { page.value = 1 }

function fmtTime(_r: any, _c: any, val: number) {
  return val ? new Date(val * 1000).toLocaleString('zh-CN') : '—'
}
</script>
