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
  color: rgba(0, 0, 0, 0.85);
  background: var(--sw-bg-page);
  -webkit-font-smoothing: antialiased;
}

/* 轻奢风组件微调 */
.el-button {
  font-weight: 500;
  border-radius: var(--sw-radius);
}
.el-button--primary {
  box-shadow: 0 2px 8px rgba(201, 162, 39, 0.22);
}
.el-button--primary:hover {
  box-shadow: 0 4px 12px rgba(201, 162, 39, 0.28);
}
.el-card {
  border-radius: var(--sw-radius-card);
  border-color: var(--sw-border);
}
.el-input__wrapper,
.el-select__wrapper {
  border-radius: var(--sw-radius);
}
.el-pagination {
  font-weight: 400;
}
.el-dialog {
  border-radius: var(--sw-radius-card);
}
.el-drawer__header {
  margin-bottom: 0;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--sw-border);
  font-weight: 600;
  color: rgba(0, 0, 0, 0.85);
}
.admin-table.el-table {
  font-size: 14px;
}
.admin-table .el-table__cell {
  padding: 10px 0;
}
.text-muted { color: rgba(0, 0, 0, 0.35); }
</style>
