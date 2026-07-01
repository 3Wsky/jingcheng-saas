<template>
  <PageShell title="系统设置" subtitle="审批免审、运营开关等全局配置">
    <el-row :gutter="20">
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span>审批免审</span></template>
          <el-form label-width="120px" label-position="top" v-loading="loading">
            <el-form-item label="消费审批免审（按 IMEI/SN 码核对）">
              <el-switch v-model="form.consumption" />
              <p class="hint">
                开启后：<b>店长初审通过</b> + 收据里的 <b>IMEI1 / SN 在产品库全部命中</b> → 系统<b>自动终审并发放权益</b>（免超管人工），仍保留记录。
                有码未命中 / 未填码的仍转人工终审。需先在「SN 产品库」导入设备库。
              </p>
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
          <template #header><span>AI 生图配置</span></template>
          <el-form label-width="120px" label-position="top" v-loading="aiLoading">
            <el-form-item label="API 地址">
              <el-input v-model="aiForm.baseUrl" placeholder="https://api.openai.com（OpenAI 兼容协议）" />
              <p class="hint">支持 OpenAI、FastAPI AI 等兼容接口，会自动补 /v1</p>
            </el-form-item>
            <el-form-item label="API 密钥">
              <el-input v-model="aiForm.apiKey" type="password" show-password :placeholder="aiForm.apiKeySet ? '已配置（留空保持不变）' : '输入 API Key'" />
            </el-form-item>
            <el-form-item label="模型">
              <el-input v-model="aiForm.model" placeholder="gpt-image-2" />
            </el-form-item>
            <el-form-item label="图片质量">
              <el-select v-model="aiForm.quality" style="width: 160px">
                <el-option label="低" value="low" />
                <el-option label="中" value="medium" />
                <el-option label="高" value="high" />
                <el-option label="自动" value="auto" />
              </el-select>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="aiSaving" @click="saveAiConfig">保存配置</el-button>
              <el-tag v-if="aiForm.effectiveConfigured" type="success" size="small" style="margin-left: 12px">已启用</el-tag>
              <el-tag v-else type="warning" size="small" style="margin-left: 12px">未配置</el-tag>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header><span>管理员账户</span></template>
          <el-descriptions :column="1" border size="small" v-loading="accountLoading">
            <el-descriptions-item label="账户名">{{ accountInfo.username || '—' }}</el-descriptions-item>
            <el-descriptions-item label="登录时间">{{ accountInfo.loginAt ? new Date(accountInfo.loginAt).toLocaleString('zh-CN') : '—' }}</el-descriptions-item>
            <el-descriptions-item label="会话有效期">{{ Math.round((accountInfo.sessionMaxAge || 0) / 3600) }} 小时</el-descriptions-item>
          </el-descriptions>
          <el-divider />
          <el-form label-width="100px" label-position="top">
            <el-form-item label="修改密码">
              <el-input v-model="pwdForm.currentPassword" type="password" placeholder="当前密码" show-password style="margin-bottom: 8px" />
              <el-input v-model="pwdForm.newPassword" type="password" placeholder="新密码（至少8位）" show-password />
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="pwdSaving" @click="changePassword">修改密码</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

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

    <el-row v-if="isSuperAdmin" :gutter="20" style="margin-top: 20px">
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <span>子管理员账号（仅网站端）</span>
            <el-button type="primary" size="small" style="margin-left: 12px" @click="openCreateSubAdmin">新增子管理员</el-button>
            <span class="hint" style="margin-left: 12px">子管理员可登录后台，但==回收 / 删除 / 撤销终批==等危险操作仅超级管理员可执行。</span>
          </template>
          <el-table :data="subAdmins" size="small" v-loading="subAdminLoading">
            <template #empty><el-empty description="暂无子管理员，点右上角「新增子管理员」" :image-size="56" /></template>
            <el-table-column prop="username" label="账号" min-width="140" />
            <el-table-column label="状态" width="90">
              <template #default="{ row }">
                <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">{{ row.status === 1 ? '启用' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="remark" label="备注" min-width="140">
              <template #default="{ row }">{{ row.remark || '—' }}</template>
            </el-table-column>
            <el-table-column label="创建时间" width="170">
              <template #default="{ row }">{{ fmtSubTime(row.createdAt) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="220" align="center">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="resetSubAdminPassword(row)">重置密码</el-button>
                <el-button link :type="row.status === 1 ? 'warning' : 'success'" size="small" @click="toggleSubAdminStatus(row)">
                  {{ row.status === 1 ? '停用' : '启用' }}
                </el-button>
                <el-button link type="danger" size="small" @click="removeSubAdmin(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="showCreateSubAdmin" title="新增子管理员" width="420px" append-to-body>
      <el-form :model="subAdminForm" label-width="72px">
        <el-form-item label="账号" required>
          <el-input v-model="subAdminForm.username" placeholder="3-64 位，字母/数字/._-" />
        </el-form-item>
        <el-form-item label="密码" required>
          <el-input v-model="subAdminForm.password" type="password" show-password placeholder="至少 8 位" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="subAdminForm.remark" placeholder="选填，如姓名/岗位" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateSubAdmin = false">取消</el-button>
        <el-button type="primary" :loading="subAdminSaving" @click="confirmCreateSubAdmin">确认创建</el-button>
      </template>
    </el-dialog>

    <el-row :gutter="20" style="margin-top: 20px">
      <el-col :span="24">
        <el-card shadow="never">
          <template #header>
            <span>企业微信 · 自动欢迎语绑定</span>
            <el-tag v-if="weworkForm.enabled" type="success" size="small" style="margin-left: 12px">已启用</el-tag>
            <el-tag v-else type="info" size="small" style="margin-left: 12px">未启用</el-tag>
          </template>
          <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">
            <template #default>
              <p class="hint">顾客在企微添加客户经理后，自动弹出小程序并绑定到该客户经理名下。需在企微管理后台配置自建应用与回调。</p>
              <p class="hint">回调 URL：<code>{{ callbackUrl }}</code>（在企微「接收事件服务器」填写，Token / AESKey 与下方一致）</p>
            </template>
          </el-alert>
          <el-form label-width="140px" label-position="top" v-loading="weworkLoading">
            <el-row :gutter="16">
              <el-col :xs="24" :md="8">
                <el-form-item label="启用">
                  <el-switch v-model="weworkForm.enabled" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="8">
                <el-form-item label="企业 ID (corpId)">
                  <el-input v-model="weworkForm.corpId" placeholder="ww 开头" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="8">
                <el-form-item label="应用 AgentId">
                  <el-input v-model="weworkForm.agentId" placeholder="自建应用 AgentId" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <el-form-item label="客户联系 Secret">
                  <el-input v-model="weworkForm.contactSecret" type="password" show-password :placeholder="weworkForm.hasContactSecret ? '已配置（留空保持不变）' : '客户联系功能的 Secret'" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-form-item label="小程序 AppId">
                  <el-input v-model="weworkForm.miniappAppId" placeholder="wx 开头，需在企微关联授权" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :xs="24" :md="12">
                <el-form-item label="回调 Token">
                  <el-input v-model="weworkForm.token" placeholder="与企微回调配置一致" />
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="12">
                <el-form-item label="回调 EncodingAESKey">
                  <el-input v-model="weworkForm.encodingAesKey" type="password" show-password :placeholder="weworkForm.hasEncodingAesKey ? '已配置（留空保持不变）' : '43 位 AESKey'" />
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :xs="24" :md="8">
                <el-form-item label="小程序落地页">
                  <el-input v-model="weworkForm.miniappPagePath" placeholder="pages/index/index" />
                  <p class="hint">系统会自动追加 ?spread=客户经理UID</p>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="16">
                <el-form-item label="欢迎语文案">
                  <el-input v-model="weworkForm.welcomeText" type="textarea" :rows="2" maxlength="200" show-word-limit />
                </el-form-item>
              </el-col>
            </el-row>

            <el-divider content-position="left">客户经理映射（企微成员 → 客户经理 UID）</el-divider>
            <p class="hint" style="margin-bottom: 12px">填写每个客户经理的企微成员账号(UserID)与其在系统里的会员 UID；顾客添加谁，就绑定到对应 UID。</p>
            <el-table :data="weworkForm.mappings" size="small" border style="margin-bottom: 12px">
              <el-table-column label="企微成员 UserID" min-width="200">
                <template #default="{ row }">
                  <el-input v-model="row.userid" size="small" placeholder="如 zhangsan" />
                </template>
              </el-table-column>
              <el-table-column label="客户经理 UID" width="160">
                <template #default="{ row }">
                  <el-input-number v-model="row.uid" :min="1" size="small" controls-position="right" style="width: 130px" />
                </template>
              </el-table-column>
              <el-table-column label="备注" min-width="160">
                <template #default="{ row }">
                  <el-input v-model="row.name" size="small" placeholder="姓名（选填）" />
                </template>
              </el-table-column>
              <el-table-column label="操作" width="80" fixed="right">
                <template #default="{ $index }">
                  <el-button link type="danger" size="small" @click="removeMapping($index)">删除</el-button>
                </template>
              </el-table-column>
              <template #empty>
                <el-empty :image-size="60" description="暂无映射，点下方「添加映射」" />
              </template>
            </el-table>
            <el-form-item>
              <el-button @click="addMapping">添加映射</el-button>
              <el-button type="primary" :loading="weworkSaving" @click="saveWeworkConfig" style="margin-left: 8px">保存企微配置</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'
