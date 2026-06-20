<template>
  <div class="rich-text-editor" :style="{ maxWidth: maxWidth }">
    <Toolbar class="editor-toolbar" :editor="editorRef" :default-config="toolbarConfig" mode="default" />
    <Editor
      class="editor-body"
      :model-value="modelValue"
      :default-config="editorConfig"
      mode="default"
      @on-created="handleCreated"
      @update:model-value="emit('update:modelValue', $event)"
    />
  </div>
</template>

<script setup lang="ts">
import '@wangeditor/editor/dist/css/style.css'
import { onBeforeUnmount, shallowRef, computed } from 'vue'
import { Editor, Toolbar } from '@wangeditor/editor-for-vue'
import type { IDomEditor, IEditorConfig, IToolbarConfig } from '@wangeditor/editor'
import { uploadImage } from '@/utils/upload'
import { ElMessage } from 'element-plus'

const props = withDefaults(defineProps<{
  modelValue?: string
  placeholder?: string
  height?: number
  maxWidth?: string
}>(), {
  modelValue: '',
  placeholder: '请输入内容…',
  height: 480,
  maxWidth: '720px'
})

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const editorRef = shallowRef<IDomEditor>()
const editorHeight = computed(() => `${props.height}px`)

const toolbarConfig: Partial<IToolbarConfig> = {
  excludeKeys: ['group-video', 'fullScreen']
}

const editorConfig = computed<Partial<IEditorConfig>>(() => ({
  placeholder: props.placeholder,
  autoFocus: false,
  MENU_CONF: {
    uploadImage: {
      maxFileSize: 5 * 1024 * 1024,
      allowedFileTypes: ['image/*'],
      async customUpload(file: File, insertFn: (url: string, alt?: string, href?: string) => void) {
        try {
          const url = await uploadImage(file)
          insertFn(url, file.name)
        } catch {
          ElMessage.error('图片上传失败')
        }
      }
    }
  }
}))

function handleCreated(editor: IDomEditor) {
  editorRef.value = editor
}

onBeforeUnmount(() => {
  editorRef.value?.destroy()
})
</script>

<style scoped>
.rich-text-editor {
  border: 1px solid #e8e8e8;
  border-radius: 4px;
  overflow: hidden;
  width: 100%;
}
.editor-toolbar {
  border-bottom: 1px solid #e8e8e8;
}
.editor-body {
  height: v-bind(editorHeight);
  overflow-y: auto;
}
:deep(.w-e-text-container) {
  background: #fff;
}
:deep(.w-e-toolbar) {
  flex-wrap: wrap;
}
</style>
