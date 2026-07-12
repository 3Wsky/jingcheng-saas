export type MenuModule = 'workspace' | 'member' | 'integral' | 'merchant' | 'finance' | 'operation' | 'settings'

export interface MenuModuleConfig {
  key: MenuModule
  label: string
  routes: string[]
}

/** 7 Tab 业务域分组（2026-06-29 重组：财务/运营独立，审批去重） */
export const MENU_MODULES: MenuModuleConfig[] = [
  { key: 'workspace', label: '工作台', routes: ['dashboard', 'approval'] },
  { key: 'member', label: '会员', routes: ['members', 'membership-plans', 'staff', 'stores'] },
  {
    key: 'integral',
    label: '商品',
    routes: ['products', 'integral-mall', 'integral-mall/orders', 'sn-catalog'],
  },
  { key: 'merchant', label: '商家', routes: ['merchant'] },
  {
    key: 'finance',
    label: '财务',
    routes: ['finance-cash', 'finance-integral', 'finance-recharge', 'finance-settlement', 'finance-settings'],
  },
  { key: 'operation', label: '运营', routes: ['lottery', 'homepage-banners', 'content', 'share-config'] },
  {
    key: 'settings',
    label: '系统',
    routes: ['system-settings', 'audit-logs'],
  },
]

export function getModuleByRoute(path: string): MenuModule {
  const normalized = path.replace(/^\//, '')
  // 长路径优先匹配，避免 integral-mall 误匹配 integral-mall/orders
  const entries = MENU_MODULES.flatMap((mod) =>
    mod.routes.map((r) => ({ mod: mod.key, route: r }))
  ).sort((a, b) => b.route.length - a.route.length)

  for (const { mod, route: r } of entries) {
    if (normalized === r || normalized.startsWith(`${r}/`)) {
      return mod
    }
  }
  return 'workspace'
}
