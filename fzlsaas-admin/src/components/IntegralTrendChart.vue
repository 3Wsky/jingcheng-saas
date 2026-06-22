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
    tooltip: { 
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#e5e6eb',
      borderWidth: 1,
      textStyle: { color: '#1d2129', fontSize: 13 },
      shadowColor: 'rgba(0, 0, 0, 0.05)',
      shadowBlur: 10
    },
    legend: { 
      data: ['积分新增', '积分消耗'], 
      bottom: 0,
      icon: 'rect',
      itemWidth: 12,
      itemHeight: 4,
      textStyle: { color: '#4e5969', fontSize: 12 }
    },
    grid: { left: 48, right: 24, top: 24, bottom: 48 },
    xAxis: { 
      type: 'category', 
      data: props.labels, 
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#e5e6eb' } },
      axisLabel: { color: '#86909c', fontSize: 12 }
    },
    yAxis: { 
      type: 'value',
      splitLine: { lineStyle: { color: '#f2f3f5', type: 'dashed' } },
      axisLabel: { color: '#86909c', fontSize: 12 }
    },
    graphic: hasData ? undefined : [{
      type: 'text',
      left: 'center',
      top: 'middle',
      style: { text: '暂无趋势数据', fill: '#86909c', fontSize: 14 }
    }],
    series: [
      {
        name: '积分新增',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.granted,
        itemStyle: { color: '#0052D9' },
        lineStyle: { width: 2.5 },
        areaStyle: { 
          color: {
            type: 'linear',
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: 'rgba(0, 82, 217, 0.15)' },
              { offset: 1, color: 'rgba(0, 82, 217, 0.01)' }
            ]
          }
        }
      },
      {
        name: '积分消耗',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: props.consumed,
        lineStyle: { type: 'dashed', width: 2 },
        itemStyle: { color: '#ed7b2f' }
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
