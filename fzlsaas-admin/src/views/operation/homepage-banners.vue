<template>
  <PageShell
    title="首页轮播图"
    subtitle="统一管理小程序首页横幅、文案和点击去向；保存后用户重新进入首页即可看到，无需重新发布小程序。"
  >
    <template #actions>
      <el-button :loading="loading" @click="loadConfig">刷新</el-button>
      <el-button type="primary" :loading="saving" @click="saveConfig">保存并生效</el-button>
    </template>

    <el-alert type="info" :closable="false" show-icon class="page-note">
      <template #title>
        首页横幅推荐使用 <b>16:9</b> 横图。AI 只生成背景画面，标题、副标题和按钮由小程序叠加，后续改文案不需要重新生图。
      </template>
    </el-alert>

    <div class="banner-workspace" v-loading="loading">
      <section class="banner-list-panel">
        <div class="panel-heading">
          <div>
            <h3>轮播顺序</h3>
            <p>排序值越大越靠前；关闭后不会在小程序展示。</p>
          </div>
          <el-button type="primary" plain @click="addBanner">
            <el-icon><Plus /></el-icon>新增轮播图
          </el-button>
        </div>

        <el-empty v-if="!banners.length" description="暂未配置首页轮播图" :image-size="72" />
        <div v-else class="banner-list">
          <article
            v-for="(item, index) in orderedBanners"
            :key="item.id"
            class="banner-list-item"
            :class="{ active: selectedId === item.id }"
            @click="selectBanner(item.id)"
          >
            <el-image v-if="item.image" :src="item.image" fit="cover" class="list-thumb" />
            <div v-else class="list-thumb empty"><el-icon><Picture /></el-icon></div>
            <div class="list-copy">
              <strong>{{ item.title || '未命名轮播图' }}</strong>
              <span>{{ targetLabel(item) }}</span>
            </div>
            <el-tag size="small" :type="item.enabled ? 'success' : 'info'">
              {{ item.enabled ? '展示中' : '已关闭' }}
            </el-tag>
            <div class="order-actions" @click.stop>
              <el-tooltip content="上移"><el-button link :disabled="index === 0" @click="moveBanner(item.id, -1)"><el-icon><Top /></el-icon></el-button></el-tooltip>
              <el-tooltip content="下移"><el-button link :disabled="index === orderedBanners.length - 1" @click="moveBanner(item.id, 1)"><el-icon><Bottom /></el-icon></el-button></el-tooltip>
              <el-tooltip content="删除"><el-button link type="danger" @click="removeBanner(item.id)"><el-icon><Delete /></el-icon></el-button></el-tooltip>
            </div>
          </article>
        </div>
      </section>

      <section class="editor-panel">
        <el-empty v-if="!currentBanner" description="新增或选择一张轮播图后进行编辑" />
        <template v-else>
          <div class="preview-shell">
            <div class="preview-banner" :style="previewStyle">
              <div class="preview-shade"></div>
              <div class="preview-copy">
                <h2>{{ currentBanner.title || '轮播图主标题' }}</h2>
                <p>{{ currentBanner.subtitle || '这里展示轮播图副标题' }}</p>
                <span v-if="currentBanner.buttonText">{{ currentBanner.buttonText }} ›</span>
              </div>
            </div>
            <p class="field-note">小程序实际以横幅容器居中裁切图片，请把主体放在右侧并在四周保留安全空间。</p>
          </div>

          <el-tabs v-model="activeTab" class="editor-tabs">
            <el-tab-pane label="内容与跳转" name="content">
              <el-form label-width="104px" class="banner-form">
                <el-form-item label="展示状态">
                  <el-switch v-model="currentBanner.enabled" active-text="展示" inactive-text="关闭" />
                </el-form-item>
                <el-form-item label="背景图片" required>
                  <ImageUrlInput v-model="currentBanner.image" placeholder="上传图片或粘贴图片 URL" />
                </el-form-item>
                <el-form-item label="主标题">
                  <el-input v-model="currentBanner.title" maxlength="40" show-word-limit placeholder="例如：会员积分兑好礼" />
                </el-form-item>
                <el-form-item label="副标题">
                  <el-input v-model="currentBanner.subtitle" maxlength="100" show-word-limit placeholder="例如：到店购物享权益 · 数码好物兑换" />
                </el-form-item>
                <el-form-item label="按钮文字">
                  <el-input v-model="currentBanner.buttonText" maxlength="20" show-word-limit placeholder="例如：查看积分商城；留空则不显示按钮" />
                </el-form-item>
                <el-form-item label="点击跳转">
                  <el-select v-model="selectedTarget" filterable style="width: 100%" @change="applyPresetTarget">
                    <el-option v-for="option in targetOptions" :key="option.value" :label="option.label" :value="option.value" />
                  </el-select>
                </el-form-item>
                <el-form-item v-if="selectedTarget === 'custom'" label="页面路径">
                  <el-input v-model="currentBanner.targetPath" placeholder="/pages/jingcheng/showcase/detail?id=商品ID" @change="syncCustomTargetType" />
                  <p class="field-note">
                    路径必须已登记在小程序 app.json。底部导航页使用 switchTab，不能带参数；普通页面使用 navigateTo，可在路径后附加 ?id= 等参数。
                  </p>
                </el-form-item>
                <el-form-item label="排序值">
                  <el-input-number v-model="currentBanner.sort" :min="-9999" :max="9999" />
                  <span class="inline-note">数值越大越靠前</span>
                </el-form-item>
              </el-form>
            </el-tab-pane>

            <el-tab-pane label="AI 生成图片" name="ai">
              <el-alert v-if="!aiConfigured" type="warning" :closable="false" show-icon title="AI 生图服务尚未配置，请先到“系统 → 系统设置 → AI 生图配置”完成设置。" />
              <el-form label-width="104px" class="banner-form ai-form">
                <el-form-item label="画面描述" required>
                  <el-input
                    v-model="aiPrompt"
                    type="textarea"
                    :rows="5"
                    maxlength="1600"
                    show-word-limit
                    placeholder="描述希望展示的产品和场景，例如：无线耳机、平板和游戏手柄陈列在香槟金礼盒台面上，柔和商业棚拍光线"
                  />
                  <p class="field-note">无需在描述中写标题或价格。系统会自动要求 AI 不生成文字，并在左侧预留文案区。</p>
                </el-form-item>
                <el-form-item label="图片比例">
                  <el-segmented v-model="aiAspectRatio" :options="aspectOptions" />
                  <span class="inline-note">首页推荐 16:9</span>
                </el-form-item>
                <el-form-item label="生成质量">
                  <el-select v-model="aiQuality" style="width: 180px">
                    <el-option label="自动" value="auto" />
                    <el-option label="标准" value="medium" />
                    <el-option label="高清" value="high" />
                    <el-option label="快速预览" value="low" />
                  </el-select>
                </el-form-item>
                <el-form-item label=" ">
                  <el-button type="primary" :loading="aiGenerating" :disabled="!aiConfigured || !aiPrompt.trim()" @click="generateBannerImage">
                    <el-icon><MagicStick /></el-icon>{{ aiGenerating ? aiProgress : '生成并应用到当前轮播图' }}
                  </el-button>
                  <span class="inline-note">通常需要 30–120 秒，请勿重复点击。</span>
                </el-form-item>
              </el-form>
            </el-tab-pane>
          </el-tabs>
        </template>
      </section>
    </div>
  </PageShell>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Bottom, Delete, MagicStick, Picture, Plus, Top } from '@element-plus/icons-vue'
