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
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.4;
}
.tag-tier199 { background: var(--sw-gold-soft, #fbf6e8); color: var(--sw-gold-dark, #8b6914); }
.tag-tier299 { background: linear-gradient(135deg, #f3eeff, #fbf6e8); color: #7b4fd4; border: 1px solid rgba(201, 162, 39, 0.2); }
.tag-normal { background: #F3F4F6; color: #6B7280; }
.tag-staff { background: #ECFDF3; color: #059669; }
.tag-manager { background: #FFF4EC; color: #D97706; }
.tag-merchant { background: #EFF6FF; color: #2563EB; }
</style>
