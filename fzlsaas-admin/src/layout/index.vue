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
        <div class="nav-pill">
          <button
            v-for="mod in MENU_MODULES"
            :key="mod.key"
            class="nav-tab"
            :class="{ active: activeModule === mod.key }"
            @click="switchModule(mod.key)"
          >
            {{ mod.label }}
          </button>
        </div>
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
        <footer class="app-footer">锦程数码</footer>
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

/* 顶栏：渐变色 + 中间圆角胶囊 Tab */
.topbar {
  height: 72px; /* 顶部菜单栏更宽一点 */
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 24px;
  background: var(--crmeb-topbar-gradient);
  color: #fff;
  box-shadow: 0 4px 16px rgba(26, 31, 54, 0.25);
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 1;
  min-width: 0;
  max-width: 220px;
}
.logo-mark {
  width: 36px;
  height: 36px;
  border-radius: 8px;
  background: linear-gradient(135deg, var(--sw-gold), var(--sw-gold-dark));
  border: 1px solid rgba(255, 255, 255, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 17px;
  font-weight: 700;
}
.logo-title {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.topbar-nav {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  min-width: 0;
  padding: 0 16px;
  position: relative;
  z-index: 2;
  overflow: hidden;
}
.nav-pill {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.22);
  backdrop-filter: blur(6px);
  max-width: 100%;
  overflow-x: auto;
  scrollbar-width: none;
}
.nav-pill::-webkit-scrollbar { display: none; }
.nav-tab {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  padding: 0 16px;
  height: 36px;
  line-height: 36px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.22s ease;
  white-space: nowrap;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.nav-tab:hover {
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
}
.nav-tab.active {
  color: var(--sw-dark);
  background: #fff;
  font-weight: 600;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  min-width: 100px;
  justify-content: flex-end;
  position: relative;
  z-index: 1;
}
.topbar-right :deep(.el-button) { color: rgba(255, 255, 255, 0.9); }
.user-info {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
}
.user-info:hover { background: rgba(255, 255, 255, 0.12); }

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 侧栏：白底 + 金色激活态 */
.sidebar {
  width: 200px;
  flex-shrink: 0;
  background: var(--sw-bg-card);
  border-right: 1px solid var(--sw-border);
  display: flex;
  flex-direction: column;
  transition: width 0.2s;
}
.sidebar.collapsed { width: 64px; }
.sidebar-head {
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px 0 16px;
  border-bottom: 1px solid #f0f0f0;
  background: #fafafa;
}
.sidebar-module {
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.sidebar-toggle {
  cursor: pointer;
  color: #999;
  display: flex;
  align-items: center;
}
.side-menu {
  border-right: none;
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.side-menu :deep(.el-menu-item) {
  height: 44px;
  line-height: 44px;
  margin: 2px 8px;
  border-radius: 4px;
  color: #595959;
}
.side-menu :deep(.el-menu-item:hover) {
  color: var(--sw-gold-dark);
  background: var(--sw-gold-soft);
}
.side-menu :deep(.el-menu-item.is-active) {
  color: var(--sw-gold-dark);
  background: var(--sw-gold-soft);
  font-weight: 600;
  border-right: 3px solid var(--sw-gold);
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
  background: var(--sw-bg-page);
  padding: 16px 20px;
}
.app-footer {
  flex-shrink: 0;
  height: 32px;
  line-height: 32px;
  text-align: center;
  font-size: 12px;
  color: #bfbfbf;
  background: #fafafa;
  border-top: 1px solid #e8e8e8;
}
</style>