import { useUserStore } from '@/store/user'

const router = useRouter()
const userStore = useUserStore()
const isSuperAdmin = computed(() => userStore.isSuperAdmin)

// ===== 子管理员账号（仅超级管理员可见/可管）=====
const subAdmins = ref<any[]>([])
const subAdminLoading = ref(false)
const subAdminSaving = ref(false)
const showCreateSubAdmin = ref(false)
const subAdminForm = ref({ username: '', password: '', remark: '' })

async function loadSubAdmins() {
  if (!isSuperAdmin.value) return
  subAdminLoading.value = true
  try {
    subAdmins.value = await request.get('/api/admin/sub-admins')
  } catch {
    subAdmins.value = []
  } finally {
    subAdminLoading.value = false
  }
}

function openCreateSubAdmin() {
  subAdminForm.value = { username: '', password: '', remark: '' }
  showCreateSubAdmin.value = true
}

async function confirmCreateSubAdmin() {
  const u = subAdminForm.value.username.trim()
  if (u.length < 3) { ElMessage.warning('账号至少 3 位'); return }
  if (subAdminForm.value.password.length < 8) { ElMessage.warning('密码至少 8 位'); return }
  subAdminSaving.value = true
  try {
    await request.post('/api/admin/sub-admins', {
      username: u,
      password: subAdminForm.value.password,
      remark: subAdminForm.value.remark.trim()
    })
    ElMessage.success('子管理员已创建')
    showCreateSubAdmin.value = false
    loadSubAdmins()
  } catch { /* handled */ } finally {
    subAdminSaving.value = false
  }
}

