<template>
  <el-drawer v-model="visible" title="审批设置" size="400px" destroy-on-close>
    <el-form label-width="120px" label-position="top">
      <el-form-item label="消费审批免审（按 IMEI/SN 码核对）">
        <el-switch v-model="form.consumption" />
        <p class="hint">
          开启后：<b>店长初审通过</b> + 收据里的 <b>IMEI1 / SN 在产品库命中</b> → 系统<b>自动终审并发放权益</b>（免超管人工终审）。
          码未命中的仍转人工终审。需先在「SN 产品库」导入设备库。
        </p>
      </el-form-item>

      <el-form-item label="积分商城免审">
        <el-switch v-model="form.integralMall" />
        <p class="hint">开启后积分兑换无需三级审批</p>
      </el-form-item>

      <el-divider />

      <el-form-item label="IMEI/SN 防重复台账">
        <el-button :loading="backfilling" @click="runBackfill">回填历史已用码</el-button>
        <p class="hint">
          把<b>历史已通过</b>审批单的 IMEI/SN 登记为「已用」，防止老码被再次申请。
          <b>首次启用免审前点一次即可</b>（可重复点，幂等）。
        </p>
        <p v-if="backfillResult" class="last-mod">{{ backfillResult }}</p>
      </el-form-item>

      <el-divider />

      <el-alert type="warning" :closable="false" show-icon title="危险区域">
        <template #default>
          <p class="hint">修改免审设置会影响全部门店，请谨慎操作</p>
          <p v-if="lastModified" class="last-mod">最近修改：{{ lastModified }}</p>
        </template>
      </el-alert>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const visible = defineModel<boolean>({ default: false })
const emit = defineEmits<{ saved: [] }>()

const form = ref({ consumption: false, integralMall: false })
const saving = ref(false)
const lastModified = ref('')
const backfilling = ref(false)
const backfillResult = ref('')

async function runBackfill() {
  backfilling.value = true
  try {
    const r = await request.post('/api/admin/approval/code-usage/backfill', {})
    backfillResult.value = `已登记历史已用码：扫描 ${r?.approvedScanned ?? 0} 张已通过单，新登记 ${r?.codesInserted ?? 0} 个码`
    ElMessage.success('回填完成')
  } catch {
    /* handled by interceptor */
  } finally {
    backfilling.value = false
  }
}

watch(visible, async (open) => {
  if (!open) return
  try {
    form.value = await request.get('/api/admin/config/approval-auto-pass')
  } catch {
    form.value = { consumption: false, integralMall: false }
  }
})

async function save() {
  saving.value = true
  try {
    await request.put('/api/admin/config/approval-auto-pass', { enabled: form.value.consumption, scope: 'consumption' })
    await request.put('/api/admin/config/approval-auto-pass', { enabled: form.value.integralMall, scope: 'integral_mall' })
    lastModified.value = `admin @ ${new Date().toLocaleString('zh-CN')}`
    ElMessage.success('免审设置已保存')
    emit('saved')
    visible.value = false
  } catch {
    /* handled by interceptor */
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.hint { font-size: 12px; color: #9CA3AF; margin: 4px 0 0; line-height: 1.5; }
.last-mod { font-size: 12px; color: #6B7280; margin-top: 4px; }
</style>
