<template>
  <div class="liquid-fill" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :viewBox="`0 0 ${size} ${size}`" class="lf-svg">
      <defs>
        <clipPath :id="clipId">
          <circle :cx="size / 2" :cy="size / 2" :r="radius" />
        </clipPath>
        <linearGradient :id="gradId" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" :stop-color="color1" stop-opacity="0.9" />
          <stop offset="100%" :stop-color="color2" stop-opacity="0.9" />
        </linearGradient>
      </defs>
      <circle :cx="size / 2" :cy="size / 2" :r="radius" fill="none" :stroke="borderColor" stroke-width="3" opacity="0.15" />
      <circle :cx="size / 2" :cy="size / 2" :r="radius - 4" fill="none" :stroke="borderColor" stroke-width="1" opacity="0.08" />
      <g :clip-path="`url(#${clipId})`">
        <rect :x="0" :y="waterY" :width="size" :height="size" :fill="`url(#${gradId})`" opacity="0.12" />
        <path :d="wavePath1" :fill="`url(#${gradId})`" opacity="0.6">
          <animateTransform attributeName="transform" type="translate" :values="`0 0; -${size} 0`" dur="4s" repeatCount="indefinite" />
        </path>
        <path :d="wavePath2" :fill="`url(#${gradId})`" opacity="0.35">
          <animateTransform attributeName="transform" type="translate" :values="`-${size} 0; 0 0`" dur="6s" repeatCount="indefinite" />
        </path>
      </g>
    </svg>
    <div class="lf-text">
      <div class="lf-percent">{{ displayPercent }}<span class="lf-unit">%</span></div>
      <div class="lf-label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  ratio: number
  label?: string
  size?: number
  color1?: string
  color2?: string
}>(), {
  ratio: 0,
  label: '已使用',
  size: 180,
  color1: '#0052d9',
  color2: '#00a870',
})

const uid = Math.random().toString(36).slice(2, 8)
const clipId = `lf-clip-${uid}`
const gradId = `lf-grad-${uid}`
const radius = computed(() => props.size / 2 - 6)
const borderColor = computed(() => props.color1)

const safeRatio = computed(() => Math.max(0, Math.min(1, props.ratio)))
const displayPercent = computed(() => (safeRatio.value * 100).toFixed(1))

const waterY = computed(() => {
  const h = props.size
  return h * (1 - safeRatio.value)
})

function buildWavePath(amp: number, period: number, phase: number, y: number): string {
  const w = props.size * 2
  const h = props.size
  let d = `M 0 ${y}`
  for (let x = 0; x <= w; x += 4) {
    const dy = Math.sin((x / period) * Math.PI * 2 + phase) * amp
    d += ` L ${x} ${y + dy}`
  }
  d += ` L ${w} ${h} L 0 ${h} Z`
  return d
}

const wavePath1 = computed(() => buildWavePath(6, props.size * 0.6, 0, waterY.value))
const wavePath2 = computed(() => buildWavePath(4, props.size * 0.5, 2, waterY.value + 3))
</script>

<style scoped>
.liquid-fill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.lf-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.lf-text {
  position: relative;
  z-index: 2;
  text-align: center;
  pointer-events: none;
}

.lf-percent {
  font-size: 32px;
  font-weight: 800;
  color: var(--gov-text-primary, #1a1a1a);
  line-height: 1;
}

.lf-unit {
  font-size: 16px;
  font-weight: 600;
  margin-left: 2px;
}

.lf-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--gov-text-secondary, #8b95a5);
  font-weight: 500;
}
</style>
