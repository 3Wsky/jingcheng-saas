<template>
  <PageShell title="会员卡方案" subtitle="甲-1：方案在此管理，微信收款仍由 CRMEB 完成">
    <template #toolbar>
      <div class="toolbar-left">
        <el-button type="primary" @click="openCreate">新建方案</el-button>
        <el-button @click="load">刷新</el-button>
      </div>
    </template>

    <el-alert
      type="info"
      :closable="false"
      show-icon
      class="tip"
      title="说明：此处维护 199/299 等付费会员卡的名称、价格、有效期、开卡赠积分。「关联 CRMEB 会员卡 ID」用于小程序下单收款（路径甲-1），每张卡仅能绑定一个方案。停用后小程序将不再展示该方案。"
    />

    <el-table :data="list" v-loading="loading" row-key="id" border>
      <template #empty>
        <el-empty description="暂无会员卡方案">
          <el-button type="primary" @click="openCreate">新建方案</el-button>
        </el-empty>
      </template>
      <el-table-column prop="tierCode" label="档位代码" width="100" />
      <el-table-column prop="title" label="方案名称" min-width="160" />
      <el-table-column label="价格" width="100" align="right">
        <template #default="{ row }">¥{{ row.price }}</template>
      </el-table-column>
      <el-table-column label="有效期" width="90" align="center">
        <template #default="{ row }">{{ row.vipDays }} 天</template>
      </el-table-column>
      <el-table-column label="开卡赠积分" width="130" align="right">
        <template #default="{ row }">
          {{ row.giftIntegral }}
          <div class="sub-info">≈{{ (row.giftIntegral / 1000).toFixed(0) }} 元</div>
        </template>
      </el-table-column>
      <el-table-column label="关联CRMEB卡" width="120" align="center">
        <template #default="{ row }">
          <span v-if="row.memberShipId">#{{ row.memberShipId }}</span>
          <el-tag v-else type="warning" size="small">未关联</el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="tierRank" label="档位等级" width="90" align="center" />
      <el-table-column prop="sort" label="排序" width="70" align="center" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-switch v-model="row.isActive" @change="(v: boolean) => toggleActive(row, v)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right" align="center">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="removePlan(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
  </PageShell>

  <el-dialog v-model="dialogOpen" :title="form.id ? '编辑会员卡方案' : '新建会员卡方案'" width="520px">
    <el-form :model="form" label-width="120px">
      <el-form-item label="档位代码" required>
        <el-input v-model="form.tierCode" placeholder="如 SW199 / SW299" :disabled="!!form.id" />
        <div class="field-hint">唯一标识，建立后不可修改；小程序与赠送逻辑依据此码</div>
      </el-form-item>
      <el-form-item label="方案名称" required>
        <el-input v-model="form.title" placeholder="如 锦程199会员" />
      </el-form-item>
      <el-form-item label="价格(元)" required>
        <el-input-number v-model="form.price" :min="0" :precision="2" />
      </el-form-item>
      <el-form-item label="有效期(天)" required>
        <el-input-number v-model="form.vipDays" :min="0" :max="36500" />
      </el-form-item>
      <el-form-item label="开卡赠积分">
        <el-input-number v-model="form.giftIntegral" :min="0" :step="1000" />
        <div class="field-hint">原始积分值（1 元 = 1000 积分），如 199 元赠 199000</div>
      </el-form-item>
      <el-form-item label="关联CRMEB卡ID">
        <el-input-number v-model="form.memberShipId" :min="0" />
        <div class="field-hint">小程序下单收款用（甲-1）；每张卡仅能绑定一个方案，0 表示暂不关联</div>
      </el-form-item>
      <el-form-item label="档位等级">
        <el-input-number v-model="form.tierRank" :min="0" :max="255" />
        <div class="field-hint">数值越大等级越高（取高不降级），SW199=1，SW299=2</div>
      </el-form-item>
      <el-form-item label="排序">
        <el-input-number v-model="form.sort" />
        <div class="field-hint">数值越大越靠前</div>
      </el-form-item>
      <el-form-item label="启用">
        <el-switch v-model="form.isActive" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="dialogOpen = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'

interface Plan {
  id: number
  tierCode: string
  title: string
  price: number
  vipDays: number
  giftIntegral: number
  memberShipId: number
  tierRank: number
  sort: number
  isActive: boolean
}

const loading = ref(false)
const saving = ref(false)
const list = ref<Plan[]>([])
const dialogOpen = ref(false)

function emptyForm(): Plan {
  return {
    id: 0,
    tierCode: '',
    title: '',
    price: 0,
    vipDays: 365,
    giftIntegral: 0,
    memberShipId: 0,
    tierRank: 1,
    sort: 0,
    isActive: true,
  }
}

const form = ref<Plan>(emptyForm())

onMounted(load)

async function load() {
  loading.value = true
  try {
    list.value = await request.get('/api/admin/membership/plans')
  } catch {
    list.value = []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  form.value = emptyForm()
  dialogOpen.value = true
}

function openEdit(row: Plan) {
  form.value = { ...row }
  dialogOpen.value = true
}

async function save() {
  if (!form.value.tierCode?.trim()) {
    ElMessage.warning('请填写档位代码')
    return
  }
  if (!form.value.title?.trim()) {
    ElMessage.warning('请填写方案名称')
    return
  }
  saving.value = true
  try {
    const payload = {
      tierCode: form.value.tierCode.trim().toUpperCase(),
      title: form.value.title.trim(),
      price: form.value.price,
      vipDays: form.value.vipDays,
      giftIntegral: form.value.giftIntegral,
      memberShipId: form.value.memberShipId,
      tierRank: form.value.tierRank,
      sort: form.value.sort,
      isActive: form.value.isActive,
    }
    if (form.value.id) {
      await request.put(`/api/admin/membership/plans/${form.value.id}`, payload)
      ElMessage.success('方案已更新')
    } else {
      await request.post('/api/admin/membership/plans', payload)
      ElMessage.success('方案已创建')
    }
    dialogOpen.value = false
    load()
  } catch { /* handled */ }
  finally { saving.value = false }
}

async function toggleActive(row: Plan, value: boolean) {
  try {
    await request.put(`/api/admin/membership/plans/${row.id}`, { isActive: value })
    ElMessage.success(value ? '已启用' : '已停用')
  } catch {
    row.isActive = !value
  }
}

async function removePlan(row: Plan) {
  try {
    await ElMessageBox.confirm(`确认删除方案「${row.title}」(${row.tierCode})？删除后小程序将不再展示。`, '删除确认', { type: 'warning' })
  } catch {
    return
  }
  try {
    await request.delete(`/api/admin/membership/plans/${row.id}`)
    ElMessage.success('方案已删除')
    load()
  } catch { /* handled */ }
}
</script>

<style scoped>
.toolbar-left { display: flex; gap: 8px; }
.tip { margin-bottom: 12px; }
.sub-info { font-size: 12px; color: rgba(0,0,0,0.45); }
.field-hint { font-size: 12px; color: rgba(0,0,0,0.45); line-height: 1.4; margin-top: 2px; }
</style>
