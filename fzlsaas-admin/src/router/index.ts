import { createRouter, createWebHashHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'
import { useUserStore } from '@/store/user'

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
        meta: { title: '客户经理', icon: 'Avatar', module: 'member' },
      },
      {
        path: 'stores',
        name: 'Stores',
        component: () => import('@/views/stores/index.vue'),
        meta: { title: '门店管理', icon: 'OfficeBuilding', module: 'member' },
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
        path: 'approval/pending',
        name: 'ApprovalPending',
        component: () => import('@/views/approval/index.vue'),
        meta: { title: '待审批', icon: 'BellFilled', module: 'workspace' },
      },
      {
        path: 'products',
        name: 'Products',
        component: () => import('@/views/products/index.vue'),
        meta: { title: '商品管理', icon: 'Goods', module: 'integral' },
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
        path: 'sn-catalog',
        name: 'SnCatalog',
        component: () => import('@/views/sn-catalog/index.vue'),
        meta: { title: 'SN产品库', icon: 'Postcard', module: 'integral' },
      },
      {
        path: 'audit-logs',
        name: 'AuditLogs',
        component: () => import('@/views/audit-logs/index.vue'),
        meta: { title: '审计日志', icon: 'Document', module: 'settings' },
      },
      {
        path: 'content',
        name: 'Content',
        component: () => import('@/views/content/index.vue'),
        meta: { title: '内容管理', icon: 'Document', module: 'operation' },
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
        meta: { title: '新客抽奖', icon: 'Present', module: 'operation' },
      },
      {
        path: 'homepage-banners',
        name: 'HomepageBanners',
        component: () => import('@/views/operation/homepage-banners.vue'),
        meta: { title: '首页轮播图', icon: 'Picture', module: 'operation' },
      },
      {
        path: 'share-config',
        name: 'ShareConfig',
        component: () => import('@/views/operation/share-config.vue'),
        meta: { title: '分享设置', icon: 'Share', module: 'operation' },
      },
      {
        path: 'finance-cash',
        name: 'FinanceCash',
        component: () => import('@/views/finance/cash-ledger.vue'),
        meta: { title: '现金券流水', icon: 'Wallet', module: 'finance' },
      },
      {
        path: 'finance-integral',
        name: 'FinanceIntegral',
        component: () => import('@/views/finance/integral-ledger.vue'),
        meta: { title: '积分记录', icon: 'Coin', module: 'finance' },
      },
      {
        path: 'finance-recharge',
        name: 'FinanceRecharge',
        component: () => import('@/views/finance/recharge.vue'),
        meta: { title: '积分充值', icon: 'CreditCard', module: 'finance' },
      },
      {
        path: 'finance-settlement',
        name: 'FinanceSettlement',
        component: () => import('@/views/finance/settlement.vue'),
        meta: { title: '商家结算', icon: 'Money', module: 'finance' },
      },
      {
        path: 'finance-settings',
        name: 'FinanceSettings',
        component: () => import('@/views/finance/settings.vue'),
        meta: { title: '财务设置', icon: 'Setting', module: 'finance' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/layout/index.vue'),
    children: [{
      path: '',
      component: {
        template: `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:50vh;color:#8b95a5">
          <div style="font-size:64px;font-weight:700;color:#c0c4cc;margin-bottom:16px">404</div>
          <p style="font-size:15px;margin:0 0 24px">页面不存在或已移除</p>
          <el-button type="primary" @click="$router.push('/')">返回首页</el-button>
        </div>`,
      },
      meta: { title: '页面未找到' },
    }],
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach(async (to, _from, next) => {
  document.title = `${to.meta.title || '锦程数码会员电商系统'} - 管理后台`

  if (to.meta.public) return next()

  const userStore = useUserStore()
  const loggedIn = await userStore.checkSession()

  if (!loggedIn && to.path !== '/login') {
    return next('/login')
  }

  if (loggedIn && to.path === '/login') {
    return next('/')
  }

  next()
})

export default router
