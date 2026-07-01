<template>
  <div class="integral-edit-page">
    <div class="edit-header">
      <el-button link @click="goBack"><el-icon><ArrowLeft /></el-icon> 返回</el-button>
      <span class="divider">|</span>
      <span class="title">{{ isEdit ? '编辑积分商品' : '添加积分商品' }}</span>
      <el-tag type="warning" size="small" style="margin-left: 12px">本地核销 · 无物流</el-tag>
    </div>

    <div class="edit-panel">
      <div class="step-bar">
        <div v-for="(s, idx) in stepList" :key="idx" class="step-item" :class="{ active: current === idx, done: current > idx }">
          <span class="step-no">{{ idx + 1 }}</span>
          <span>{{ s }}</span>
        </div>
      </div>

      <!-- Step 0: 创建方式 -->
      <div v-show="current === 0" class="step-body">
        <el-form label-width="110px">
          <el-form-item label="创建方式" required>
            <el-radio-group v-model="createMode">
              <el-radio value="manual">手动创建（独立上架）</el-radio>
              <el-radio value="ai">AI 拍照生成（门店实拍）</el-radio>
              <el-radio value="import">从展示商品导入</el-radio>
            </el-radio-group>
            <p class="field-hint block-hint">{{ createModeHint }}</p>
          </el-form-item>
          <el-form-item v-if="createMode === 'import'" label="选择商品" required>
            <div class="pick-box" @click="selectOpen = true">
              <el-image v-if="form.image" :src="form.image" style="width:80px;height:80px" fit="cover" />
              <div v-else class="pick-placeholder"><el-icon><Goods /></el-icon><span>点击选择已上架展示商品</span></div>
            </div>
            <p v-if="form.showcaseId" class="hint">展示商品 ID：{{ form.showcaseId }} · {{ form.title }}</p>
            <p v-if="form.productId" class="hint muted">关联 CRMEB ID：{{ form.productId }}</p>
          </el-form-item>

          <template v-if="createMode === 'ai'">
            <el-form-item label="门店实拍照片" required>
              <ImageUrlInput v-model="aiPhoto" placeholder="上传门店实拍照片或粘贴图片 URL" />
              <p class="field-hint block-hint">上传你店里拍的商品照片（背景可杂乱），AI 会基于真实商品生成纯白底电商主图与竖版详情长图。</p>
            </el-form-item>
            <el-form-item label="商品名称">
              <el-input v-model="form.title" maxlength="80" show-word-limit style="width: 480px" placeholder="如：华为 Mate 70 Pro 玻光绿（可留空）" />
            </el-form-item>
            <el-form-item label="店内售价(元)">
              <el-input-number v-model="aiStorePrice" :min="0" :step="50" />
              <span class="field-hint">你店里的实际售价，用于换算积分价</span>
            </el-form-item>
            <el-form-item label="积分倍率">
              <el-input-number v-model="aiMultiplier" :min="1" :max="1000" />
              <span class="field-hint">积分价 = 店内售价 × 倍率（默认 ×10，下一步仍可手动改）</span>
            </el-form-item>
            <el-form-item label="详情图数量">
              <el-input-number v-model="aiDetailCount" :min="0" :max="4" />
              <span class="field-hint">竖版 AI 详情长图 0~4 张，数量越多耗时越长</span>
            </el-form-item>
            <el-form-item label=" ">
              <el-button type="primary" :loading="aiGenerating" :disabled="!aiConfigured || !aiPhoto" @click="generateAi">
                {{ aiGenerating ? 'AI 生成中…（约 30~120 秒，请勿离开）' : '开始 AI 生成' }}
              </el-button>
              <span v-if="!aiConfigured" class="field-hint" style="color:#e6a23c">AI 生图服务未配置，请联系管理员在后端设置图片接口</span>
              <span v-else-if="aiDone" class="field-hint" style="color:#67c23a">✓ 已生成，点「下一步」查看并调整积分价/库存</span>
            </el-form-item>
            <el-form-item v-if="aiDone" label="生成预览">
              <div class="ai-preview">
                <el-image :src="form.image" fit="cover" class="ai-main" />
                <el-image v-for="(img, i) in aiDetailPreview" :key="i" :src="img" fit="cover" class="ai-thumb" />
              </div>
            </el-form-item>
          </template>
        </el-form>
      </div>

      <!-- Step 1: 基础信息 -->
      <div v-show="current === 1" class="step-body">
        <el-form :model="form" label-width="135px" class="edit-form">
          <el-form-item label="商品主图" required>
            <ImageUrlInput v-model="form.image" placeholder="图片 URL" />
          </el-form-item>
          <el-form-item label="商品轮播图">
            <ImageListInput v-model="form.images" :max="9" />
            <p class="field-hint">建议 800×800，最多 9 张，首张为主图</p>
          </el-form-item>
          <el-form-item label="商品标题" required>
            <el-input v-model="form.title" maxlength="80" show-word-limit style="width: 480px" />
          </el-form-item>
          <el-form-item label="用户兑换数量限制" required>
            <el-input-number v-model="form.num" :min="1" />
            <span class="field-hint">每个用户本次活动最多可兑换总数</span>
          </el-form-item>
          <el-form-item label="单位" required>
            <el-input v-model="form.unitName" style="width: 160px" />
          </el-form-item>
          <el-form-item label="排序">
            <el-input-number v-model="form.sort" />
          </el-form-item>
          <el-form-item label="上架状态">
            <el-radio-group v-model="form.isShow">
              <el-radio :value="true">开启</el-radio>
              <el-radio :value="false">关闭</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="热门推荐">
            <el-radio-group v-model="form.isHost">
              <el-radio :value="true">开启</el-radio>
              <el-radio :value="false">关闭</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="单次兑换限制">
            <el-input-number v-model="form.onceNum" :min="1" />
          </el-form-item>

          <template v-if="form.specType === 0">
            <el-form-item label="兑换积分" required>
              <el-input-number v-model="form.price" :min="0" :step="100" />
            </el-form-item>
            <el-form-item label="库存" required>
              <el-input-number v-model="form.stock" :min="0" />
            </el-form-item>
          </template>

          <el-form-item v-else label="规格选择">
            <el-table :data="skuList" border @selection-change="onSkuSelect">
              <el-table-column type="selection" width="48" />
              <el-table-column prop="suk" label="规格" min-width="160" />
              <el-table-column label="图片" width="72">
                <template #default="{ row }">
                  <el-image v-if="row.image" :src="row.image" style="width:36px;height:36px" fit="cover" />
                </template>
              </el-table-column>
              <el-table-column label="兑换积分" width="140">
                <template #default="{ row }">
                  <el-input-number v-model="row.integralPrice" :min="0" size="small" />
                </template>
              </el-table-column>
              <el-table-column label="限购" width="120">
                <template #default="{ row }">
                  <el-input-number v-model="row.integralQuota" :min="1" size="small" />
                </template>
              </el-table-column>
              <el-table-column prop="stock" label="库存" width="80" />
            </el-table>
          </el-form-item>
        </el-form>
      </div>

      <!-- Step 2: 商品详情 -->
      <div v-show="current === 2" class="step-body detail-step">
        <div class="detail-layout">
          <div class="detail-editor">
            <div class="detail-label">商品详情内容</div>
            <LazyRichTextEditor
              v-model="form.description"
              placeholder="编辑商品详情，支持图文排版（可直接粘贴图片）"
              :height="520"
              max-width="100%"
            />
          </div>
          <div class="detail-preview-col">
            <div class="detail-label">手机预览</div>
            <div class="detail-preview" v-html="safeDescriptionHtml" />
          </div>
        </div>
      </div>

      <div class="step-footer">
        <el-button v-if="current > 0" @click="prev">上一步</el-button>
        <el-button v-if="current < 2" type="primary" @click="next">下一步</el-button>
        <el-button v-if="current === 2" type="primary" :loading="saving" @click="save">提交</el-button>
      </div>
    </div>

    <ShowcaseProductSelectDialog v-model="selectOpen" @select="onProductSelected" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import request from '@/utils/request'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Goods } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import ShowcaseProductSelectDialog from '@/components/ShowcaseProductSelectDialog.vue'
