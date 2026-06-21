<template>
  <PageShell title="兑换订单" subtitle="积分商城用户兑换记录，含核销状态与核销码">
    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="核销状态">
          <el-select v-model="filters.status" clearable placeholder="全部" style="width: 120px">
            <el-option label="待核销" value="pending" />
            <el-option label="已核销" value="verified" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户UID">
          <el-input-number v-model="filters.uid" :min="0" controls-position="right" style="width: 140px" />
        </el-form-item>
        <el-form-item label="商品ID">
          <el-input-number v-model="filters.productId" :min="0" controls-position="right" style="width: 140px" />
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
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="reset">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <el-table :data="list" v-loading="loading" size="small">
      <el-table-column prop="orderId" label="订单号" min-width="140" show-overflow-tooltip />
      <el-table-column label="用户" min-width="120">
        <template #default="{ row }">
          <div>{{ row.userNickname || '—' }}</div>
          <UidLink :uid="row.uid" @click="openMember" />
        </template>
      </el-table-column>
      <el-table-column prop="productName" label="商品" min-width="140" show-overflow-tooltip />
      <el-table-column label="积分" width="90" align="right">
        <template #default="{ row }">{{ formatNum(row.integralCost) }}</template>
      </el-table-column>
      <el-table-column label="核销码" width="150">
        <template #default="{ row }">
          <span>{{ row.verifyCode || '—' }}</span>
          <el-button v-if="row.verifyCode" link type="primary" @click="copyCode(row.verifyCode)">复制</el-button>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tag :type="row.status === 3 ? 'success' : 'warning'" size="small">
            {{ row.statusLabel }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="兑换时间" width="165">
        <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </template>
  </PageShell>

  <MemberDetailDrawer v-model="memberDrawerOpen" :uid="memberUid" />
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import UidLink from '@/components/UidLink.vue'
import MemberDetailDrawer from '@/views/members/components/MemberDetailDrawer.vue'
import { useMemberDrawer } from '@/composables/useMemberDrawer'
import { lastNDaysRange } from '@/utils/dateDefaults'

const { memberDrawerOpen, memberUid, openMember } = useMemberDrawer()

const loading = ref(false)
const list = ref<any[]>([])
const page = ref(1)
const pageSize = 20
const total = ref(0)
const dateRange = ref<[string, string] | null>(lastNDaysRange(7))
const filters = ref({ status: '', uid: undefined as number | undefined, productId: undefined as number | undefined })

onMounted(load)

function search() {
  page.value = 1
  load()
}

function reset() {
  filters.value = { status: '', uid: undefined, productId: undefined }
  dateRange.value = null
  dateRange.value = lastNDaysRange(7)
  search()
}

async function copyCode(code: string) {
  try {
    await navigator.clipboard.writeText(code)
    ElMessage.success('核销码已复制')
  } catch {
    ElMessage.info(code)
  }
}

async function load() {
  loading.value = true
  try {
    const params: Record<string, unknown> = {
      page: page.value,
      pageSize,
      status: filters.value.status || 'all'
    }
    if (filters.value.uid) params.uid = filters.value.uid
    if (filters.value.productId) params.productId = filters.value.productId
    if (dateRange.value?.[0]) params.dateFrom = dateRange.value[0]
    if (dateRange.value?.[1]) params.dateTo = dateRange.value[1]

    const data = await request.get('/api/admin/integral-mall/orders', { params })
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function fmtTime(ts?: number) {
  if (!ts) return '—'
  const d = new Date(ts * 1000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function formatNum(v: unknown) {
  const n = Number(v)
  return Number.isFinite(n) ? n.toLocaleString('zh-CN') : '0'
}
</script>

<style scoped>
.sub-text { font-size: 12px; color: #9CA3AF; }
</style>
