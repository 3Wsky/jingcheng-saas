<template>
  <PageShell
    title="广告页设置"
    subtitle="配置现金券推广页领取后弹出的客户经理名片，系统严格按列表顺序循环展示。"
  >
    <template #actions>
      <el-button type="primary" :loading="saving" @click="saveConfig">保存配置</el-button>
    </template>

    <el-alert type="info" :closable="false" show-icon class="rotation-alert">
      <template #title>
        当前顺序：{{ rotationSummary }}。例如配置 4 人，访客领取时会按 1 → 2 → 3 → 4 → 1 循环。
      </template>
    </el-alert>

    <div class="config-grid" v-loading="loading">
      <section class="manager-panel">
        <div class="panel-head">
          <div>
            <h3>轮询队列</h3>
            <p>只有已发布名片的客户经理才能在小程序正常展示。</p>
          </div>
          <el-tag type="success">{{ selectedManagers.length }} 人</el-tag>
        </div>

        <el-empty v-if="!selectedManagers.length" description="还没有选择客户经理" :image-size="76" />
        <div v-else class="selected-list">
          <div v-for="(manager, index) in selectedManagers" :key="manager.uid" class="selected-item">
            <span class="sequence">{{ index + 1 }}</span>
            <div class="manager-copy">
              <strong>{{ manager.nickname || `UID ${manager.uid}` }}</strong>
              <span>UID {{ manager.uid }} · {{ manager.divisionName || '未分配门店' }}</span>
            </div>
            <el-tag size="small" :type="manager.cardConfigured ? 'success' : 'warning'">
              {{ manager.cardConfigured ? '名片已配置' : '名片待完善' }}
            </el-tag>
            <div class="row-actions">
              <el-button text :disabled="index === 0" @click="move(index, -1)">上移</el-button>
              <el-button text :disabled="index === selectedManagers.length - 1" @click="move(index, 1)">下移</el-button>
              <el-button text type="danger" @click="remove(manager.uid)">移除</el-button>
            </div>
          </div>
        </div>
      </section>

      <section class="manager-panel">
        <div class="panel-head">
          <div>
            <h3>可选客户经理</h3>
            <p>点击加入后，可在左侧调整实际轮询顺序。</p>
          </div>
          <el-input v-model="keyword" clearable placeholder="搜索姓名、UID、门店" style="width: 220px" />
        </div>

        <el-table :data="availableManagers" size="small" max-height="520">
          <el-table-column prop="uid" label="UID" width="78" />
          <el-table-column label="客户经理" min-width="130">
            <template #default="{ row }">
              <div class="table-name">{{ row.nickname || '未设置昵称' }}</div>
              <div class="table-meta">{{ row.divisionName || '未分配门店' }}</div>
            </template>
          </el-table-column>
          <el-table-column label="名片" width="105">
            <template #default="{ row }">
              <el-tag size="small" :type="row.cardConfigured ? 'success' : 'warning'">
                {{ row.cardConfigured ? '已配置' : '待完善' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="84" align="right">
            <template #default="{ row }">
              <el-button link type="primary" @click="add(row.uid)">加入</el-button>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </div>
  </PageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import request from '@/utils/request'

const loading = ref(false)
const saving = ref(false)
const managers = ref<any[]>([])
const selectedUids = ref<number[]>([])
const keyword = ref('')

const managerMap = computed(() => new Map(managers.value.map(item => [Number(item.uid), item])))
const selectedManagers = computed(() => selectedUids.value.map(uid => managerMap.value.get(uid) || { uid }))
const availableManagers = computed(() => {
  const selected = new Set(selectedUids.value)
  const key = keyword.value.trim().toLowerCase()
  return managers.value.filter(item => {
    if (selected.has(Number(item.uid))) return false
    if (!key) return true
    return [item.uid, item.nickname, item.divisionName].join(' ').toLowerCase().includes(key)
  })
})
const rotationSummary = computed(() => selectedManagers.value.length
  ? selectedManagers.value.map((item, index) => `${index + 1}. ${item.nickname || `UID ${item.uid}`}`).join(' → ')
  : '未配置，将显示锦程数码默认门店信息')

onMounted(loadData)

async function loadData() {
  loading.value = true
  try {
    const [config, staff] = await Promise.all([
      request.get('/api/admin/landing/coupon'),
      request.get('/api/admin/staff/list', { params: { page: 1, pageSize: 100 } })
    ])
    managers.value = staff?.list || []
    selectedUids.value = Array.isArray(config?.managerUids) ? config.managerUids.map(Number) : []
  } finally {
    loading.value = false
  }
}

function add(uid: number) {
  if (!selectedUids.value.includes(uid)) selectedUids.value.push(uid)
}

function remove(uid: number) {
  selectedUids.value = selectedUids.value.filter(item => item !== uid)
}

function move(index: number, offset: number) {
  const target = index + offset
  if (target < 0 || target >= selectedUids.value.length) return
  const next = [...selectedUids.value]
  ;[next[index], next[target]] = [next[target], next[index]]
  selectedUids.value = next
}

async function saveConfig() {
  saving.value = true
  try {
    await request.put('/api/admin/landing/coupon', { managerUids: selectedUids.value })
    ElMessage.success('广告页轮询顺序已保存，将从第 1 位重新开始')
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.rotation-alert { margin-bottom: 18px; }
.config-grid { display: grid; grid-template-columns: minmax(420px, 1fr) minmax(420px, 1fr); gap: 18px; }
.manager-panel { min-width: 0; border: 1px solid var(--gov-border); border-radius: 6px; background: #fff; padding: 18px; }
.panel-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.panel-head h3 { margin: 0; font-size: 15px; color: var(--gov-text-primary); }
.panel-head p { margin: 5px 0 0; color: var(--gov-text-secondary); font-size: 12px; line-height: 18px; }
.selected-list { display: flex; flex-direction: column; gap: 10px; }
.selected-item { min-height: 66px; display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fafbfc; }
.sequence { width: 30px; height: 30px; flex: 0 0 30px; display: grid; place-items: center; border-radius: 50%; background: #d92d20; color: #fff; font-weight: 700; }
.manager-copy { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.manager-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.manager-copy span, .table-meta { color: #8b95a5; font-size: 12px; }
.row-actions { display: flex; flex-shrink: 0; }
.table-name { color: #1f2937; font-weight: 500; }
@media (max-width: 1100px) { .config-grid { grid-template-columns: 1fr; } }
</style>
