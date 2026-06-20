<template>
  <el-drawer v-model="visible" title="审批设置" size="400px" destroy-on-close>
    <el-form label-width="120px" label-position="top">
      <el-form-item label="消费审批免审">
        <el-switch v-model="form.consumption" />
        <p class="hint">开启后店员提交将自动通过并发放权益，仍保留记录</p>
      </el-form-item>

      <el-form-item label="积分商城免审">
        <el-switch v-model="form.integralMall" />
        <p class="hint">开启后积分兑换无需三级审批</p>
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