import PageShell from '@/components/PageShell.vue'
import ImageUrlInput from '@/components/ImageUrlInput.vue'
import request from '@/utils/request'

type TargetType = 'none' | 'page' | 'tab'

interface BannerItem {
  id: string
  title: string
  subtitle: string
  buttonText: string
  image: string
  targetType: TargetType
  targetPath: string
  enabled: boolean
  sort: number
}

const targetOptions = [
  { label: '不跳转（仅展示）', value: 'none', type: 'none' as TargetType, path: '' },
  { label: '积分商城', value: 'points', type: 'page' as TargetType, path: '/pages/jingcheng/integral/mall' },
  { label: '展示商品', value: 'showcase', type: 'page' as TargetType, path: '/pages/jingcheng/showcase/list' },
  { label: '消费券活动说明', value: 'activity', type: 'page' as TargetType, path: '/pages/jingcheng/activity/index' },
  { label: '联盟消费券广告页', value: 'coupon', type: 'page' as TargetType, path: '/pages/jingcheng/landing/coupon' },
  { label: '商品分类（底部导航）', value: 'category', type: 'tab' as TargetType, path: '/pages/goods_cate/goods_cate' },
  { label: '会员中心（底部导航）', value: 'mine', type: 'tab' as TargetType, path: '/pages/user/index' },
  { label: '自定义小程序页面路径', value: 'custom', type: 'page' as TargetType, path: '' }
]

const aspectOptions = ['16:9', '3:2', '4:3', '1:1']
const banners = ref<BannerItem[]>([])
const selectedId = ref('')
const selectedTarget = ref('none')
const activeTab = ref('content')
const loading = ref(false)
const saving = ref(false)
const aiConfigured = ref(false)
const aiGenerating = ref(false)
const aiProgress = ref('正在生成，请稍候')
const aiPrompt = ref('无线耳机、蓝牙音箱、游戏手柄和平板组成高级数码礼盒陈列，柔和商业棚拍光线，画面干净、有会员礼遇质感')
const aiAspectRatio = ref('16:9')
const aiQuality = ref('medium')

