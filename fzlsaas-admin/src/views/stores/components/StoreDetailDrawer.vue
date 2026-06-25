<template>
  <el-drawer v-model="visible" :title="`门店详情 · ${store?.name || ''}`" size="600px" destroy-on-close>
    <div v-loading="loading">
      <div class="detail-header">
        <div class="header-main">
          <div class="store-title">{{ store?.name || '—' }}</div>
          <div class="store-sub">门店 ID #{{ store?.id || '—' }} · 归属客户经理 {{ staffList.length }} 人</div>
        </div>
        <el-button
          type="primary"
          :disabled="!selectedRows.length"
          @click="openTransfer(selectedRows.map((r) => r.uid))"
        >
          批量转移（{{ selectedRows.length }}）
        </el-button>
      </div>

      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="把客户经理转移到其它门店后，本门店人数会减少；清空后即可删除该门店。"
        style="margin-bottom: 12px"
      />

      <el-table
        ref="tableRef"
        :data="staffList"
        size="small"
        max-height="460"
        row-key="uid"
        @selection-change="onSelect"
      >
        <template #empty>
          <el-empty description="该门店暂无客户经理" :image-size="80" />
        </template>
        <el-table-column type="selection" width="44" />
        <el-table-column prop="uid" label="UID" width="80" />
        <el-table-column prop="nickname" label="姓名" min-width="120">
          <template #default="{ row }">{{ row.nickname || '—' }}</template>
        </el-table-column>
        <el-table-column prop="phone" label="手机" width="130" />
        <el-table-column prop="memberCount" label="名下会员" width="90" align="center" />
        <el-table-column label="操作" width="90" fixed="right" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="openTransfer([row.uid])">转移</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </el-drawer>

  <el-dialog v-model="transferOpen" title="转移客户经理" width="440px" append-to-body destroy-on-close>
    <p class="transfer-tip">
      将选中的 <strong>{{ transferUids.length }}</strong> 名客户经理从「{{ store?.name }}」转移到：
    </p>
    <StoreNameSelect v-model="targetStoreName" placeholder="选择或输入目标门店名称" />
    <template #footer>
      <el-button @click="transferOpen = false">取消</el-button>
      <el-button type="primary" :loading="transferring" @click="confirmTransfer">确认转移</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TableInstance } from 'element-plus'
import { ElMessage } from 'element-plus'
import request from '@/utils/request'
import StoreNameSelect from '@/components/StoreNameSelect.vue'
import { rememberStoreName } from '@/utils/recentStores'

interface StaffRow {
  uid: number
  nickname: string
  phone: string
  memberCount: number
}

const props = defineProps<{ storeId: number | null }>()
const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{ transferred: [] }>()

const loading = ref(false)
const store = ref<{ id: number; name: string } | null>(null)
const staffList = ref<StaffRow[]>([])
const selectedRows = ref<StaffRow[]>([])
const tableRef = ref<TableInstance>()

const transferOpen = ref(false)
const transferUids = ref<number[]>([])
const targetStoreName = ref('')
const transferring = ref(false)

watch(
  () => [props.storeId, visible.value] as const,
  async ([id, open]) => {
    if (!open || !id) return
    await loadStaff(id)
  }
)

async function loadStaff(id: number) {
  loading.value = true
  selectedRows.value = []
  try {
    const data = await request.get(`/api/admin/stores/${id}/staff`)
    store.value = data?.store || null
    staffList.value = data?.list || []
  } catch {
    store.value = null
    staffList.value = []
  } finally {
    loading.value = false
  }
}

function onSelect(rows: StaffRow[]) {
  selectedRows.value = rows
}

function openTransfer(uids: number[]) {
  if (!uids.length) {
    ElMessage.warning('请先选择客户经理')
    return
  }
  transferUids.value = uids
  targetStoreName.value = ''
  transferOpen.value = true
}

async function confirmTransfer() {
  const target = String(targetStoreName.value || '').trim()
  if (!target) {
    ElMessage.warning('请选择或输入目标门店')
    return
  }
  if (target === store.value?.name) {
    ElMessage.warning('目标门店不能与当前门店相同')
    return
  }
  transferring.value = true
  try {
    const data = await request.post(`/api/admin/stores/${props.storeId}/transfer`, {
      targetStoreName: target,
      uids: transferUids.value
    })
    rememberStoreName(target)
    const synced = Number(data?.cardsSynced ?? 0)
    ElMessage.success(
      `已转移 ${data?.moved ?? 0} 人到「${data?.toStoreName || target}」` +
        (synced ? `，同步更新 ${synced} 张名片门店名` : '')
    )
    transferOpen.value = false
    tableRef.value?.clearSelection()
    if (props.storeId) await loadStaff(props.storeId)
    emit('transferred')
  } catch {
    /* handled */
  } finally {
    transferring.value = false
  }
}
</script>

<style scoped>
.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
}
.header-main {
  min-width: 0;
}
.store-title {
  font-size: 17px;
  font-weight: 600;
  color: var(--gov-text-primary);
}
.store-sub {
  font-size: 13px;
  color: #9ca3af;
  margin-top: 4px;
}
.transfer-tip {
  margin: 0 0 12px;
  font-size: 13px;
  color: #606266;
  line-height: 1.6;
}
.transfer-tip strong {
  color: var(--el-color-primary);
}
</style>
