<template>
  <div class="login-page">
    <div class="login-bg">
      <div class="login-grid" />
      <div class="login-orb login-orb-1" />
      <div class="login-orb login-orb-2" />
    </div>

    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">锦</div>
        <h1 class="login-title">锦程数码会员电商系统</h1>
        <p class="login-subtitle">安全管理控制台</p>
      </div>

      <el-form :model="form" :rules="rules" ref="formRef" @submit.prevent="handleLogin">
        <el-form-item prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" prefix-icon="User" size="large" />
        </el-form-item>
        <el-form-item prop="password">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" prefix-icon="Lock" size="large" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" size="large" class="login-btn" :loading="loading" @click="handleLogin">
            安 全 登 录
          </el-button>
        </el-form-item>
      </el-form>

      <p class="login-footer">系统已启用安全传输与审计审计保护</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useUserStore } from '@/store/user'
import { ElMessage } from 'element-plus'
import type { FormInstance } from 'element-plus'

const router = useRouter()
const userStore = useUserStore()
const formRef = ref<FormInstance>()
const loading = ref(false)

const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

async function handleLogin() {
  await formRef.value?.validate()
  loading.value = true
  try {
    await userStore.login(form.username, form.password)
    ElMessage.success('登录成功')
    router.push('/')
  } catch (e: any) {
    ElMessage.error(e.message || '登录失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
}

.login-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

/* 高端科技感网格背景 */
.login-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
}

.login-orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(80px);
}

.login-orb-1 {
  width: 500px;
  height: 500px;
  top: -100px;
  right: -50px;
  background: radial-gradient(circle, rgba(0, 82, 217, 0.15) 0%, transparent 70%);
}

.login-orb-2 {
  width: 400px;
  height: 400px;
  bottom: -100px;
  left: -50px;
  background: radial-gradient(circle, rgba(0, 168, 112, 0.08) 0%, transparent 70%);
}

.login-card {
  position: relative;
  z-index: 1;
  width: 420px;
  background: var(--gov-bg-card, #fff);
  border-radius: 8px;
  padding: 44px 40px 36px;
  box-shadow: 0 20px 40px rgba(15, 23, 42, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.login-header {
  text-align: center;
  margin-bottom: 36px;
}

.login-logo {
  width: 52px;
  height: 52px;
  margin: 0 auto 16px;
  background: linear-gradient(135deg, var(--gov-primary), #1a66ec);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 800;
  color: #fff;
  box-shadow: 0 4px 12px rgba(0, 82, 217, 0.25);
}

.login-title {
  font-size: 20px;
  font-weight: 600;
  color: var(--gov-text-primary);
  margin: 0;
  letter-spacing: 0.5px;
}

.login-subtitle {
  font-size: 13px;
  color: var(--gov-text-secondary);
  margin: 8px 0 0;
  font-weight: 500;
  letter-spacing: 1px;
}

.login-btn {
  width: 100%;
  height: 40px;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 4px;
  border-radius: var(--gov-radius, 4px);
  background-color: var(--gov-primary);
  border-color: var(--gov-primary);
  box-shadow: var(--gov-shadow-button);
}

.login-btn:hover {
  background-color: var(--gov-primary-hover);
  border-color: var(--gov-primary-hover);
}

.login-btn:active {
  background-color: var(--gov-primary-active);
  border-color: var(--gov-primary-active);
}

.login-footer {
  text-align: center;
  font-size: 12px;
  color: var(--gov-text-muted);
  margin: 28px 0 0;
}
</style>
