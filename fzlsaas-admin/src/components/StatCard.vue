<template>
  <div class="stat-card" :class="['stat-' + type, { clickable: clickable }]" @click="$emit('click')">
    <div class="stat-icon-wrap">
      <el-icon :size="20"><component :is="icon" /></el-icon>
    </div>
    <div class="stat-body">
      <div class="stat-title">{{ title }}</div>
      <div class="stat-num">{{ displayValue }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  type: string
  icon: string
  title: string
  value: string | number | null | undefined
  prefix?: string
  clickable?: boolean
}>()

defineEmits<{ click: [] }>()

const displayValue = computed(() => {
  if (props.value === null || props.value === undefined || props.value === '--') return '--'
  if (typeof props.value === 'string' && props.value.startsWith('¥')) return props.value
  const num = Number(props.value)
  if (!Number.isFinite(num)) return String(props.value)
  const formatted = num.toLocaleString('zh-CN')
  return props.prefix ? `${props.prefix}${formatted}` : formatted
})
</script>

<style scoped>
.stat-card {
  display: flex;
  align-items: center;
  gap: 16px;
  background: var(--gov-bg-card, #fff);
  border-radius: var(--gov-radius-card, 6px);
  padding: 18px 20px;
  margin-bottom: 16px;
  border: 1px solid var(--gov-border);
  box-shadow: var(--gov-shadow-card);
  transition: all 0.2s cubic-bezier(0.38, 0, 0.24, 1);
  cursor: default;
  height: 100%;
  box-sizing: border-box;
}

.stat-card.clickable {
  cursor: pointer;
}

.stat-card.clickable:hover {
  border-color: var(--gov-primary);
  box-shadow: 0 4px 12px rgba(0, 82, 217, 0.08);
  transform: translateY(-1px);
}

/* 大厂政企专业风指标卡配色 */
.stat-member .stat-icon-wrap {
  background: var(--gov-primary-light, #ebf2ff);
  color: var(--gov-primary, #0052D9);
}

.stat-newuser .stat-icon-wrap {
  background: var(--gov-success-light, #edfaf5);
  color: var(--gov-success, #00a870);
}

.stat-grant .stat-icon-wrap {
  background: var(--gov-warning-light, #fef3eb);
  color: var(--gov-warning, #ed7b2f);
}

.stat-consume .stat-icon-wrap {
  background: var(--gov-danger-light, #fdedee);
  color: var(--gov-danger, #e34d59);
}

.stat-verify .stat-icon-wrap {
  background: #f3eeff;
  color: #7b4fd4;
}

.stat-approval .stat-icon-wrap {
  background: #e6fffb;
  color: #13c2c2;
}

.stat-icon-wrap {
  width: 42px;
  height: 42px;
  border-radius: var(--gov-radius, 4px);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.stat-body {
  flex: 1;
  min-width: 0;
}

.stat-title {
  font-size: 13px;
  color: var(--gov-text-secondary);
  line-height: 20px;
  font-weight: 500;
}

.stat-num {
  font-size: 26px;
  font-weight: 700;
  color: var(--gov-text-primary);
  margin-top: 2px;
  line-height: 32px;
  font-variant-numeric: tabular-nums;
}
</style>
