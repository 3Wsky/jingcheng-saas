import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import { resolve } from 'path'

export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? '/fzlsaas/' : '/',
  plugins: [
    vue(),
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/uploads': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/admin': { target: 'http://127.0.0.1:8787', changeOrigin: true },
      '/health': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // 按依赖拆分独立 vendor 包：主包变小 + vendor 独立长缓存（业务改动不影响 vendor hash）
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('@wangeditor') || id.includes('wangeditor')) return 'wangeditor'
          if (id.includes('echarts') || id.includes('zrender')) return 'echarts'
          if (id.includes('@element-plus/icons-vue')) return 'el-icons'
          if (id.includes('element-plus')) return 'element-plus'
          if (
            id.includes('/vue/') ||
            id.includes('/@vue/') ||
            id.includes('/vue-router/') ||
            id.includes('/pinia/') ||
            id.includes('/vue-demi/')
          ) return 'vue-vendor'
          if (id.includes('/axios/')) return 'axios'
          return 'vendor'
        },
      },
    },
  },
}))
