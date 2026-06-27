<template>
  <div class="liquid-fill" :style="{ width: size + 'px', height: size + 'px' }">
    <!-- 外层充电扩散光圈（CSS 动画，比 SVG stroke 更明显） -->
    <span class="charge-ring charge-ring-1" :style="ringStyle" />
    <span class="charge-ring charge-ring-2" :style="ringStyle" />
    <span class="charge-ring charge-ring-3" :style="ringStyle" />

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
          <feDropShadow dx="0" dy="4" stdDeviation="8" :flood-color="color2" flood-opacity="0.25" />
        </filter>
        <filter :id="glowId" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <circle :cx="cx" :cy="cy" :r="radius + 2" fill="none" :stroke="color1" stroke-width="2" opacity="0.08" :filter="`url(#${shadowId})`" />
      <circle :cx="cx" :cy="cy" :r="radius" fill="none" stroke="#e0e0e0" stroke-width="2.5" opacity="0.5" />
      <circle :cx="cx" :cy="cy" :r="radius - 1" fill="none" :stroke="color1" stroke-width="0.5" opacity="0.15" />
      <circle :cx="cx" :cy="cy" :r="radius - 2" :fill="color2" opacity="0.04" />

      <g :clip-path="`url(#${clipId})`">
        <rect :x="0" :y="waterY" :width="size" :height="size" :fill="`url(#${gradId})`" opacity="0.15" />
        <path :d="wavePath1" :fill="`url(#${gradId})`" opacity="0.6">
          <animateTransform attributeName="transform" type="translate" :values="`0 0; -${size} 0`" dur="4s" repeatCount="indefinite" />
        </path>
        <path :d="wavePath2" :fill="`url(#${gradId})`" opacity="0.35">
          <animateTransform attributeName="transform" type="translate" :values="`-${size} 0; 0 0`" dur="5.5s" repeatCount="indefinite" />
        </path>
        <path :d="wavePath3" :fill="`url(#${gradId})`" opacity="0.22">
          <animateTransform attributeName="transform" type="translate" :values="`0 0; -${size * 0.7} 0`" dur="7s" repeatCount="indefinite" />
        </path>

        <!-- 水中气泡：持续上浮 + 轻微横漂 -->
        <circle
          v-for="b in bubbles"
          :key="b.id"
          :cx="b.x"
          :cy="b.y"
          :r="b.r"
          fill="white"
          :opacity="b.opacity"
          :filter="`url(#${glowId})`"
        >
          <animate attributeName="cy" :values="`${b.startY};${b.endY};${b.startY}`" :dur="b.dur + 's'" repeatCount="indefinite" />
          <animate attributeName="cx" :values="`${b.x};${b.x + b.drift};${b.x}`" :dur="b.dur + 's'" repeatCount="indefinite" />
          <animate attributeName="opacity" :values="`0;${b.opacity};${b.opacity * 0.6};0`" :dur="b.dur + 's'" repeatCount="indefinite" />
          <animate attributeName="r" :values="`${b.r * 0.6};${b.r};${b.r * 0.8}`" :dur="b.dur + 's'" repeatCount="indefinite" />
        </circle>
      </g>

      <circle :cx="cx" :cy="cy" :r="radius - 2" :fill="`url(#${sphereId})`" />
      <ellipse :cx="cx * 0.78" :cy="cy * 0.65" :rx="radius * 0.28" :ry="radius * 0.15" fill="white" opacity="0.25" transform="rotate(-20)" />
      <circle :cx="cx" :cy="cy" :r="radius - 3" :fill="`url(#${highlightId})`" />

      <!-- 球体边缘呼吸光晕 -->
      <circle :cx="cx" :cy="cy" :r="radius" fill="none" :stroke="color1" stroke-width="2.5" class="pulse-ring" />
      <circle :cx="cx" :cy="cy" :r="radius + 4" fill="none" :stroke="color2" stroke-width="1.5" class="pulse-ring-outer" />
    </svg>

    <div class="lf-text">
      <div class="lf-percent">{{ displayPercent }}<span class="lf-unit">%</span></div>
      <div class="lf-label">{{ label }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, onMounted } from 'vue'

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
const glowId = `lf-glow-${uid}`
const radius = computed(() => props.size / 2 - 8)
const cx = computed(() => props.size / 2)
const cy = computed(() => props.size / 2)

