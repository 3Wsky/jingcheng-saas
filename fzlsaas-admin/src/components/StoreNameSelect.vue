<template>
  <el-select
    :model-value="modelValue"
    filterable
    allow-create
    default-first-option
    clearable
    :placeholder="placeholder"
    :loading="loading"
    style="width: 100%"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <el-option-group v-if="recentOptions.length" label="最近使用">
      <el-option
        v-for="item in recentOptions"
        :key="`recent-${item.name}`"
        :label="item.name"
        :value="item.name"
      />
    </el-option-group>
    <el-option-group v-if="storeOptions.length" label="已有门店">
      <el-option
        v-for="item in storeOptions"
        :key="item.id || item.name"
        :label="item.staffCount ? `${item.name}（${item.staffCount} 人）` : item.name"
        :value="item.name"
      />
    </el-option-group>
  </el-select>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import request from '@/utils/request'
import { mergeStoreOptions, readRecentStoreNames } from '@/utils/recentStores'

defineProps<{
  modelValue?: string
  placeholder?: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | undefined] }>()

const loading = ref(false)
const apiOptions = ref<Array<{ id: number; name: string; staffCount?: number }>>([])
const recentNames = ref<string[]>(readRecentStoreNames())

const mergedOptions = computed(() => mergeStoreOptions(apiOptions.value, recentNames.value))
const recentOptions = computed(() => mergedOptions.value.filter((item) => item.recent))
const storeOptions = computed(() => mergedOptions.value.filter((item) => !item.recent))

onMounted(async () => {
  loading.value = true
  try {
    const data = await request.get('/api/admin/stores/options')
    apiOptions.value = data?.list || []
  } catch {
    apiOptions.value = []
  } finally {
    loading.value = false
  }
})

function refreshRecent() {
  recentNames.value = readRecentStoreNames()
}

defineExpose({ refreshRecent })
</script>
