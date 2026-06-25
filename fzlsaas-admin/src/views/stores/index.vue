<template>
  <PageShell title="门店管理" subtitle="独立创建与维护门店分类，供客户经理归属、名片展示等使用">
    <template #filter>
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item label="搜索">
          <el-input
            v-model="keyword"
            placeholder="按门店名称搜索"
            clearable
            style="width: 220px"
            @keyup.enter="search"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="search">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </el-form-item>
      </el-form>
    </template>

    <template #toolbar>
      <div class="toolbar-left">
        <el-button type="primary" @click="openCreate">
          <el-icon><Plus /></el-icon>
          新建门店
        </el-button>
      </div>
      <div class="toolbar-right">
        <span class="select-hint">共 {{ total }} 个门店</span>
      </div>
    </template>

    <TableSkeleton v-if="loading && !list.length" :cols="6" />
    <el-table v-else :data="list" v-loading="loading && list.length > 0" row-key="id">
      <template #empty>
        <el-empty description="暂无门店">
          <el-button type="primary" @click="openCreate">新建第一个门店</el-button>
        </el-empty>
      </template>
      <el-table-column prop="id" label="ID" width="80" />
      <el-table-column prop="name" label="门店名称" min-width="160">
        <template #default="{ row }">
          <span class="store-name">{{ row.name }}</span>
        </template>
      </el-table-column>
      <el-table-column label="客户经理" width="110" align="center">
        <template #default="{ row }">
          <el-button v-if="row.staffCount" link type="primary" @click="goStaff(row)">
            {{ row.staffCount }} 人
          </el-button>
          <span v-else class="text-muted">0 人</span>
        </template>
      </el-table-column>
      <el-table-column prop="phone" label="联系电话" width="140">
        <template #default="{ row }">{{ row.phone || '—' }}</template>
      </el-table-column>
      <el-table-column label="地址" min-width="200">
        <template #default="{ row }">{{ fullAddress(row) || '—' }}</template>
      </el-table-column>
      <el-table-column prop="dayTime" label="营业时间" width="140">
        <template #default="{ row }">{{ row.dayTime || '—' }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.isShow ? 'success' : 'info'" size="small">
            {{ row.isShow ? '启用' : '停用' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="primary" @click="toggleShow(row)">
            {{ row.isShow ? '停用' : '启用' }}
          </el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <template #footer>
      <el-pagination
        v-model:current-page="page"
        v-model:page-size="pageSize"
        :total="total"
        :page-sizes="[20, 50, 100]"
        layout="total, sizes, prev, pager, next, jumper"
        @current-change="loadList"
        @size-change="onSizeChange"
      />
    </template>
  </PageShell>

  <el-dialog
    v-model="dialogOpen"
    :title="editingId ? '编辑门店' : '新建门店'"
    width="520px"
    destroy-on-close
    @closed="resetForm"
  >
    <el-form ref="formRef" :model="form" :rules="rules" label-width="92px">
      <el-form-item label="门店名称" prop="name">
        <el-input v-model="form.name" placeholder="例如：米古里旗舰店" maxlength="80" show-word-limit />
      </el-form-item>
      <el-form-item label="联系电话" prop="phone">
        <el-input v-model="form.phone" placeholder="选填" maxlength="20" />
      </el-form-item>
      <el-form-item label="地区" prop="address">
        <el-input v-model="form.address" placeholder="选填，例如：浙江省杭州市西湖区" maxlength="255" />
      </el-form-item>
      <el-form-item label="详细地址" prop="detailedAddress">
        <el-input v-model="form.detailedAddress" placeholder="选填，门牌号等" maxlength="255" />
      </el-form-item>
      <el-form-item label="营业时间" prop="dayTime">
        <el-input v-model="form.dayTime" placeholder="选填，例如：09:00-21:00" maxlength="128" />
      </el-form-item>
      <el-form-item label="状态">
        <el-switch v-model="form.isShow" active-text="启用" inactive-text="停用" inline-prompt />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogOpen = false">取消</el-button>
      <el-button type="primary" :loading="submitting" @click="submit">
        {{ editingId ? '保存' : '创建' }}
      </el-button>
    </template>
  </el-dialog>

  <StoreDetailDrawer v-model="detailOpen" :store-id="detailStoreId" @transferred="loadList" />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage, ElMessageBox } from 'element-plus'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import StoreDetailDrawer from './components/StoreDetailDrawer.vue'

interface StoreRow {
  id: number
  name: string
  phone: string
  address: string
  detailedAddress: string
  dayTime: string
  isShow: boolean
  staffCount: number
  addTime: number
}

const router = useRouter()
const loading = ref(false)
const list = ref<StoreRow[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const keyword = ref('')

const dialogOpen = ref(false)
const editingId = ref<number | null>(null)
const submitting = ref(false)
const formRef = ref<FormInstance>()
const detailOpen = ref(false)
const detailStoreId = ref<number | null>(null)
const form = reactive({
  name: '',
  phone: '',
  address: '',
  detailedAddress: '',
  dayTime: '',
  isShow: true
})

const rules: FormRules = {
  name: [
    { required: true, message: '请输入门店名称', trigger: 'blur' },
    { max: 80, message: '门店名称不能超过 80 字', trigger: 'blur' }
  ]
}

onMounted(() => loadList())

function fullAddress(row: StoreRow) {
  return [row.address, row.detailedAddress].filter(Boolean).join(' ')
}

async function loadList() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/stores', {
      params: {
        keyword: keyword.value || undefined,
        page: page.value,
        pageSize: pageSize.value
      }
    })
    list.value = data?.list || []
    total.value = data?.total || 0
  } catch {
    list.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  loadList()
}

