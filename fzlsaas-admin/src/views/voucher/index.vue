<template>
  <div>
    <el-card>
      <template #header><span>现金券管理</span></template>

      <el-row :gutter="20">
        <el-col :span="12">
          <h4>发放现金券</h4>
          <el-form :model="grantForm" label-width="100px" style="max-width:400px">
            <el-form-item label="客户UID">
              <el-input-number v-model="grantForm.uid" :min="1" />
            </el-form-item>
            <el-form-item label="金额">
              <el-input-number v-model="grantForm.amount" :min="1" :max="100000" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="grantForm.remark" />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" @click="handleGrant" :loading="granting">发放</el-button>
            </el-form-item>
          </el-form>
        </el-col>

        <el-col :span="12">
          <h4>核销模式</h4>
          <el-radio-group v-model="verifyMode" @change="handleModeChange">
            <el-radio-button value="any">任意金额</el-radio-button>
            <el-radio-button value="hundred">整百金额</el-radio-button>
          </el-radio-group>
        </el-col>
      </el-row>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'

const grantForm = ref({ uid: 0, amount: 100, remark: '超管手动发放' })
const granting = ref(false)
const verifyMode = ref('any')

async function handleGrant() {
  granting.value = true
  try {
    await request.post('/api/admin/cash-voucher/grant', grantForm.value)
    ElMessage.success('发放成功')
  } catch { /* handled */ } finally { granting.value = false }
}

async function handleModeChange(mode: string) {
  try {
    await request.put('/api/admin/cash-voucher/verify-mode', { mode })
    ElMessage.success(`核销模式已切换为：${mode === 'any' ? '任意金额' : '整百金额'}`)
  } catch { /* handled */ }
}
</script>
