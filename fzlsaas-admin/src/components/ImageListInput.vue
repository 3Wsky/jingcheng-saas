<template>
  <div class="image-list-input">
    <div v-for="(url, idx) in list" :key="idx" class="row">
      <el-image v-if="url" :src="url" fit="cover" class="thumb" />
      <div v-else class="thumb empty">无</div>
      <el-input v-model="list[idx]" placeholder="图片 URL" />
      <el-upload v-if="allowUpload" :show-file-list="false" accept="image/*" :http-request="makeUploadHandler(idx)">
        <el-button link type="primary" :loading="uploadingIdx === idx">上传</el-button>
      </el-upload>
      <el-button link type="danger" @click="remove(idx)">删除</el-button>
    </div>
    <el-button v-if="list.length < max" link type="primary" @click="add">+ 添加图片</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { uploadImage } from '@/utils/upload'

const props = withDefaults(defineProps<{ modelValue?: string[]; max?: number; allowUpload?: boolean }>(), {
  modelValue: () => [''],
  max: 9,
  allowUpload: true
})
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()
const uploadingIdx = ref<number | null>(null)

const list = computed({
  get: () => props.modelValue?.length ? props.modelValue : [''],
  set: (v) => emit('update:modelValue', v.filter((x, i) => x || i < v.length - 1 || v.length === 1))
})

function add() {
  emit('update:modelValue', [...list.value, ''])
}

function remove(idx: number) {
  const next = list.value.filter((_, i) => i !== idx)
  emit('update:modelValue', next.length ? next : [''])
}

function makeUploadHandler(idx: number) {
  return (options: { file: File | Blob }) => handleUpload(idx, options)
}

async function handleUpload(idx: number, options: { file: File | Blob }) {
  const file = options.file instanceof File ? options.file : new File([options.file], 'image.jpg')
  uploadingIdx.value = idx
  try {
    const url = await uploadImage(file)
    const next = [...list.value]
    next[idx] = url
    emit('update:modelValue', next)
    ElMessage.success('上传成功')
  } catch {
    /* handled */
  } finally {
    uploadingIdx.value = null
  }
}
</script>

<style scoped>
.image-list-input { width: 100%; }
.row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.thumb { width: 48px; height: 48px; border-radius: 4px; flex-shrink: 0; border: 1px solid #f0f0f0; }
.thumb.empty { display: flex; align-items: center; justify-content: center; font-size: 12px; color: #ccc; background: #fafafa; }
</style>
