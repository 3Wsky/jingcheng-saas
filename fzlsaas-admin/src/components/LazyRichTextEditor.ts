import { defineAsyncComponent, h } from 'vue'
import { ElSkeleton } from 'element-plus'

/** 按需加载 WangEditor，避免打进首屏/列表页主包 */
export default defineAsyncComponent({
  loader: () => import('./RichTextEditor.vue'),
  loadingComponent: {
    render: () => h('div', { class: 'rte-loading' }, [
      h(ElSkeleton, { rows: 6, animated: true })
    ])
  },
  delay: 120,
  timeout: 30000
})
