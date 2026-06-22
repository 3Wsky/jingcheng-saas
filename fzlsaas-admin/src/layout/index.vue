<template>
  <div class="app-layout">
    <header class="topbar">
      <div class="topbar-left">
        <span class="logo-mark">锦</span>
        <div class="logo-text">
          <span class="logo-title">锦程数码会员电商系统</span>
        </div>
      </div>

      <nav class="topbar-nav">
        <button
          v-for="mod in MENU_MODULES"
          :key="mod.key"
          class="nav-tab"
          :class="{ active: activeModule === mod.key }"
          @click="switchModule(mod.key)"
        >
          {{ mod.label }}
        </button>
      </nav>

      <div class="topbar-right">
        <el-tooltip content="刷新"><el-button link @click="refreshPage"><el-icon><Refresh /></el-icon></el-button></el-tooltip>
        <el-dropdown>
          <span class="user-info">
            <el-icon><UserFilled /></el-icon>
            {{ userStore.username || 'Admin' }}
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="handleLogout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <div class="app-body">
      <aside class="sidebar" :class="{ collapsed: isCollapse }">
        <div class="sidebar-head">
          <span v-if="!isCollapse" class="sidebar-module">{{ currentModuleLabel }}</span>
          <div class="sidebar-toggle" @click="isCollapse = !isCollapse">
            <el-icon><Fold v-if="!isCollapse" /><Expand v-else /></el-icon>
          </div>
        </div>
        <el-menu
          :default-active="route.path"
          :collapse="isCollapse"
          router
          class="side-menu"
        >
          <el-menu-item v-for="item in sideMenuItems" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ item.title }}</template>
          </el-menu-item>
        </el-menu>
      </aside>

      <div class="content-wrap">
        <main class="main-content">
          <router-view :key="route.fullPath" />
        </main>
        <footer class="app-footer">锦程数码会员电商系统 · 2026</footer>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { MENU_MODULES, getModuleByRoute, type MenuModule } from '@/config/menu'

const route = useRoute()
const router = useRouter()
const userStore = useUserStore()
const isCollapse = ref(false)
const activeModule = ref<MenuModule>(getModuleByRoute(route.path))

watch(() => route.path, (p) => {
  activeModule.value = getModuleByRoute(p)
})

const currentModuleLabel = computed(() => {
  return MENU_MODULES.find(m => m.key === activeModule.value)?.label || '菜单'
})

const allRoutes = computed(() => {
  return router.options.routes.find(r => r.path === '/')?.children?.filter(c => !c.meta?.hidden) || []
})

const sideMenuItems = computed(() => {
  const mod = MENU_MODULES.find(m => m.key === activeModule.value)
  if (!mod) return []
  return mod.routes.map(name => {
    const r = allRoutes.value.find(c => c.path === name)
    return {
      path: '/' + name,
      title: (r?.meta?.title as string) || name,
      icon: (r?.meta?.icon as string) || 'Document',
    }
  })
})

function switchModule(key: MenuModule) {
  const mod = MENU_MODULES.find(m => m.key === key)
  if (!mod?.routes[0]) return
  activeModule.value = key
  const target = '/' + mod.routes[0]
  if (route.path === target || route.path.startsWith(target + '/')) return
  router.push(target).catch(() => {})
}

function refreshPage() {
  router.go(0)
}

function handleLogout() {
  userStore.logout()
  router.push('/login')
}
</script>

<style scoped>
.app-layout {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶栏：大厂高端政企深邃蓝 + 扁平化横向 Tab */
.topbar {
  height: 64px; /* 标准 64px 高度，更显精致 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--crmeb-topbar-gradient);
  color: #fff;
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.15);
  position: relative;
  z-index: 10;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  width: 240px;
}

.logo-mark {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: linear-gradient(135deg, var(--gov-primary), #1a66ec);
  border: 1px solid rgba(255, 255, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  color: #fff;
}

.logo-text {
  display: flex;
  flex-direction: column;
}

.logo-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #ffffff;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-nav {
  flex: 1;
  display: flex;
  align-items: center;
  height: 100%;
  margin-left: 24px;
  overflow-x: auto;
  scrollbar-width: none;
}

.topbar-nav::-webkit-scrollbar {
  display: none;
}

/* 顶栏 Tab：大厂控制台扁平化设计 */
.nav-tab {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.8);
  font-size: 14px;
  font-weight: 500;
  padding: 0 20px;
  height: 64px;
  line-height: 64px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  position: relative;
}

.nav-tab:hover {
  color: #ffffff;
  background: rgba(255, 255, 255, 0.05);
}

.nav-tab.active {
  color: #ffffff;
  font-weight: 600;
  background: rgba(255, 255, 255, 0.08);
}

.nav-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 16px;
  right: 16px;
  height: 3px;
  background-color: #ffffff;
  border-radius: 1.5px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-shrink: 0;
}

.topbar-right :deep(.el-button) {
  color: rgba(255, 255, 255, 0.85);
}

.topbar-right :deep(.el-button):hover {
  color: #ffffff;
}

.user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: rgba(255, 255, 255, 0.9);
  padding: 4px 10px;
  border-radius: var(--gov-radius);
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.05);
  transition: all 0.2s;
}

.user-info:hover {
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 侧栏：极简白底 + 大厂专业激活态 */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--gov-bg-card);
  border-right: 1px solid var(--gov-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s cubic-bezier(0.34, 0.69, 0.1, 1);
}

.sidebar.collapsed {
  width: 64px;
}

.sidebar-head {
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid var(--gov-border);
  background: #f7f8fa;
}

.sidebar-module {
  font-size: 12px;
  font-weight: 600;
  color: var(--gov-text-secondary);
  letter-spacing: 0.5px;
}

.sidebar-toggle {
  cursor: pointer;
  color: var(--gov-text-muted);
  display: flex;
  align-items: center;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s;
}

.sidebar-toggle:hover {
  background: rgba(0, 0, 0, 0.05);
  color: var(--gov-text-primary);
}

.side-menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
  padding: 12px 0;
  background: var(--gov-bg-card);
}

.side-menu :deep(.el-menu-item) {
  height: 40px;
  line-height: 40px;
  margin: 4px 12px;
  border-radius: var(--gov-radius);
  color: var(--gov-text-secondary);
  font-size: 13px;
  transition: all 0.2s ease;
}

.side-menu :deep(.el-menu-item:hover) {
  color: var(--gov-primary);
  background: var(--gov-bg-page);
}

.side-menu :deep(.el-menu-item.is-active) {
  color: var(--gov-primary) !important;
  background: var(--gov-primary-light) !important;
  font-weight: 600;
}

.side-menu :deep(.el-menu-item.is-active .el-icon) {
  color: var(--gov-primary) !important;
}

.content-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.main-content {
  flex: 1;
  overflow: auto;
  background: var(--gov-bg-page);
  padding: 20px 24px;
}

.app-footer {
  flex-shrink: 0;
  height: 36px;
  line-height: 36px;
  text-align: center;
  font-size: 12px;
  color: var(--gov-text-muted);
  background: var(--gov-bg-card);
  border-top: 1px solid var(--gov-border);
}
</style>