const orderedBanners = computed(() => [...banners.value].sort((a, b) => b.sort - a.sort))
const currentBanner = computed(() => banners.value.find(item => item.id === selectedId.value) || null)
const previewStyle = computed(() => currentBanner.value?.image
  ? { backgroundImage: `url("${currentBanner.value.image.replace(/"/g, '%22')}")` }
  : {})

onMounted(async () => {
  await Promise.all([loadConfig(), checkAiStatus()])
})

function createId() {
  return `banner-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

function addBanner() {
  const highest = orderedBanners.value[0]?.sort || 0
  const item: BannerItem = {
    id: createId(),
    title: '会员积分兑好礼',
    subtitle: '到店购物享权益 · 数码好物兑换',
    buttonText: '查看积分商城',
    image: '',
    targetType: 'page',
    targetPath: '/pages/jingcheng/integral/mall',
    enabled: true,
    sort: highest + 10
  }
  banners.value.push(item)
  selectBanner(item.id)
}

function selectBanner(id: string) {
  selectedId.value = id
  activeTab.value = 'content'
  syncSelectedTarget()
}

function syncSelectedTarget() {
  const current = currentBanner.value
  if (!current || current.targetType === 'none') {
    selectedTarget.value = 'none'
    return
  }
  const preset = targetOptions.find(option => option.path && option.path === current.targetPath)
  selectedTarget.value = preset?.value || 'custom'
}

function applyPresetTarget(value: string) {
  const current = currentBanner.value
  const option = targetOptions.find(item => item.value === value)
  if (!current || !option) return
  current.targetType = option.type
  if (value !== 'custom') current.targetPath = option.path
}

function syncCustomTargetType() {
  const current = currentBanner.value
  if (!current) return
  const path = current.targetPath.split('?')[0]
  const isTab = ['/pages/index/index', '/pages/goods_cate/goods_cate', '/pages/order_addcart/order_addcart', '/pages/user/index'].includes(path)
  current.targetType = current.targetPath ? (isTab ? 'tab' : 'page') : 'none'
}

function targetLabel(item: BannerItem) {
  if (item.targetType === 'none' || !item.targetPath) return '点击不跳转'
  const preset = targetOptions.find(option => option.path === item.targetPath)
  return preset?.label || item.targetPath
}

function moveBanner(id: string, offset: number) {
  const ordered = orderedBanners.value
  const index = ordered.findIndex(item => item.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= ordered.length) return
  const currentSort = ordered[index].sort
  ordered[index].sort = ordered[target].sort
  ordered[target].sort = currentSort
  if (ordered[index].sort === ordered[target].sort) {
    ordered[index].sort = (ordered.length - target) * 10
    ordered[target].sort = (ordered.length - index) * 10
  }
}

async function removeBanner(id: string) {
  await ElMessageBox.confirm('删除后需点击“保存并生效”才会同步到小程序。', '删除轮播图', { type: 'warning' })
  banners.value = banners.value.filter(item => item.id !== id)
  if (selectedId.value === id) {
    selectedId.value = orderedBanners.value[0]?.id || ''
    syncSelectedTarget()
  }
}

async function loadConfig() {
  loading.value = true
  try {
    const data = await request.get('/api/admin/homepage')
    banners.value = Array.isArray(data?.banners) ? data.banners : []
    if (banners.value.length) {
      selectedId.value = banners.value[0].id
      syncSelectedTarget()
    } else {
      // 首次使用只创建本地草稿，点击“保存并生效”后才会写入线上配置。
      addBanner()
    }
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  const invalidImage = banners.value.find(item => item.enabled && !item.image.trim())
  if (invalidImage) {
    selectBanner(invalidImage.id)
    ElMessage.warning('展示中的轮播图必须设置背景图片')
    return
  }
  const invalidTarget = banners.value.find(item => item.targetType !== 'none' && !item.targetPath.startsWith('/pages/'))
  if (invalidTarget) {
    selectBanner(invalidTarget.id)
    ElMessage.warning('跳转页面路径必须以 /pages/ 开头')
    return
  }
  saving.value = true
  try {
    await request.put('/api/admin/homepage', { banners: banners.value })
    ElMessage.success('首页轮播图已保存，小程序重新进入首页后生效')
    await loadConfig()
  } finally {
    saving.value = false
  }
}

async function checkAiStatus() {
  try {
    const data = await request.get('/api/admin/homepage/ai-image/status')
    aiConfigured.value = Boolean(data?.configured)
  } catch {
    aiConfigured.value = false
  }
}

async function generateBannerImage() {
  const current = currentBanner.value
  if (!current || !aiPrompt.value.trim()) return
  aiGenerating.value = true
  aiProgress.value = '正在提交生成任务'
  try {
    const data = await request.post('/api/admin/homepage/ai-image/generate', {
      prompt: aiPrompt.value.trim(),
      aspectRatio: aiAspectRatio.value,
      quality: aiQuality.value
    })
    if (!data?.taskId) {
      ElMessage.error('生图任务提交失败，请重试')
      return
    }
    const result = await waitForBannerImage(data.taskId)
    if (!result?.url) return
    current.image = result.url
    activeTab.value = 'content'
    ElMessage.success('AI 图片已应用到当前轮播图，确认预览后请保存')
  } finally {
    aiGenerating.value = false
    aiProgress.value = '正在生成，请稍候'
  }
}

async function waitForBannerImage(taskId: string) {
  const deadline = Date.now() + 10 * 60 * 1000
  while (Date.now() < deadline) {
    const task = await request.get(`/api/admin/homepage/ai-image/task/${encodeURIComponent(taskId)}`)
    aiProgress.value = task?.progress || 'AI 正在生成图片'
    if (task?.status === 'done') return task.result
    if (task?.status === 'failed') {
      ElMessage.error(task.error || 'AI 图片生成失败')
      return null
    }
    await new Promise(resolve => window.setTimeout(resolve, 2000))
  }
  ElMessage.error('AI 图片生成等待超时，请稍后重试')
  return null
}
</script>

<style scoped>
.page-note { margin-bottom: 18px; }
.banner-workspace { display: grid; grid-template-columns: minmax(360px, 0.82fr) minmax(560px, 1.5fr); gap: 18px; align-items: start; }
.banner-list-panel, .editor-panel { min-width: 0; border: 1px solid var(--gov-border); border-radius: 6px; background: #fff; padding: 18px; }
.panel-heading { display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; margin-bottom: 16px; }
.panel-heading h3 { margin: 0; color: var(--gov-text-primary); font-size: 15px; }
.panel-heading p { margin: 5px 0 0; color: var(--gov-text-secondary); font-size: 12px; }
.banner-list { display: flex; flex-direction: column; gap: 10px; }
.banner-list-item { display: grid; grid-template-columns: 92px minmax(0, 1fr) auto; gap: 11px; align-items: center; padding: 10px; border: 1px solid #e5e7eb; border-radius: 6px; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
.banner-list-item:hover { border-color: #b8c2cf; }
.banner-list-item.active { border-color: var(--gov-primary); box-shadow: 0 0 0 2px rgba(37, 99, 235, .08); }
.list-thumb { width: 92px; height: 52px; border-radius: 4px; background: #f4f5f7; }
.list-thumb.empty { display: grid; place-items: center; color: #a8abb2; font-size: 22px; }
.list-copy { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.list-copy strong, .list-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.list-copy strong { color: #1f2937; font-size: 13px; }
.list-copy span { color: #8b95a5; font-size: 11px; }
.order-actions { grid-column: 1 / -1; display: flex; justify-content: flex-end; border-top: 1px solid #f0f2f5; padding-top: 6px; }
.preview-shell { margin-bottom: 12px; }
.preview-banner { position: relative; overflow: hidden; width: 100%; aspect-ratio: 16 / 6.55; border-radius: 8px; background: linear-gradient(135deg, #fbf0e3, #fff7ef 44%, #efc48e); background-size: cover; background-position: center; box-shadow: 0 8px 24px rgba(120, 80, 40, .1); }
.preview-shade { position: absolute; inset: 0; background: linear-gradient(90deg, rgba(255, 250, 244, .96) 0%, rgba(255, 250, 244, .78) 36%, rgba(255, 250, 244, .04) 70%); }
.preview-copy { position: absolute; z-index: 1; top: 50%; left: 5%; width: 45%; transform: translateY(-50%); }
.preview-copy h2 { margin: 0; color: #382719; font-size: clamp(18px, 2vw, 30px); line-height: 1.25; }
.preview-copy p { margin: 8px 0 14px; color: #775c43; font-size: 13px; line-height: 1.5; }
.preview-copy span { display: inline-flex; padding: 7px 13px; border: 1px solid #bf8b55; border-radius: 999px; color: #8a5d2d; font-size: 12px; background: rgba(255,255,255,.7); }
.editor-tabs { margin-top: 10px; }
.banner-form { max-width: 760px; padding-top: 8px; }
.field-note { width: 100%; margin: 6px 0 0; color: #8b95a5; font-size: 12px; line-height: 19px; }
.inline-note { margin-left: 10px; color: #8b95a5; font-size: 12px; }
.ai-form :deep(.el-textarea) { max-width: 640px; }
@media (max-width: 1100px) { .banner-workspace { grid-template-columns: 1fr; } }
</style>