import ImageUrlInput from '@/components/ImageUrlInput.vue'
import ImageListInput from '@/components/ImageListInput.vue'
import LazyRichTextEditor from '@/components/LazyRichTextEditor'

const route = useRoute()
const router = useRouter()
const productId = computed(() => route.params.id ? Number(route.params.id) : null)
const isEdit = computed(() => !!productId.value)

const stepList = ['创建方式', '填写基础信息', '修改商品详情']
const current = ref(0)
const saving = ref(false)
const selectOpen = ref(false)
const createMode = ref<'manual' | 'import' | 'ai'>('manual')
const skuList = ref<any[]>([])
const selectedSkus = ref<any[]>([])

// AI 拍照生成相关
const aiPhoto = ref('')
const aiStorePrice = ref(0)
const aiMultiplier = ref(10)
const aiDetailCount = ref(2)
const aiGenerating = ref(false)
const aiConfigured = ref(true)
const aiDone = ref(false)
const aiDetailPreview = ref<string[]>([])

// 详情预览用 v-html 直出，而 description 可能来自"从展示商品导入"（CRMEB/官网采集/CSV 等外部数据源），
// 不能假设内容可信——先过 DOMPurify 净化，避免被投毒的商品详情在管理员会话里跑出 XSS。
const safeDescriptionHtml = computed(() => {
  const raw = form.value.description || '<p style="color:#999">暂无内容</p>'
  return DOMPurify.sanitize(raw)
})

