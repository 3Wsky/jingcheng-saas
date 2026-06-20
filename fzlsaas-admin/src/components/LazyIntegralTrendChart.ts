import { defineAsyncComponent, h } from 'vue'
import { ElSkeleton } from 'element-plus'

/** 按需加载 ECharts 趋势图，避免打进非看板路由 */
export default defineAsyncComponent({
  loader: () => import('./IntegralTrendChart.vue'),
  loadingComponent: {
    render: () => h('div', { style: 'height:320px;padding:24px 48px' }, [
      h(ElSkeleton, { rows: 4, animated: true })
    ])
  },
  delay: 120,
  timeout: 30000
})
