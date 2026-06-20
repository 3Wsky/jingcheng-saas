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
  margin-bottom: 12px;
  gap: 16px;
}
.page-head-left { min-width: 0; }
.page-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
  line-height: 28px;
}
.page-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
  line-height: 20px;
}
.page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* 轻奢风内容面板 */
.page-panel {
  background: var(--sw-bg-card, #fff);
  border-radius: var(--sw-radius-card, 12px);
  border: 1px solid var(--sw-border, rgba(0, 0, 0, 0.06));
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.04);
  padding: 16px 20px 20px;
}

.page-filter {
  background: var(--sw-bg-page, #f5f3f0);
  border: 1px solid var(--sw-border, rgba(0, 0, 0, 0.06));
  border-radius: var(--sw-radius, 8px);
  padding: 16px 16px 4px;
  margin-bottom: 16px;
}
.page-filter :deep(.el-form-item) {
  margin-bottom: 12px;
  margin-right: 16px;
}
.page-filter :deep(.el-form-item__label) {
  color: rgba(0, 0, 0, 0.65);
  font-weight: 400;
}

.page-tabs {
  margin-bottom: 12px;
}
.page-tabs :deep(.el-tabs__header) {
  margin-bottom: 0;
}
.page-tabs :deep(.el-tabs__item) {
  height: 40px;
  line-height: 40px;
  font-size: 14px;
}
.page-tabs :deep(.el-tabs__item.is-active) {
  font-weight: 600;
  color: var(--el-color-primary);
}

.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 12px 0;
  border-bottom: 1px solid #f0f0f0;
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
}
.page-body :deep(.el-table th.el-table__cell) {
  background: #fafafa !important;
  color: rgba(0, 0, 0, 0.85);
  font-weight: 600;
  font-size: 13px;
}
.page-body :deep(.el-table .el-table__cell) {
  padding: 12px 0;
}

.page-footer {
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f0f0f0;
  display: flex;
  justify-content: flex-end;
}
</style>
