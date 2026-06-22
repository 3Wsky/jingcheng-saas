<template>
  <router-view />
</template>

<style>
@import '@/styles/tokens.css';

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB',
    'Microsoft YaHei', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-size: 14px;
  color: var(--gov-text-primary);
  background: var(--gov-bg-page);
  -webkit-font-smoothing: antialiased;
}

/* 大厂政企专业风组件微调 */
.el-button {
  font-weight: 500;
  border-radius: var(--gov-radius);
  transition: all 0.2s cubic-bezier(0.38, 0, 0.24, 1);
}

.el-button--primary {
  box-shadow: var(--gov-shadow-button);
}

.el-button--primary:hover {
  background-color: var(--gov-primary-hover);
  border-color: var(--gov-primary-hover);
  box-shadow: 0 2px 4px rgba(0, 82, 217, 0.15);
}

.el-button--primary:active {
  background-color: var(--gov-primary-active);
  border-color: var(--gov-primary-active);
}

.el-card {
  border-radius: var(--gov-radius-card);
  border-color: var(--gov-border);
  box-shadow: var(--gov-shadow-card) !important;
  transition: all 0.2s ease;
}

.el-card.is-hover-shadow:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05) !important;
}

.el-input__wrapper,
.el-select__wrapper {
  border-radius: var(--gov-radius);
  box-shadow: 0 0 0 1px var(--gov-border) inset;
}

.el-input__wrapper.is-focus,
.el-select__wrapper.is-focus {
  box-shadow: 0 0 0 1px var(--gov-primary) inset !important;
}

.el-pagination {
  font-weight: 400;
}

.el-dialog {
  border-radius: var(--gov-radius-card);
  box-shadow: var(--gov-shadow-dropdown);
}

.el-drawer__header {
  margin-bottom: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--gov-border);
  font-weight: 600;
  color: var(--gov-text-primary);
}

/* 表格大厂严谨风微调 */
.admin-table.el-table {
  font-size: 14px;
  color: var(--gov-text-primary);
}

.admin-table .el-table__header th {
  background-color: #f7f8fa !important;
  color: var(--gov-text-secondary);
  font-weight: 600;
  height: 44px;
  padding: 0;
}

.admin-table .el-table__cell {
  padding: 12px 0;
  border-bottom: 1px solid var(--gov-border);
}

.admin-table .el-table__row:hover > td {
  background-color: #f7f8fa !important;
}

.text-muted {
  color: var(--gov-text-muted);
}

/* 滚动条美化 */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.12);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.24);
}
</style>
