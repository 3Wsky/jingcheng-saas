<template>
  <el-tag :type="tagType" :class="{ 'tag-auto': status === 'auto_approved' }" size="small">
    {{ label }}
  </el-tag>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ status: string }>()

const labelMap: Record<string, string> = {
  pending_store: '待店长',
  pending_admin: '待超管',
  approved: '已通过',
  rejected: '已驳回',
  auto_approved: '自动通过',
  revoked: '已撤销',
}

const label = computed(() => labelMap[props.status] || props.status)

const tagType = computed(() => {
  const map: Record<string, '' | 'success' | 'warning' | 'info' | 'danger'> = {
    pending_store: 'warning',
    pending_admin: 'danger',
    approved: 'success',
    rejected: 'info',
    auto_approved: '',
    revoked: 'info',
  }
  return map[props.status] ?? 'info'
})
</script>

<style scoped>
.tag-auto {
  --el-tag-bg-color: #EFF6FF;
  --el-tag-border-color: #BFDBFE;
  --el-tag-text-color: #3B82F6;
}
</style>