const ringStyle = computed(() => ({
  width: `${radius.value * 2}px`,
  height: `${radius.value * 2}px`,
  borderColor: props.color1,
  boxShadow: `0 0 12px ${props.color2}55, inset 0 0 8px ${props.color1}33`,
}))

const safeRatio = computed(() => Math.max(0, Math.min(1, props.ratio)))
const animatedRatio = ref(1)
const displayPercent = computed(() => (animatedRatio.value * 100).toFixed(1))

function animateTo(target: number) {
  const start = animatedRatio.value
  const diff = target - start
  const duration = 1500
  const startTime = Date.now()
  function tick() {
    const elapsed = Date.now() - startTime
    const progress = Math.min(1, elapsed / duration)
    const eased = 1 - Math.pow(1 - progress, 3)
    animatedRatio.value = Math.round((start + diff * eased) * 10000) / 10000
    if (progress < 1) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

watch(safeRatio, (val) => animateTo(val))
onMounted(() => { setTimeout(() => animateTo(safeRatio.value), 300) })

const waterY = computed(() => props.size * (1 - animatedRatio.value))

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

/** 固定种子气泡，避免水位动画导致气泡重置 */
const bubbles = computed(() => {
  const s = props.size
  const surfaceY = s * (1 - safeRatio.value)
  const list = []
  for (let i = 0; i < 12; i++) {
    const seed = (i * 137.508) % 1
    const seed2 = (i * 97.31) % 1
    list.push({
      id: i,
      x: s * 0.18 + (s * 0.64) * seed,
      y: s * 0.55 + seed2 * s * 0.35,
      startY: s - 8 - seed * 12,
      endY: Math.max(surfaceY + 6, s * 0.25),
      r: 2.5 + seed * 4,
      opacity: 0.25 + seed * 0.35,
      drift: (seed - 0.5) * 10,
      dur: 2.5 + (i % 5) * 0.7,
    })
  }
  return list
})

const wavePath1 = computed(() => buildWavePath(11, props.size * 0.55, 0, waterY.value))
const wavePath2 = computed(() => buildWavePath(8, props.size * 0.45, 2, waterY.value + 2))
const wavePath3 = computed(() => buildWavePath(5, props.size * 0.35, 4, waterY.value + 5))
</script>

<style scoped>
.liquid-fill {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  filter: drop-shadow(0 6px 16px rgba(0, 0, 0, 0.08));
}

.charge-ring {
  position: absolute;
  border-radius: 50%;
  border: 2px solid;
  pointer-events: none;
  opacity: 0;
  animation: chargeExpand 2.8s ease-out infinite;
}

.charge-ring-1 { animation-delay: 0s; }
.charge-ring-2 { animation-delay: 0.9s; }
.charge-ring-3 { animation-delay: 1.8s; }

@keyframes chargeExpand {
  0% {
    transform: scale(0.92);
    opacity: 0.55;
  }
  70% {
    opacity: 0.12;
  }
  100% {
    transform: scale(1.35);
    opacity: 0;
  }
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

.pulse-ring {
  animation: pulseGlow 2s ease-in-out infinite;
}

.pulse-ring-outer {
  animation: pulseGlow 2s ease-in-out infinite 0.6s;
}

@keyframes pulseGlow {
  0%, 100% {
    opacity: 0.15;
    stroke-width: 2;
  }
  50% {
    opacity: 0.55;
    stroke-width: 3.5;
  }
}
</style>
