<template>
  <div class="image-url-input">
    <div v-if="preview" class="preview">
      <el-image :src="preview" fit="cover" style="width: 64px; height: 64px; border-radius: 4px" />
    </div>
    <el-input
      :model-value="modelValue"
      :placeholder="placeholder"
      clearable
      @update:model-value="emit('update:modelValue', $event)"
    />
    <el-upload
      v-if="allowUpload"
      :show-file-list="false"
      accept="image/*"
      :http-request="handleUpload"
    >
      <el-button :loading="uploading" size="small">上传</el-button>
    </el-upload>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/utils/upload'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  allowUpload?: boolean
}>(), {
  modelValue: '',
  placeholder: '图片 URL',
  allowUpload: true
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()
const uploading = ref(false)

const preview = computed(() => (props.modelValue || '').trim())

async function handleUpload(options: { file: File }) {
  uploading.value = true
  try {
    const url = await uploadImage(options.file)
    emit('update:modelValue', url)
    ElMessage.success('上传成功')
  } catch {
    /* handled */
  } finally {
    uploading.value = false
  }
}
</script>

<style scoped>
.image-url-input { display: flex; align-items: center; gap: 12px; width: 100%; }
.preview { flex-shrink: 0; border: 1px solid #f0f0f0; border-radius: 4px; overflow: hidden; }
</style>
