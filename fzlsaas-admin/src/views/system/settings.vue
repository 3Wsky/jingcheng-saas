<template>
  <PageShell title="系统设置" subtitle="审批免审、运营开关等全局配置">
    <el-row :gutter="20">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span>审批免审</span></template>
          <el-form label-width="120px" label-position="top" v-loading="loading">
            <el-form-item label="消费审批免审">
              <el-switch v-model="form.consumption" />
              <p class="hint">开启后店员提交将自动通过并发放权益，仍保留记录</p>
            </el-form-item>
            <el-form-item label="积分商城免审">
              <el-switch v-model="form.integralMall" />
              <p class="hint">开启后积分兑换无需三级审批</p>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="saving" @click="save">保存设置</el-button>
            </el-form-item>
          </el-form>
          <el-alert type="warning" :closable="false" show-icon title="危险区域">
            <template #default>
              <p class="hint">修改免审设置会影响全部门店，请谨慎操作</p>
              <p v-if="lastModified" class="last-mod">最近修改：{{ lastModified }}</p>
            </template>
          </el-alert>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span>快捷入口</span></template>
          <el-space direction="vertical" alignment="flex-start" :size="12">
            <el-link type="primary" @click="router.push('/finance-settings')">财务设置（现金券核销模式）</el-link>
            <el-link type="primary" @click="router.push('/audit-logs')">审计日志</el-link>
            <el-link type="primary" @click="router.push('/approval')">审批管理</el-link>
          </el-space>
        </el-card>
      </el-col>
    </el-row>

    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span>小程序入口显示</span></template>
          <el-form label-width="120px" label-position="top" v-loading="entryLoading">
            <el-form-item label="员工工作台">
              <el-switch
                v-model="entryForm.staffEntryRoleOnly"
                active-text="仅员工可见"
                inactive-text="始终显示（测试）"
              />
              <p class="hint">开启后仅后台标记为员工的账号可见；关闭后所有用户可见，便于测试入口</p>
            </el-form-item>
            <el-form-item label="商家核销">
              <el-switch
                v-model="entryForm.merchantEntryRoleOnly"
                active-text="仅商家可见"
                inactive-text="始终显示（测试）"
              />
              <p class="hint">开启后仅绑定商家且开通核销权限的账号可见；关闭后所有用户可见</p>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="entrySaving" @click="saveEntryConfig">保存入口设置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import PageShell from '@/components/PageShell.vue'

const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const entryLoading = ref(false)
const entrySaving = ref(false)
const form = ref({ consumption: false, integralMall: false })
const entryForm = ref({ staffEntryRoleOnly: true, merchantEntryRoleOnly: true })
const lastModified = ref('')

onMounted(() => {
  loadConfig()
  loadEntryConfig()
})

async function loadConfig() {
  loading.value = true
  try {
    form.value = await request.get('/api/admin/config/approval-auto-pass')
  } catch {
    form.value = { consumption: false, integralMall: false }
  } finally {
    loading.value = false
  }
}

async function save() {
  saving.value = true
  try {
    await request.put('/api/admin/config/approval-auto-pass', { enabled: form.value.consumption, scope: 'consumption' })
    await request.put('/api/admin/config/approval-auto-pass', { enabled: form.value.integralMall, scope: 'integral_mall' })
    lastModified.value = `admin @ ${new Date().toLocaleString('zh-CN')}`
    ElMessage.success('系统设置已保存')
  } catch {
    /* handled by interceptor */
  } finally {
    saving.value = false
  }
}

async function loadEntryConfig() {
  entryLoading.value = true
  try {
    entryForm.value = await request.get('/api/admin/config/miniapp-entries')
  } catch {
    entryForm.value = { staffEntryRoleOnly: true, merchantEntryRoleOnly: true }
  } finally {
    entryLoading.value = false
  }
}

async function saveEntryConfig() {
  entrySaving.value = true
  try {
    await request.put('/api/admin/config/miniapp-entries', entryForm.value)
    ElMessage.success('小程序入口设置已保存')
  } catch {
    /* handled by interceptor */
  } finally {
    entrySaving.value = false
  }
}
</script>

<style scoped>
.hint { font-size: 12px; color: #9CA3AF; margin: 4px 0 0; line-height: 1.5; }
.last-mod { font-size: 12px; color: #6B7280; margin-top: 4px; }
</style>
