export type MenuModule = 'workspace' | 'member' | 'integral' | 'merchant' | 'settings'

export interface MenuModuleConfig {
  key: MenuModule
  label: string
  routes: string[]
}

/** 5 Tab 业务域分组（方案 A，2026-06-21 PM 确认） */
export const MENU_MODULES: MenuModuleConfig[] = [
  { key: 'workspace', label: '工作台', routes: ['dashboard', 'approval'] },
  { key: 'member', label: '会员', routes: ['members', 'staff'] },
  {
    key: 'integral',
    label: '积分',
    routes: ['integral-mall', 'integral-mall/orders', 'finance-integral', 'finance-recharge'],
  },
  { key: 'merchant', label: '商家', routes: ['merchant', 'finance-settlement'] },
  {
    key: 'settings',
    label: '设置',
    routes: ['products', 'finance-cash', 'lottery', 'finance-settings', 'audit-logs', 'system-settings'],
  },
]

export function getModuleByRoute(path: string): MenuModule {
  const normalized = path.replace(/^\//, '')
  for (const mod of MENU_MODULES) {
    if (mod.routes.some(r => normalized === r || normalized.startsWith(`${r}/`))) {
      return mod.key
    }
  }
  return 'workspace'
}
