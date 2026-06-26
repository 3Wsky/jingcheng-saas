<template>
  <div class="liquid-fill" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :viewBox="`0 0 ${size} ${size}`" class="lf-svg">
      <defs>
        <clipPath :id="clipId">
          <circle :cx="cx" :cy="cy" :r="radius" />
        </clipPath>
        <linearGradient :id="gradId" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" :stop-color="color1" stop-opacity="0.85" />
          <stop offset="100%" :stop-color="color2" stop-opacity="0.95" />
        </linearGradient>
        <radialGradient :id="sphereId" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />
          <stop offset="50%" stop-color="#ffffff" stop-opacity="0.03" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0.08" />
        </radialGradient>
        <radialGradient :id="highlightId" cx="30%" cy="25%" r="30%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.5" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </radialGradient>
        <filter :id="shadowId" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="4" stdDeviation="8" :flood-color="color2" flood-opacity="0.2" />
        </filter>
      </defs>

      <!-- 3D 外圈阴影 -->
      <circle :cx="cx" :cy="cy" :r="radius + 2" fill="none" :stroke="color1" stroke-width="2" opacity="0.06" :filter="`url(#${shadowId})`" />

      <!-- 外圈玻璃边框 -->
      <circle :cx="cx" :cy="cy" :r="radius" fill="none" stroke="#e0e0e0" stroke-width="2.5" opacity="0.5" />
      <circle :cx="cx" :cy="cy" :r="radius - 1" fill="none" :stroke="color1" stroke-width="0.5" opacity="0.15" />

      <!-- 球体底色 -->
      <circle :cx="cx" :cy="cy" :r="radius - 2" :fill="color2" opacity="0.04" />

      <!-- 水面 -->
      <g :clip-path="`url(#${clipId})`">
        <rect :x="0" :y="waterY" :width="size" :height="size" :fill="`url(#${gradId})`" opacity="0.15" />
        <path :d="wavePath1" :fill="`url(#${gradId})`" opacity="0.55">
          <animateTransform attributeName="transform" type="translate" :values="`0 0; -${size} 0`" dur="5s" repeatCount="indefinite" />
        </path>
        <path :d="wavePath2" :fill="`url(#${gradId})`" opacity="0.3">
          <animateTransform attributeName="transform" type="translate" :values="`-${size} 0; 0 0`" dur="7s" repeatCount="indefinite" />
        </path>
        <path :d="wavePath3" :fill="`url(#${gradId})`" opacity="0.18">
          <animateTransform attributeName="transform" type="translate" :values="`0 0; -${size * 0.7} 0`" dur="9s" repeatCount="indefinite" />
        </path>
      </g>

      <!-- 3D 球体光泽 -->
      <circle :cx="cx" :cy="cy" :r="radius - 2" :fill="`url(#${sphereId})`" />

      <!-- 高光反射 -->
      <ellipse :cx="cx * 0.78" :cy="cy * 0.65" :rx="radius * 0.28" :ry="radius * 0.15" fill="white" opacity="0.25" transform="rotate(-20)" />
      <circle :cx="cx" :cy="cy" :r="radius - 3" :fill="`url(#${highlightId})`" />
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
const sphereId = `lf-sphere-${uid}`
const highlightId = `lf-hl-${uid}`
const shadowId = `lf-shadow-${uid}`
const radius = computed(() => props.size / 2 - 8)
const cx = computed(() => props.size / 2)
const cy = computed(() => props.size / 2)

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

const wavePath1 = computed(() => buildWavePath(7, props.size * 0.6, 0, waterY.value))
const wavePath2 = computed(() => buildWavePath(5, props.size * 0.5, 2, waterY.value + 2))
const wavePath3 = computed(() => buildWavePath(3, props.size * 0.4, 4, waterY.value + 5))
</script>

<style scoped>
.liquid-fill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.08));
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
  text-shadow: 0 1px 3px rgba(255, 255, 255, 0.6);
}

.lf-percent {
  font-size: 34px;
  font-weight: 800;
  color: var(--gov-text-primary, #1a1a1a);
  line-height: 1;
  letter-spacing: -1px;
}

.lf-unit {
  font-size: 16px;
  font-weight: 600;
  margin-left: 2px;
  opacity: 0.7;
}

.lf-label {
  margin-top: 6px;
  font-size: 12px;
  color: var(--gov-text-secondary, #8b95a5);
  font-weight: 500;
  letter-spacing: 1px;
}
</style>
