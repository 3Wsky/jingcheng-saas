<template>
  <div ref="chartRef" class="trend-chart">
    <div v-if="!ready" class="chart-placeholder">
      <el-skeleton animated :rows="4" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  labels: string[]
  granted: number[]
  consumed: number[]
}>()

const chartRef = ref<HTMLElement | null>(null)
const ready = ref(false)

type EchartsCore = typeof import('echarts/core')
type EChartsInstance = import('echarts/core').ECharts

let echartsModule: EchartsCore | null = null
let chart: EChartsInstance | null = null
let loadPromise: Promise<EchartsCore> | null = null

async function loadEcharts() {
  if (echartsModule) return echartsModule
  if (loadPromise) return loadPromise

  loadPromise = (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import('echarts/core'),
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers')
    ])
    core.use([
      charts.LineChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      renderers.CanvasRenderer
    ])
    echartsModule = core
    return core
  })()

  return loadPromise
}

async function render() {
  if (!chartRef.value) return
  const echarts = await loadEcharts()
  ready.value = true
  if (!chart) chart = echarts.init(chartRef.value)

  const hasData = props.granted.some((v) => v > 0) || props.consumed.some((v) => v > 0)

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['积分新增', '积分消耗'], bottom: 0 },
    grid: { left: 48, right: 24, top: 24, bottom: 48 },
    xAxis: { type: 'category', data: props.labels, boundaryGap: false },
    yAxis: { type: 'value' },
    graphic: hasData ? undefined : [{
      type: 'text',
      left: 'center',
      top: 'middle',
      style: { text: '暂无趋势数据', fill: '#9CA3AF', fontSize: 14 }
    }],
    series: [
      {
        name: '积分新增',
        type: 'line',
        smooth: true,
        data: props.granted,
        itemStyle: { color: '#C9A227' },
        areaStyle: { color: 'rgba(201, 162, 39, 0.12)' }
      },
      {
        name: '积分消耗',
        type: 'line',
        smooth: true,
        data: props.consumed,
        lineStyle: { type: 'dashed' },
        itemStyle: { color: '#2D3561' }
      }
    ]
  })
}

function handleResize() {
  chart?.resize()
}

watch(() => [props.labels, props.granted, props.consumed], () => { render() }, { deep: true })

onMounted(() => {
  render()
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  chart?.dispose()
  chart = null
})
</script>

<style scoped>
.trend-chart {
  width: 100%;
  height: 320px;
  position: relative;
}
.chart-placeholder {
  position: absolute;
  inset: 0;
  padding: 24px 48px;
  box-sizing: border-box;
}
</style>
