<template>
  <div class="image-url-input">
    <div
      class="drop-zone"
      :class="{ 'has-image': preview, 'is-dragover': dragover, 'is-uploading': uploading }"
      tabindex="0"
      @click="triggerPick"
      @paste="onPaste"
      @dragover.prevent="dragover = true"
      @dragenter.prevent="dragover = true"
      @dragleave.prevent="dragover = false"
      @drop.prevent="onDrop"
    >
      <template v-if="preview">
        <el-image :src="preview" fit="cover" class="zone-img" />
        <div class="zone-mask">
          <el-icon><Upload /></el-icon>
          <span>点击/拖拽/粘贴替换</span>
        </div>
        <el-icon class="zone-remove" @click.stop="clearImage"><Close /></el-icon>
      </template>
      <template v-else>
        <el-icon class="zone-icon"><Plus /></el-icon>
        <span class="zone-text">点击上传</span>
        <span class="zone-sub">支持拖拽 / 粘贴截图</span>
      </template>
      <div v-if="uploading" class="zone-loading">
        <el-icon class="is-loading"><Loading /></el-icon>
      </div>
    </div>

    <input ref="fileInput" type="file" accept="image/*" class="hidden-input" @change="onFileChange" />

    <el-input
      :model-value="modelValue"
      :placeholder="placeholder"
      size="small"
      clearable
      class="url-field"
      @update:model-value="emit('update:modelValue', $event)"
    >
      <template #prepend>URL</template>
    </el-input>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { Plus, Upload, Close, Loading } from '@element-plus/icons-vue'
import { uploadImage } from '@/utils/upload'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  allowUpload?: boolean
}>(), {
  modelValue: '',
  placeholder: '可粘贴图片 URL',
  allowUpload: true
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()
const uploading = ref(false)
const dragover = ref(false)
const fileInput = ref<HTMLInputElement>()

const preview = computed(() => (props.modelValue || '').trim())

function triggerPick() {
  if (!props.allowUpload || uploading.value) return
  fileInput.value?.click()
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (file) doUpload(file)
  target.value = ''
}

function onDrop(e: DragEvent) {
  dragover.value = false
  if (!props.allowUpload) return
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) doUpload(file)
  else if (file) ElMessage.warning('请拖入图片文件')
}

function onPaste(e: ClipboardEvent) {
  if (!props.allowUpload) return
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) {
        e.preventDefault()
        doUpload(file)
        return
      }
    }
  }
}

async function doUpload(file: File) {
  if (file.size > 10 * 1024 * 1024) {
    ElMessage.warning('图片不能超过 10MB')
    return
  }
  uploading.value = true
  try {
    const url = await uploadImage(file)
    emit('update:modelValue', url)
    ElMessage.success('上传成功')
  } catch {
    /* handled by interceptor */
  } finally {
    uploading.value = false
  }
}

function clearImage() {
  emit('update:modelValue', '')
}
</script>

<style scoped>
.image-url-input { display: flex; align-items: flex-start; gap: 12px; }
.drop-zone {
  position: relative;
  width: 96px;
  height: 96px;
  border: 1px dashed #d9d9d9;
  border-radius: 6px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  background: #fafafa;
  transition: border-color 0.2s, background 0.2s;
  flex-shrink: 0;
  outline: none;
  overflow: hidden;
}
.drop-zone:hover,
.drop-zone:focus { border-color: var(--el-color-primary); background: #f5f9ff; }
.drop-zone.is-dragover { border-color: var(--el-color-primary); background: #ecf5ff; }
.drop-zone.has-image { border-style: solid; background: #fff; }
.zone-icon { font-size: 22px; color: #c0c4cc; }
.zone-text { font-size: 12px; color: #606266; }
.zone-sub { font-size: 11px; color: #a8abb2; }
.zone-img { width: 100%; height: 100%; }
.zone-mask {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 11px;
  color: #fff;
  background: rgba(0, 0, 0, 0.45);
  opacity: 0;
  transition: opacity 0.2s;
}
.zone-mask .el-icon { font-size: 18px; }
.drop-zone.has-image:hover .zone-mask { opacity: 1; }
.zone-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  font-size: 14px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  border-radius: 50%;
  padding: 2px;
  z-index: 2;
}
.zone-remove:hover { background: var(--el-color-danger); }
.zone-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.7);
  font-size: 22px;
  color: var(--el-color-primary);
}
.hidden-input { display: none; }
.url-field { flex: 1; max-width: 360px; margin-top: 4px; }
</style>