const createModeHint = computed(() => {
  if (createMode.value === 'ai') return '上传门店实拍照片，AI 自动生成纯白底电商主图与竖版详情长图，并按店内售价×倍率换算积分价，一步生成积分礼品。'
  if (createMode.value === 'import') return '从已上架展示商品快速导入信息，可在此基础上调整积分价与库存。'
  return '无需先在商品管理上架，直接填写标题、主图、积分价与库存即可独立上架积分商品。'
})

const defaultForm = () => ({
  showcaseId: '',
  productId: 0,
  title: '',
  image: '',
  images: [] as string[],
  price: 0,
  stock: 0,
  unitName: '件',
  isShow: true,
  sort: 0,
  isHost: false,
  quota: 0,
  onceNum: 1,
  num: 1,
  description: '',
  specType: 0,
  attrs: [] as any[]
})

const form = ref(defaultForm())

onMounted(async () => {
  if (productId.value) {
    current.value = 1
    await loadProduct()
  } else {
    checkAiStatus()
  }
})

async function checkAiStatus() {
  try {
    const data = await request.get('/api/admin/integral-mall/ai-gift/status')
    aiConfigured.value = !!data?.configured
  } catch {
    aiConfigured.value = false
  }
}

async function generateAi() {
  if (!aiPhoto.value) {
    ElMessage.warning('请先上传门店实拍照片')
    return
  }
  aiGenerating.value = true
  aiDone.value = false
  try {
    const data = await request.post('/api/admin/integral-mall/ai-gift/generate', {
      photo: aiPhoto.value,
      productName: form.value.title || '',
      storePrice: aiStorePrice.value || 0,
      multiplier: aiMultiplier.value || 10,
      detailCount: aiDetailCount.value
    }, { timeout: 600000 })
    form.value.image = data.mainImage || ''
    form.value.images = Array.isArray(data.sliderImages) && data.sliderImages.length
      ? data.sliderImages
      : (data.mainImage ? [data.mainImage] : [])
    form.value.description = data.description || ''
    form.value.specType = 0
    if (data.suggestedIntegral > 0) form.value.price = data.suggestedIntegral
    if (!form.value.stock) form.value.stock = 100
    aiDetailPreview.value = Array.isArray(data.detailImages) ? data.detailImages : []
    aiDone.value = true
    ElMessage.success('AI 生成完成，请点「下一步」核对积分价与库存')
  } catch {
    /* handled by interceptor */
  } finally {
    aiGenerating.value = false
  }
}

async function loadProduct() {
  const data = await request.get(`/api/admin/integral-mall/products/${productId.value}`)
  form.value = { ...defaultForm(), ...data, images: data.images?.length ? data.images : (data.image ? [data.image] : []) }
  if (data.productId) await loadSkus(data.productId, data.attrs)
}

async function loadSkus(crmebId: number, savedAttrs: any[] = []) {
  const detail = await request.get(`/api/admin/crmeb-products/${crmebId}`)
  form.value.specType = detail.specType || 0
  skuList.value = (detail.skus || []).map((s: any) => {
    const saved = savedAttrs.find((a) => a.unique === s.unique || a.suk === s.suk)
    return {
      ...s,
      integralPrice: saved?.integralPrice ?? Math.max(1000, Number(s.price || 0) * 10),
      integralQuota: saved?.integralQuota ?? 1
    }
  })
  if (savedAttrs.length) selectedSkus.value = skuList.value.filter((s) => savedAttrs.some((a) => a.unique === s.unique))
}

function onProductSelected(detail: any) {
  form.value.showcaseId = detail.id
  form.value.productId = Number(detail.crmebId || 0)
  form.value.title = detail.storeName
  form.value.image = detail.image
  form.value.images = detail.sliderImages?.length ? [...detail.sliderImages] : (detail.image ? [detail.image] : [])
  form.value.unitName = detail.unitName || '件'
  form.value.sort = detail.sort || 0
  form.value.description = detail.description || detail.storeInfo || ''
  form.value.specType = detail.specType || 0
  if (detail.specType === 0 || !detail.crmebId) {
    form.value.price = Math.max(1000, Number(detail.price || 0) * 10)
    form.value.stock = detail.stock || 100
    skuList.value = []
    form.value.specType = 0
  } else {
    loadSkus(Number(detail.crmebId))
  }
}

function onSkuSelect(rows: any[]) {
  selectedSkus.value = rows
}

function goBack() {
  router.push('/integral-mall')
}

function prev() {
  if (current.value > 0) current.value -= 1
}

