export type MenuModule = 'data' | 'member' | 'ops' | 'merchant' | 'finance' | 'system'

export interface MenuModuleConfig {
  key: MenuModule
  label: string
  routes: string[]
}

export const MENU_MODULES: MenuModuleConfig[] = [
  { key: 'data', label: '数据', routes: ['dashboard'] },
  { key: 'member', label: '会员', routes: ['members', 'staff'] },
  { key: 'ops', label: '运营', routes: ['approval', 'integral-mall', 'integral-mall/orders', 'lottery'] },
  { key: 'merchant', label: '商家', routes: ['merchant', 'products'] },
  {
    key: 'finance',
    label: '财务',
    routes: ['finance-cash', 'finance-integral', 'finance-recharge', 'finance-settlement', 'finance-settings'],
  },
  { key: 'system', label: '系统', routes: ['audit-logs', 'system-settings'] },
]

export function getModuleByRoute(path: string): MenuModule {
  const name = path.replace(/^\//, '').split('/')[0] || 'dashboard'
  for (const mod of MENU_MODULES) {
    if (mod.routes.includes(name)) return mod.key
  }
  return 'data'
}
