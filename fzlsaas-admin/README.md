# FZLSaas 管理后台

反重力人工智能工作室 · **锦程数码** 会员管理后台

## 技术栈

- Vue 3 + TypeScript + Vite
- Element Plus (UI 组件库)
- Pinia (状态管理)
- Vue Router (路由)
- Axios (HTTP)

## 快速开始

```bash
cd fzlsaas-admin
npm install
npm run dev
# 打开 http://localhost:3000
```

默认账号: `admin` / `shunwei2026`

## 前置条件

shunwei-api 需在本地运行:

```bash
cd CMB/shunwei-api
npm run dev
# 监听 127.0.0.1:8787
```

Vite 开发服务器自动代理 `/api/*` 和 `/admin/*` 到 8787。

## 功能模块

| 模块 | 路径 | 功能 |
|------|------|------|
| 数据看板 | /dashboard | 会员/核销/结算/审批统计 |
| 现金券管理 | /voucher | 发放现金券 + 核销模式切换 |
| 商家管理 | /merchant | 创建异业商家 + 授权核销权限 |
| 审批管理 | /approval | 超管终审待办 + 通过/驳回 |
| 商品管理 | /products | 展示商品列表 |
| 新客抽奖 | /lottery | 抽奖运营概览 |
