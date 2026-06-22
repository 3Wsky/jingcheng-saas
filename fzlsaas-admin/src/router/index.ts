import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/login/index.vue'),
    meta: { title: '登录', public: true },
  },
  {
    path: '/',
    component: () => import('@/layout/index.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'Dashboard',
        component: () => import('@/views/dashboard/index.vue'),
        meta: { title: '数据看板', icon: 'DataBoard', module: 'workspace' },
      },
      {
        path: 'members',
        name: 'Members',
        component: () => import('@/views/members/index.vue'),
        meta: { title: '会员管理', icon: 'User', module: 'member' },
      },
      {
        path: 'membership-plans',
        name: 'MembershipPlans',
        component: () => import('@/views/membership/plans.vue'),
        meta: { title: '会员卡方案', icon: 'Ticket', module: 'member' },
      },
      {
        path: 'staff',
        name: 'Staff',
        component: () => import('@/views/staff/index.vue'),
        meta: { title: '店员管理', icon: 'Avatar', module: 'member' },
      },
      {
        path: 'merchant',
        name: 'Merchant',
        component: () => import('@/views/merchant/index.vue'),
        meta: { title: '商家管理', icon: 'Shop', module: 'merchant' },
      },
      {
        path: 'approval',
        name: 'Approval',
        component: () => import('@/views/approval/index.vue'),
        meta: { title: '审批管理', icon: 'Stamp', module: 'workspace' },
      },
      {
        path: 'products',
        name: 'Products',
        component: () => import('@/views/products/index.vue'),
        meta: { title: '商品管理', icon: 'Goods', module: 'settings' },
      },
      {
        path: 'integral-mall',
        name: 'IntegralMall',
        component: () => import('@/views/integral-mall/index.vue'),
        meta: { title: '积分商品管理', icon: 'ShoppingCart', module: 'integral' },
      },
      {
        path: 'integral-mall/edit/:id?',
        name: 'IntegralMallEdit',
        component: () => import('@/views/integral-mall/edit.vue'),
        meta: { title: '发布积分商品', hidden: true, module: 'integral' },
      },
      {
        path: 'integral-mall/orders',
        name: 'IntegralMallOrders',
        component: () => import('@/views/integral-mall/orders.vue'),
        meta: { title: '兑换订单', icon: 'List', module: 'integral' },
      },
      {
        path: 'audit-logs',
        name: 'AuditLogs',
        component: () => import('@/views/audit-logs/index.vue'),
        meta: { title: '审计日志', icon: 'Document', module: 'settings' },
      },
      {
        path: 'system-settings',
        name: 'SystemSettings',
        component: () => import('@/views/system/settings.vue'),
        meta: { title: '系统设置', icon: 'Setting', module: 'settings' },
      },
      {
        path: 'lottery',
        name: 'Lottery',
        component: () => import('@/views/lottery/index.vue'),
        meta: { title: '新客抽奖', icon: 'Present', module: 'settings' },
      },
      {
        path: 'finance-cash',
        name: 'FinanceCash',
        component: () => import('@/views/finance/cash-ledger.vue'),
        meta: { title: '现金券流水', icon: 'Wallet', module: 'settings' },
      },
      {
        path: 'finance-integral',
        name: 'FinanceIntegral',
        component: () => import('@/views/finance/integral-ledger.vue'),
        meta: { title: '积分记录', icon: 'Coin', module: 'integral' },
      },
      {
        path: 'finance-recharge',
        name: 'FinanceRecharge',
        component: () => import('@/views/finance/recharge.vue'),
        meta: { title: '积分充值', icon: 'CreditCard', module: 'integral' },
      },
      {
        path: 'finance-settlement',
        name: 'FinanceSettlement',
        component: () => import('@/views/finance/settlement.vue'),
        meta: { title: '商家结算', icon: 'Money', module: 'merchant' },
      },
      {
        path: 'finance-settings',
        name: 'FinanceSettings',
        component: () => import('@/views/finance/settings.vue'),
        meta: { title: '财务设置', icon: 'Setting', module: 'settings' },
      },
    ],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || '锦程数码会员电商系统'} - 管理后台`
  next()
})

export default router
