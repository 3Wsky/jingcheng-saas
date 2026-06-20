<template>
  <el-dialog v-model="visible" title="选择商品" width="900px" destroy-on-close @open="load">
    <el-form :inline="true" @submit.prevent="search">
      <el-form-item label="搜索">
        <el-input v-model="keyword" placeholder="名称/ID" clearable style="width: 220px" />
      </el-form-item>
      <el-form-item>
        <el-button type="primary" @click="search">查询</el-button>
      </el-form-item>
    </el-form>
    <el-table :data="list" v-loading="loading" height="420" highlight-current-row @row-click="pick">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column label="图片" width="72">
        <template #default="{ row }">
          <el-image v-if="row.image" :src="row.image" style="width:40px;height:40px" fit="cover" />
        </template>
      </el-table-column>
      <el-table-column prop="storeName" label="商品名称" min-width="180" />
      <el-table-column label="规格" width="80">
        <template #default="{ row }">{{ row.specType ? '多规格' : '单规格' }}</template>
      </el-table-column>
      <el-table-column label="售价" width="100" align="right">
        <template #default="{ row }">¥{{ row.price }}</template>
      </el-table-column>
      <el-table-column prop="stock" label="库存" width="80" align="right" />
      <el-table-column label="操作" width="80" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click.stop="pick(row)">选择</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        @current-change="load"
      />
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import request from '@/utils/request'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [boolean]; select: [any] }>()

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const loading = ref(false)
const list = ref<any[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const keyword = ref('')

async function load() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/crmeb-products', {
      params: { page: page.value, pageSize, keyword: keyword.value || undefined }
    })
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  load()
}

async function pick(row: any) {
  try {
    const detail = await request.get(`/api/admin/crmeb-products/${row.id}`)
    emit('select', detail)
    visible.value = false
  } catch { /* handled */ }
}
</script>

<style scoped>
.pager { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
