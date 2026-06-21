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
              <el-radio value="import">从展示商品导入</el-radio>
            </el-radio-group>
            <p class="field-hint block-hint">
              {{ createMode === 'manual'
                ? '无需先在商品管理上架，直接填写标题、主图、积分价与库存即可独立上架积分商品。'
                : '从已上架展示商品快速导入信息，可在此基础上调整积分价与库存。' }}
            </p>
          </el-form-item>
          <el-form-item v-if="createMode === 'import'" label="选择商品" required>
            <div class="pick-box" @click="selectOpen = true">
              <el-image v-if="form.image" :src="form.image" style="width:80px;height:80px" fit="cover" />
              <div v-else class="pick-placeholder"><el-icon><Goods /></el-icon><span>点击选择已上架展示商品</span></div>
            </div>
            <p v-if="form.showcaseId" class="hint">展示商品 ID：{{ form.showcaseId }} · {{ form.title }}</p>
            <p v-if="form.productId" class="hint muted">关联 CRMEB ID：{{ form.productId }}</p>
          </el-form-item>
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
        <el-form label-width="80px">
          <el-form-item label="内容">
            <LazyRichTextEditor v-model="form.description" placeholder="编辑商品详情，支持图文排版" />
          </el-form-item>
          <el-form-item label="预览">
            <div class="detail-preview" v-html="form.description || '<p style=color:#999>暂无内容</p>'" />
          </el-form-item>
        </el-form>
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
const createMode = ref<'manual' | 'import'>('manual')
const skuList = ref<any[]>([])
const selectedSkus = ref<any[]>([])

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
  }
})

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
  if (current.value === 1 && !form.value.title.trim()) {
    ElMessage.warning('请填写商品标题')
    return
  }
  if (current.value === 1 && createMode.value === 'manual' && !form.value.image?.trim() && !form.value.images.filter(Boolean).length) {
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
.detail-preview {
  width: 280px; min-height: 400px; border: 1px solid #f0f0f0; border-radius: 8px;
  padding: 12px; background: #fafafa; overflow: auto; font-size: 13px;
}
.step-footer { display: flex; justify-content: center; gap: 12px; padding-top: 24px; border-top: 1px solid #f0f0f0; margin-top: 16px; }
.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 8px; }
</style>
