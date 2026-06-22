<template>
  <div class="page-shell">
    <div v-if="title || $slots.actions" class="page-head">
      <div class="page-head-left">
        <h2 v-if="title" class="page-title">{{ title }}</h2>
        <p v-if="subtitle" class="page-subtitle">{{ subtitle }}</p>
      </div>
      <div v-if="$slots.actions" class="page-actions">
        <slot name="actions" />
      </div>
    </div>

    <div class="page-panel">
      <div v-if="$slots.filter" class="page-filter">
        <slot name="filter" />
      </div>

      <div v-if="$slots.tabs" class="page-tabs">
        <slot name="tabs" />
      </div>

      <div v-if="$slots.toolbar" class="page-toolbar">
        <slot name="toolbar" />
      </div>

      <div class="page-body">
        <slot />
      </div>

      <div v-if="$slots.footer" class="page-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ title?: string; subtitle?: string }>()
</script>

<style scoped>
.page-shell {
  min-height: 100%;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 16px;
}
.page-head-left { min-width: 0; }
.page-title {
  margin: 0;
  font-size: 18px; /* 18px 更加克制、严谨 */
  font-weight: 600;
  color: var(--gov-text-primary);
  line-height: 26px;
}
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--gov-text-secondary);
  line-height: 20px;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 大厂政企专业风内容面板 */
.page-panel {
  background: var(--gov-bg-card, #fff);
  border-radius: var(--gov-radius-card, 6px);
  border: 1px solid var(--gov-border);
  box-shadow: var(--gov-shadow-card);
  padding: 20px;
}

.page-filter {
  background: var(--gov-bg-page, #f2f3f5);
  border: 1px solid var(--gov-border);
  border-radius: var(--gov-radius, 4px);
  padding: 16px 16px 4px;
  margin-bottom: 16px;
}
.page-filter :deep(.el-form-item) {
  margin-bottom: 12px;
  margin-right: 16px;
}
.page-filter :deep(.el-form-item__label) {
  color: var(--gov-text-secondary);
  font-weight: 500;
  font-size: 13px;
}

.page-tabs {
  margin-bottom: 16px;
}
.page-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
  border-bottom: 1px solid var(--gov-border);
}
.page-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}
.page-tabs :deep(.el-tabs__item) {
  height: 40px;
  line-height: 40px;
  font-size: 14px;
  color: var(--gov-text-secondary);
  transition: all 0.2s;
}
.page-tabs :deep(.el-tabs__item:hover) {
  color: var(--gov-primary);
}
.page-tabs :deep(.el-tabs__item.is-active) {
  font-weight: 600;
  color: var(--gov-primary);
}
.page-tabs :deep(.el-tabs__active-bar) {
  background-color: var(--gov-primary);
  height: 2.5px;
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--gov-border);
  flex-wrap: wrap;
  width: 100%;
}
.page-toolbar :deep(.toolbar-left),
.page-toolbar :deep(.toolbar-right) {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.page-toolbar :deep(.toolbar-right) {
  margin-left: auto;
}

.page-body {
  min-height: 120px;
}
.page-body :deep(.el-table) {
  font-size: 13px;
  color: var(--gov-text-primary);
}
.page-body :deep(.el-table th.el-table__cell) {
  background: #f7f8fa !important;
  color: var(--gov-text-secondary);
  font-weight: 600;
  font-size: 13px;
  height: 40px;
  padding: 0;
}
.page-body :deep(.el-table .el-table__cell) {
  padding: 10px 0;
  border-bottom: 1px solid var(--gov-border);
}
.page-body :deep(.el-table .el-table__row:hover > td) {
  background-color: #f7f8fa !important;
}

.page-footer {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--gov-border);
  display: flex;
  justify-content: flex-end;
}
</style>
