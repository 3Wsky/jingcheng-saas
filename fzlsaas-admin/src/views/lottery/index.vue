<template>
  <PageShell title="新客抽奖">
    <el-descriptions v-if="overview" :column="2" border>
      <el-descriptions-item label="参与用户">{{ overview.totals?.userCount ?? '--' }}</el-descriptions-item>
      <el-descriptions-item label="总抽奖次数">{{ overview.totals?.totalRecords ?? '--' }}</el-descriptions-item>
      <el-descriptions-item label="中奖次数">{{ overview.totals?.wonRecords ?? '--' }}</el-descriptions-item>
      <el-descriptions-item label="剩余抽奖机会">{{ overview.totals?.totalChances ?? '--' }}</el-descriptions-item>
    </el-descriptions>
    <div v-else class="empty">加载中…</div>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'

const overview = ref<any>(null)

onMounted(async () => {
  try {
    overview.value = await request.get('/api/admin/newcomer-lottery/overview')
  } catch { /* handled */ }
})
</script>

<style scoped>
.empty { text-align: center; padding: 40px; color: #999; }
</style>
