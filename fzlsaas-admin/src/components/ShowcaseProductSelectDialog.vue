<template>
  <el-dialog v-model="visible" title="选择已上架展示商品" width="920px" destroy-on-close @open="load">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">
      可选：从已上架展示商品快速导入信息。如需独立上架，请在编辑页选择「手动创建」。
    </el-alert>
    <el-form :inline="true" @submit.prevent="search">
      <el-form-item label="品牌">
        <el-select v-model="brand" clearable placeholder="全部品牌" style="width: 140px" @change="search">
          <el-option v-for="b in brandOptions" :key="b" :label="b" :value="b" />
        </el-select>
      </el-form-item>
      <el-form-item label="搜索">
        <el-input v-model="keyword" placeholder="名称/ID" clearable style="width: 220px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="list" v-loading="loading" height="420" highlight-current-row @row-click="pick">
      <el-table-column prop="id" label="展示ID" width="100" show-overflow-tooltip />
      <el-table-column label="图片" width="72">
        <template #default="{ row }">
          <el-image v-if="row.image" :src="row.image" style="width:40px;height:40px" fit="cover" />
        </template>
      </el-table-column>
      <el-table-column prop="brand" label="品牌" width="80" />
      <el-table-column prop="storeName" label="商品名称" min-width="180" show-overflow-tooltip />
      <el-table-column label="售价" width="100" align="right">
        <template #default="{ row }">¥{{ row.price }}</template>
      </el-table-column>
      <el-table-column label="CRMEB" width="80" align="center">
        <template #default="{ row }">{{ row.crmebId || '-' }}</template>
      </el-table-column>
      <el-table-column label="操作" width="80" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="pick(row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
    <p class="hint">共 {{ total }} 件已上架展示商品</p>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const BRAND_OPTIONS = ['华为', '荣耀', '小米', 'iQOO', 'vivo', 'OPPO', 'Apple', 'DJI', '数码']

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; select: [any] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const keyword = ref('')
const brand = ref('')
const brandOptions = ref<string[]>([...BRAND_OPTIONS])

async function load() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/products', {
      params: {
        status: 'shown',
        keyword: keyword.value || undefined,
        brand: brand.value || undefined
      }
    })
    list.value = data?.list || []
    total.value = data?.total || list.value.length
    const fromApi = data?.summary?.brandList
    if (Array.isArray(fromApi) && fromApi.length) {
      brandOptions.value = fromApi
    }
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  load()
}

async function pick(row: any) {
  try {
    const detail = await request.get(`/api/admin/products/${row.id}`)
    if (!detail?.isShow) {
      ElMessage.warning('该展示商品未上架，无法选择')
      return
    }
    emit('select', detail)
    visible.value = false
  } catch { /* handled */ }
}
</script>

<style scoped>
.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 8px; }
</style>