async function resetSubAdminPassword(row: any) {
  try {
    const { value } = await ElMessageBox.prompt(`为「${row.username}」设置新密码（至少 8 位）`, '重置密码', {
      inputType: 'password',
      inputValidator: (v: string) => (v && v.length >= 8) || '密码至少 8 位',
      confirmButtonText: '确认重置'
    })
    await request.put(`/api/admin/sub-admins/${row.id}/password`, { password: value })
    ElMessage.success('密码已重置')
  } catch { /* cancel */ }
}

async function toggleSubAdminStatus(row: any) {
  const next = Number(row.status) === 1 ? 0 : 1
  try {
    await request.put(`/api/admin/sub-admins/${row.id}/status`, { status: next })
    ElMessage.success(next ? '已启用' : '已停用')
    loadSubAdmins()
  } catch { /* handled */ }
}

async function removeSubAdmin(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除子管理员「${row.username}」？删除后该账号无法登录。`, '删除子管理员', {
      type: 'warning', confirmButtonText: '确认删除', confirmButtonClass: 'el-button--danger'
    })
    await request.delete(`/api/admin/sub-admins/${row.id}`)
    ElMessage.success('已删除')
    loadSubAdmins()
  } catch { /* cancel */ }
}

function fmtSubTime(ts: number) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN')
}
const loading = ref(false)
const saving = ref(false)
const entryLoading = ref(false)
const entrySaving = ref(false)
const form = ref({ consumption: false, integralMall: false })
const entryForm = ref({ staffEntryRoleOnly: false, merchantEntryRoleOnly: false })
const lastModified = ref('')
const accountLoading = ref(false)
const accountInfo = ref<any>({})
const pwdForm = ref({ currentPassword: '', newPassword: '' })
const pwdSaving = ref(false)
const aiLoading = ref(false)
const aiSaving = ref(false)
const aiForm = ref<any>({ baseUrl: '', apiKey: '', apiKeySet: false, model: 'gpt-image-2', quality: 'medium', effectiveConfigured: false })

const weworkLoading = ref(false)
const weworkSaving = ref(false)
const weworkForm = ref<any>({
  enabled: false, corpId: '', contactSecret: '', agentId: '', token: '', encodingAesKey: '',
  miniappAppId: '', miniappPagePath: 'pages/index/index', welcomeText: '', hasContactSecret: false, hasEncodingAesKey: false,
  mappings: [] as Array<{ userid: string; uid: number; name: string }>
})
const callbackUrl = computed(() => `${(import.meta as any).env?.VITE_API_BASE || 'https://ok.xjshunwei.cn/sw-api'}/api/wework/callback`)

onMounted(() => {
  loadConfig()
  loadEntryConfig()
  loadAccountInfo()
  loadAiConfig()
  loadWeworkConfig()
  loadSubAdmins()
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
    entryForm.value = { staffEntryRoleOnly: false, merchantEntryRoleOnly: false }
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

async function loadAccountInfo() {
  accountLoading.value = true
  try {
    accountInfo.value = await request.get('/api/admin/account/info')
  } catch {
    accountInfo.value = {}
  } finally {
    accountLoading.value = false
  }
}

async function loadAiConfig() {
  aiLoading.value = true
  try {
    const data = await request.get('/api/admin/config/ai-image')
    aiForm.value = {
      baseUrl: data.baseUrl || '',
      apiKey: '',
      apiKeySet: data.apiKeySet || false,
      model: data.model || 'gpt-image-2',
      quality: data.quality || 'medium',
      effectiveConfigured: data.effectiveConfigured || false
    }
  } catch {
    aiForm.value = { baseUrl: '', apiKey: '', apiKeySet: false, model: 'gpt-image-2', quality: 'medium', effectiveConfigured: false }
  } finally {
    aiLoading.value = false
  }
}

async function saveAiConfig() {
  if (!aiForm.value.baseUrl && !aiForm.value.apiKey && !aiForm.value.apiKeySet) {
    ElMessage.warning('请填写 API 地址和密钥')
    return
  }
  aiSaving.value = true
  try {
    const payload: any = {
      baseUrl: aiForm.value.baseUrl,
      model: aiForm.value.model,
      quality: aiForm.value.quality
    }
    if (aiForm.value.apiKey) payload.apiKey = aiForm.value.apiKey
    const data = await request.put('/api/admin/config/ai-image', payload)
    aiForm.value.effectiveConfigured = data?.configured || false
    aiForm.value.apiKeySet = true
    aiForm.value.apiKey = ''
    ElMessage.success('AI 生图配置已保存')
  } catch {
    /* handled */
  } finally {
    aiSaving.value = false
  }
}

async function loadWeworkConfig() {
  weworkLoading.value = true
  try {
    const data = await request.get('/api/admin/wework/config')
    weworkForm.value = {
      enabled: !!data.enabled,
      corpId: data.corpId || '',
      contactSecret: '',
      agentId: data.agentId || '',
      token: data.token || '',
      encodingAesKey: '',
      miniappAppId: data.miniappAppId || '',
      miniappPagePath: data.miniappPagePath || 'pages/index/index',
      welcomeText: data.welcomeText || '',
      hasContactSecret: !!data.hasContactSecret,
      hasEncodingAesKey: !!data.hasEncodingAesKey,
      mappings: Array.isArray(data.mappings) ? data.mappings.map((m: any) => ({ userid: m.userid || '', uid: Number(m.uid) || undefined, name: m.name || '' })) : []
    }
  } catch {
    /* keep defaults */
  } finally {
    weworkLoading.value = false
  }
}

function addMapping() {
  weworkForm.value.mappings.push({ userid: '', uid: undefined, name: '' })
}

function removeMapping(index: number) {
  weworkForm.value.mappings.splice(index, 1)
}

async function saveWeworkConfig() {
  const mappings = (weworkForm.value.mappings || [])
    .filter((m: any) => String(m.userid || '').trim() && Number(m.uid) > 0)
    .map((m: any) => ({ userid: String(m.userid).trim(), uid: Number(m.uid), name: String(m.name || '').trim() }))
  weworkSaving.value = true
  try {
    const payload: any = {
      enabled: weworkForm.value.enabled,
      corpId: weworkForm.value.corpId,
      agentId: weworkForm.value.agentId,
      token: weworkForm.value.token,
      miniappAppId: weworkForm.value.miniappAppId,
      miniappPagePath: weworkForm.value.miniappPagePath,
      welcomeText: weworkForm.value.welcomeText,
      mappings
    }
    if (weworkForm.value.contactSecret) payload.contactSecret = weworkForm.value.contactSecret
    if (weworkForm.value.encodingAesKey) payload.encodingAesKey = weworkForm.value.encodingAesKey
    const data = await request.put('/api/admin/wework/config', payload)
    weworkForm.value.hasContactSecret = !!data.hasContactSecret
    weworkForm.value.hasEncodingAesKey = !!data.hasEncodingAesKey
    weworkForm.value.contactSecret = ''
    weworkForm.value.encodingAesKey = ''
    ElMessage.success('企微配置已保存')
  } catch {
    /* handled */
  } finally {
    weworkSaving.value = false
  }
}

async function changePassword() {
  if (!pwdForm.value.currentPassword) {
    ElMessage.warning('请输入当前密码')
    return
  }
  if (!pwdForm.value.newPassword || pwdForm.value.newPassword.length < 8) {
    ElMessage.warning('新密码至少8位')
    return
  }
  try {
    await ElMessageBox.confirm('确认修改管理员密码？修改后需用新密码重新登录。', '修改密码', { type: 'warning' })
  } catch {
    return
  }
  pwdSaving.value = true
  try {
    await request.put('/api/admin/account/password', pwdForm.value)
    ElMessage.success('密码已修改')
    pwdForm.value = { currentPassword: '', newPassword: '' }
  } catch {
    /* handled */
  } finally {
    pwdSaving.value = false
  }
}
</script>

<style scoped>
.hint { font-size: 12px; color: #9CA3AF; margin: 4px 0 0; line-height: 1.5; }
.last-mod { font-size: 12px; color: #6B7280; margin-top: 4px; }
</style>