function resetFilters() {
  keyword.value = ''
  search()
}

function onSizeChange() {
  page.value = 1
  loadList()
}

function resetForm() {
  editingId.value = null
  form.name = ''
  form.phone = ''
  form.address = ''
  form.detailedAddress = ''
  form.dayTime = ''
  form.isShow = true
  formRef.value?.clearValidate()
}

function openCreate() {
  resetForm()
  dialogOpen.value = true
}

function openDetail(row: StoreRow) {
  detailStoreId.value = row.id
  detailOpen.value = true
}

function openEdit(row: StoreRow) {
  editingId.value = row.id
  form.name = row.name
  form.phone = row.phone
  form.address = row.address
  form.detailedAddress = row.detailedAddress
  form.dayTime = row.dayTime
  form.isShow = row.isShow
  dialogOpen.value = true
}

async function submit() {
  if (!formRef.value) return
  const valid = await formRef.value.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      address: form.address.trim(),
      detailedAddress: form.detailedAddress.trim(),
      dayTime: form.dayTime.trim(),
      isShow: form.isShow
    }
    if (editingId.value) {
      await request.put(`/api/admin/stores/${editingId.value}`, payload)
      ElMessage.success('门店已更新')
    } else {
      await request.post('/api/admin/stores', payload)
      ElMessage.success('门店已创建')
    }
    dialogOpen.value = false
    loadList()
  } catch {
    /* handled by interceptor */
  } finally {
    submitting.value = false
  }
}

async function toggleShow(row: StoreRow) {
  const next = !row.isShow
  try {
    await request.put(`/api/admin/stores/${row.id}`, {
      name: row.name,
      phone: row.phone,
      address: row.address,
      detailedAddress: row.detailedAddress,
      dayTime: row.dayTime,
      isShow: next
    })
    row.isShow = next
    ElMessage.success(next ? '门店已启用' : '门店已停用')
  } catch {
    /* handled */
  }
}

async function remove(row: StoreRow) {
  try {
    await ElMessageBox.confirm(
      row.staffCount
        ? `「${row.name}」仍有 ${row.staffCount} 名客户经理归属，需先转移后才能删除。`
        : `确认删除门店「${row.name}」？删除后不可恢复。`,
      '删除门店',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  try {
    await request.delete(`/api/admin/stores/${row.id}`)
    ElMessage.success('门店已删除')
    if (list.value.length === 1 && page.value > 1) page.value -= 1
    loadList()
  } catch {
    /* handled */
  }
}

function goStaff(row: StoreRow) {
  router.push({ path: '/staff', query: { storeName: row.name } })
}
</script>

<style scoped>
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
}
.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  font-size: 13px;
}
.select-hint {
  color: rgba(0, 0, 0, 0.45);
}
.store-name {
  font-weight: 500;
}
.text-muted {
  color: rgba(0, 0, 0, 0.25);
}
</style>
