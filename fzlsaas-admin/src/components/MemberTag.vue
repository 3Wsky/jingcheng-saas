<template>
  <span class="member-tag" :class="'tag-' + type">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ tag: string }>()

const meta: Record<string, { label: string; type: string }> = {
  tier199: { label: '199会员', type: 'tier199' },
  tier299: { label: '299会员', type: 'tier299' },
  normal: { label: '普通', type: 'normal' },
  staff: { label: '店员', type: 'staff' },
  manager: { label: '店长', type: 'manager' },
  merchant: { label: '商家', type: 'merchant' },
  SW199: { label: '199会员', type: 'tier199' },
  SW299: { label: '299会员', type: 'tier299' },
}

const label = computed(() => meta[props.tag]?.label || props.tag)
const type = computed(() => meta[props.tag]?.type || 'normal')
</script>

<style scoped>
.member-tag {
  display: inline-block;
  padding: 2px 8px;
  border-radius: var(--gov-radius, 4px);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}
.tag-tier199 { background: var(--gov-primary-light, #ebf2ff); color: var(--gov-primary, #0052D9); }
.tag-tier299 { background: #f3eeff; color: #7b4fd4; border: 1px solid rgba(123, 79, 212, 0.15); }
.tag-normal { background: #f3f4f6; color: #6b7280; }
.tag-staff { background: var(--gov-success-light, #edfaf5); color: var(--gov-success, #00a870); }
.tag-manager { background: var(--gov-warning-light, #fef3eb); color: var(--gov-warning, #ed7b2f); }
.tag-merchant { background: #eff6ff; color: #2563eb; }
</style>
