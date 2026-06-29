<template>
  <div class="bh-editor">
    <template v-if="!customMode">
      <div v-for="(seg, idx) in segments" :key="idx" class="bh-seg">
        <el-select v-model="seg.days" placeholder="适用日" style="width: 150px" @change="emitValue">
          <el-option v-for="d in dayPresets" :key="d" :label="d" :value="d" />
        </el-select>
        <el-time-select
          v-model="seg.open"
          start="00:00"
          end="23:30"
          step="00:30"
          placeholder="开始"
          style="width: 116px"
          @change="emitValue"
        />
        <span class="bh-sep">至</span>
        <el-time-select
          v-model="seg.close"
          start="00:00"
          end="23:30"
          step="00:30"
          placeholder="结束"
          style="width: 116px"
          @change="emitValue"
        />
        <el-tag v-if="isOvernight(seg)" size="small" type="warning" effect="plain" class="bh-next">次日</el-tag>
        <el-button
          v-if="segments.length > 1"
          link
          type="danger"
          class="bh-del"
          @click="removeSeg(idx)"
        >删除</el-button>
      </div>

      <div class="bh-actions">
        <el-button v-if="segments.length < 4" link type="primary" @click="addSeg">+ 添加时段</el-button>
        <el-button link type="info" @click="enterCustom">自定义文本</el-button>
      </div>
      <p class="bh-preview" v-if="previewText">展示效果：<span>{{ previewText }}</span></p>
    </template>

    <template v-else>
      <el-input
        v-model="customText"
        type="textarea"
        :rows="3"
        maxlength="200"
        show-word-limit
        placeholder="自定义营业时间，可换行；例如：&#10;周一至周四 13:00-次日01:30&#10;周五至周日 11:00-次日02:00"
        @input="emitValue"
      />
      <div class="bh-actions">
        <el-button link type="info" @click="exitCustom">← 用时段选择器</el-button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'

interface Segment {
  days: string
  open: string
  close: string
}

const props = withDefaults(defineProps<{ modelValue?: string }>(), {
  modelValue: ''
})
const emit = defineEmits<{ 'update:modelValue': [string] }>()

const dayPresets = ['每天', '周一至周五', '周一至周四', '周五至周日', '周六至周日', '工作日', '节假日']

const segments = ref<Segment[]>([{ days: '每天', open: '', close: '' }])
const customMode = ref(false)
const customText = ref('')

const SEG_SPLIT = /[；;\n]+/
// 解析单条："周一至周四 13:00-次日01:30" / "13:00-01:30" / "周末 10:00 - 22:00"
function parseSegment(raw: string): Segment | null {
  const text = String(raw || '').trim()
  if (!text) return null
  const m = text.match(/(\d{1,2}:\d{2})\s*[-~至到]\s*(?:次日)?\s*(\d{1,2}:\d{2})/)
  if (!m) return null
  const days = text.slice(0, text.indexOf(m[0])).replace(/[：:，,]/g, '').trim() || '每天'
  return { days, open: normTime(m[1]), close: normTime(m[2]) }
}

function normTime(t: string): string {
  const [h, mi] = String(t).split(':')
  return `${String(Number(h)).padStart(2, '0')}:${mi}`
}

function parseAll(value: string): { segs: Segment[]; ok: boolean } {
  const parts = String(value || '').split(SEG_SPLIT).map((s) => s.trim()).filter(Boolean)
  if (!parts.length) return { segs: [{ days: '每天', open: '', close: '' }], ok: true }
  const segs: Segment[] = []
  for (const p of parts) {
    const seg = parseSegment(p)
    if (!seg) return { segs: [], ok: false }
    segs.push(seg)
  }
  return { segs, ok: true }
}

function isOvernight(seg: Segment): boolean {
  if (!seg.open || !seg.close) return false
  return seg.close <= seg.open
}

function segToText(seg: Segment): string {
  if (!seg.open || !seg.close) return ''
  const close = isOvernight(seg) ? `次日${seg.close}` : seg.close
  const days = seg.days && seg.days !== '每天' ? `${seg.days} ` : ''
  return `${days}${seg.open}-${close}`
}

const previewText = computed(() =>
  segments.value.map(segToText).filter(Boolean).join('；')
)

function serialize(): string {
  if (customMode.value) return customText.value.trim()
  return segments.value.map(segToText).filter(Boolean).join('；')
}

function emitValue() {
  emit('update:modelValue', serialize())
}

function addSeg() {
  segments.value.push({ days: '周五至周日', open: '', close: '' })
}

function removeSeg(idx: number) {
  segments.value.splice(idx, 1)
  if (!segments.value.length) segments.value.push({ days: '每天', open: '', close: '' })
  emitValue()
}

function enterCustom() {
  customText.value = serialize()
  customMode.value = true
  emitValue()
}

function exitCustom() {
  const { segs, ok } = parseAll(customText.value)
  if (ok) {
    segments.value = segs
    customMode.value = false
    emitValue()
  } else {
    customMode.value = false
    segments.value = [{ days: '每天', open: '', close: '' }]
  }
}

// 外部值变化时同步内部状态（仅在与当前序列化结果不一致时）
watch(
  () => props.modelValue,
  (val) => {
    if (val === serialize()) return
    const incoming = String(val || '').trim()
    if (!incoming) {
      segments.value = [{ days: '每天', open: '', close: '' }]
      customMode.value = false
      customText.value = ''
      return
    }
    const { segs, ok } = parseAll(incoming)
    if (ok) {
      segments.value = segs
      customMode.value = false
    } else {
      // 无法解析为时段 → 进自定义文本模式，原样保留
      customText.value = incoming
      customMode.value = true
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.bh-editor { width: 100%; }
.bh-seg { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.bh-sep { color: #606266; font-size: 13px; }
.bh-next { flex: 0 0 auto; }
.bh-del { margin-left: 4px; }
.bh-actions { display: flex; gap: 16px; margin-top: 2px; }
.bh-preview { margin: 10px 0 0; font-size: 12px; color: #9CA3AF; line-height: 1.5; }
.bh-preview span { color: #606266; }
</style>