function next() {
  if (current.value === 0 && createMode.value === 'import' && !form.value.showcaseId) {
    ElMessage.warning('请先选择已上架展示商品，或切换为「手动创建」')
    return
  }
  if (current.value === 0 && createMode.value === 'ai' && !aiDone.value) {
    ElMessage.warning('请先点「开始 AI 生成」生成商品图片')
    return
  }
  if (current.value === 1 && !form.value.title.trim()) {
    ElMessage.warning('请填写商品标题')
    return
  }
  if (current.value === 1 && createMode.value !== 'import' && !form.value.image?.trim() && !form.value.images.filter(Boolean).length) {
    ElMessage.warning('请上传商品主图')
    return
  }
  if (current.value < 2) current.value += 1
}

async function save() {
  if (createMode.value === 'import' && !form.value.showcaseId) {
    ElMessage.warning('请先选择已上架展示商品，或切换为「手动创建」')
    current.value = 0
    return
  }
  if (!form.value.title.trim()) {
    ElMessage.warning('请填写商品标题')
    current.value = 1
    return
  }
  if (!form.value.image?.trim() && !form.value.images.filter(Boolean).length) {
    ElMessage.warning('请上传商品主图')
    current.value = 1
    return
  }
  saving.value = true
  const payload: any = {
    ...form.value,
    productId: form.value.productId || undefined,
    showcaseId: createMode.value === 'import' ? form.value.showcaseId : undefined,
    images: form.value.images.filter(Boolean),
    image: form.value.image || form.value.images[0] || ''
  }
  if (form.value.specType === 1) {
    payload.attrs = selectedSkus.value.map((s) => ({
      id: s.id,
      suk: s.suk,
      unique: s.unique,
      integralPrice: s.integralPrice,
      integralQuota: s.integralQuota,
      stock: s.stock,
      image: s.image
    }))
    if (!payload.attrs.length) {
      ElMessage.warning('请勾选至少一个规格')
      saving.value = false
      return
    }
  }
  try {
    if (productId.value) {
      await request.put(`/api/admin/integral-mall/products/${productId.value}`, payload)
    } else {
      const data = await request.post('/api/admin/integral-mall/products', payload)
      router.replace(`/integral-mall/edit/${data.id}`)
    }
    ElMessage.success('保存成功')
    goBack()
  } catch { /* handled */ }
  finally { saving.value = false }
}
</script>

<style scoped>
.integral-edit-page { min-height: 100%; }
.edit-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; font-weight: 600; }
.divider { color: #d9d9d9; font-weight: 400; }
.edit-panel { background: #fff; border: 1px solid #f0f0f0; border-radius: 2px; padding: 20px; }
.step-bar { display: flex; justify-content: center; gap: 48px; margin-bottom: 28px; }
.step-item { display: flex; align-items: center; gap: 8px; color: rgba(0,0,0,0.45); font-size: 14px; }
.step-item.active { color: var(--el-color-primary); font-weight: 600; }
.step-item.done { color: rgba(0,0,0,0.65); }
.step-no {
  width: 28px; height: 28px; border-radius: 50%; border: 1px solid currentColor;
  display: inline-flex; align-items: center; justify-content: center; font-size: 13px;
}
.step-body { min-height: 360px; }
.pick-box {
  width: 120px; height: 120px; border: 1px dashed #d9d9d9; border-radius: 4px;
  display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.pick-placeholder { text-align: center; color: #999; font-size: 12px; }
.field-hint { margin-left: 12px; font-size: 12px; color: rgba(0,0,0,0.45); }
.block-hint { display: block; margin: 8px 0 0; margin-left: 0 !important; max-width: 520px; line-height: 1.6; }
.detail-step { min-height: 560px; }
.detail-layout { display: flex; gap: 24px; align-items: flex-start; }
.detail-editor { flex: 1 1 auto; min-width: 0; }
.detail-preview-col { flex: 0 0 320px; }
.detail-label { font-size: 13px; font-weight: 600; color: rgba(0,0,0,0.75); margin-bottom: 10px; }
.detail-preview {
  width: 320px; height: 560px; border: 1px solid #f0f0f0; border-radius: 8px;
  padding: 14px; background: #fafafa; overflow-y: auto; font-size: 13px; box-sizing: border-box;
}
.detail-preview :deep(img) { max-width: 100%; height: auto; display: block; }
@media (max-width: 1100px) {
  .detail-layout { flex-direction: column; }
  .detail-preview-col { flex: none; width: 100%; }
  .detail-preview { width: 100%; height: 360px; }
}
.step-footer { display: flex; justify-content: center; gap: 12px; padding-top: 24px; border-top: 1px solid #f0f0f0; margin-top: 16px; }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 8px; }
.ai-preview { display: flex; flex-wrap: wrap; gap: 10px; }
.ai-preview .ai-main { width: 120px; height: 120px; border-radius: 6px; border: 2px solid var(--el-color-primary); }
.ai-preview .ai-thumb { width: 90px; height: 120px; border-radius: 6px; border: 1px solid #f0f0f0; }
</style>
