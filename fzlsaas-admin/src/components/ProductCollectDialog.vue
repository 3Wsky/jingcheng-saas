<template>

  <el-dialog v-model="visible" :title="title" width="720px" destroy-on-close @closed="reset">

    <el-tabs v-model="activeTab">

      <!-- 展示商品：价签 -->

      <el-tab-pane v-if="mode === 'showcase'" label="价签采集" name="priceTag">

        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">

          从 digital-price-tag-generator 价签 JSON 同步手机/DJI 展示商品（只读展示，不支持发货）。

        </el-alert>

        <el-form label-width="88px">

          <el-form-item label="导入后">

            <el-radio-group v-model="importShow">

              <el-radio :value="true">默认上架展示</el-radio>

              <el-radio :value="false">放入仓库</el-radio>

            </el-radio-group>

          </el-form-item>

        </el-form>

      </el-tab-pane>



      <!-- 展示商品：CRMEB -->

      <el-tab-pane v-if="mode === 'showcase'" label="CRMEB商品" name="crmeb">

        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 12px">

          从旧程序 eb_store_product 批量导入展示商品，按商品 ID 幂等合并。

        </el-alert>

        <el-form :inline="true" @submit.prevent="searchCrmeb">

          <el-form-item label="搜索">

            <el-input v-model="crmebKeyword" placeholder="名称/ID" clearable style="width: 200px" />

          </el-form-item>

          <el-form-item>

            <el-button type="primary" @click="searchCrmeb">查询</el-button>

            <el-button link type="primary" @click="selectAllCrmebPage">全选本页</el-button>

          </el-form-item>

        </el-form>

        <el-table

          ref="crmebTableRef"

          :data="crmebList"

          v-loading="crmebLoading"

          height="280"

          @selection-change="onCrmebSelect"

        >

          <el-table-column type="selection" width="42" />

          <el-table-column prop="id" label="ID" width="64" />

          <el-table-column prop="storeName" label="商品名称" min-width="180" show-overflow-tooltip />

          <el-table-column label="售价" width="88" align="right">

            <template #default="{ row }">¥{{ row.price }}</template>

          </el-table-column>

        </el-table>

        <div class="pager">

          <el-pagination

            v-model:current-page="crmebPage"

            :page-size="crmebPageSize"

            :total="crmebTotal"

            layout="total, prev, pager, next"

            @current-change="loadCrmeb"

          />

        </div>

        <el-form label-width="88px" style="margin-top: 12px">

          <el-form-item label="导入后">

            <el-radio-group v-model="importShow">

              <el-radio :value="true">默认上架</el-radio>

              <el-radio :value="false">放入仓库</el-radio>

            </el-radio-group>

          </el-form-item>

        </el-form>

        <p v-if="selectedCrmebIds.length" class="hint">已选 {{ selectedCrmebIds.length }} 件</p>

      </el-tab-pane>



      <!-- 展示商品：链接 -->

      <el-tab-pane v-if="mode === 'showcase'" label="链接采集" name="url">

        <el-form label-width="88px">

          <el-form-item label="商品链接">

            <el-input v-model="collectUrl" placeholder="https://..." />

          </el-form-item>

          <el-form-item label="平台">

            <el-select v-model="platform" style="width: 100%">

              <el-option label="淘宝/天猫" value="taobao" />

              <el-option label="京东" value="jd" />

              <el-option label="拼多多" value="pdd" />

              <el-option label="其他" value="other" />

            </el-select>

          </el-form-item>

        </el-form>

        <el-alert type="warning" :closable="false" title="链接解析下一版接入，当前可先使用价签/CRMEB 采集" />

      </el-tab-pane>



      <!-- 积分：展示商品批量 -->

      <el-tab-pane v-if="mode === 'integral'" label="展示商品" name="showcase">

        <el-form :inline="true" @submit.prevent="loadShowcase">

          <el-form-item label="搜索">

            <el-input v-model="showcaseKeyword" placeholder="名称" clearable style="width: 200px" />

          </el-form-item>

          <el-form-item>

            <el-button type="primary" @click="loadShowcase">刷新</el-button>

            <el-button link type="primary" @click="selectAllShowcase">全选列表</el-button>

          </el-form-item>

        </el-form>

        <el-table

          ref="showcaseTableRef"

          :data="filteredShowcase"

          height="300"

          @selection-change="onShowcaseSelect"

        >

          <el-table-column type="selection" width="42" />

          <el-table-column prop="storeName" label="商品名称" min-width="200" show-overflow-tooltip />

          <el-table-column label="售价" width="88" align="right">

            <template #default="{ row }">¥{{ row.price }}</template>

          </el-table-column>

          <el-table-column label="来源" width="80">

            <template #default="{ row }">{{ sourceLabel(row.source) }}</template>

          </el-table-column>

        </el-table>

        <p class="hint">导入后默认放入仓库，积分价 = max(1000, 售价×10)，可在编辑页调整。</p>

        <p v-if="selectedShowcaseIds.length" class="hint">已选 {{ selectedShowcaseIds.length }} 件</p>

      </el-tab-pane>



      <!-- 积分：CRMEB -->

      <el-tab-pane v-if="mode === 'integral'" label="CRMEB商品" name="crmeb">

        <el-form :inline="true" @submit.prevent="searchCrmeb">

          <el-form-item label="搜索">

            <el-input v-model="crmebKeyword" placeholder="名称/ID" clearable style="width: 200px" />

          </el-form-item>

          <el-form-item>

            <el-button type="primary" @click="searchCrmeb">查询</el-button>

            <el-button link type="primary" @click="selectAllCrmebPage">全选本页</el-button>

          </el-form-item>

        </el-form>

        <el-table

          ref="crmebTableRef"

          :data="crmebList"

          v-loading="crmebLoading"

          height="280"

          @selection-change="onCrmebSelect"

        >

          <el-table-column type="selection" width="42" />

          <el-table-column prop="id" label="ID" width="64" />

          <el-table-column prop="storeName" label="商品名称" min-width="180" show-overflow-tooltip />

          <el-table-column label="售价" width="88" align="right">

            <template #default="{ row }">¥{{ row.price }}</template>

          </el-table-column>

        </el-table>

        <div class="pager">

          <el-pagination

            v-model:current-page="crmebPage"

            :page-size="crmebPageSize"

            :total="crmebTotal"

            layout="total, prev, pager, next"

            @current-change="loadCrmeb"

          />

        </div>

        <p v-if="selectedCrmebIds.length" class="hint">已选 {{ selectedCrmebIds.length }} 件，将写入 eb_store_integral 并关联 product_id</p>

      </el-tab-pane>



      <!-- 积分：价签一键 -->

      <el-tab-pane v-if="mode === 'integral'" label="价签转积分" name="priceTagIntegral">

        <el-alert type="info" :closable="false" show-icon style="margin-bottom: 16px">

          先同步价签到展示商品库，再将本次采集的商品批量转为积分商品（默认仓库、跳过已存在）。

        </el-alert>

        <el-form label-width="100px">

          <el-form-item label="展示商品">

            <el-radio-group v-model="priceTagShowcaseShow">

              <el-radio :value="false">放入仓库</el-radio>

              <el-radio :value="true">同步后上架</el-radio>

            </el-radio-group>

          </el-form-item>

        </el-form>

      </el-tab-pane>



      <!-- 积分：链接 -->

      <el-tab-pane v-if="mode === 'integral'" label="链接采集" name="url">

        <el-form label-width="88px">

          <el-form-item label="商品链接">

            <el-input v-model="collectUrl" placeholder="https://..." />

          </el-form-item>

        </el-form>

        <el-alert type="warning" :closable="false" title="链接解析下一版接入" />

      </el-tab-pane>

    </el-tabs>



    <div v-if="result" class="collect-result">

      <template v-if="result.createdCount != null || result.updatedCount != null">

        <p>新增 {{ result.createdCount ?? 0 }} / 更新 {{ result.updatedCount ?? 0 }}</p>

        <p v-if="result.files?.length" class="muted">

          文件：{{ result.files.map((f: any) => f.fileName).join('、') }}

        </p>

        <p v-if="result.sourceLabel" class="muted">来源：{{ result.sourceLabel }}</p>

      </template>

      <template v-else-if="result.skippedCount != null">

        <p>新增 {{ result.createdCount ?? 0 }} · 跳过 {{ result.skippedCount ?? 0 }}</p>

        <p v-if="result.priceTagImport" class="muted">

          价签：新增 {{ result.priceTagImport.createdCount ?? 0 }} / 更新 {{ result.priceTagImport.updatedCount ?? 0 }}

        </p>

      </template>

    </div>



    <template #footer>

      <el-button @click="visible = false">取消</el-button>

      <el-button type="primary" :loading="loading" @click="submit">

        {{ submitLabel }}

      </el-button>

    </template>

  </el-dialog>

</template>



<script setup lang="ts">

import { ref, computed, watch } from 'vue'

import request from '@/utils/request'

import { ElMessage } from 'element-plus'



const props = defineProps<{

  modelValue: boolean

  mode: 'showcase' | 'integral'

}>()

const emit = defineEmits<{ 'update:modelValue': [boolean]; success: [] }>()



const visible = computed({

  get: () => props.modelValue,

  set: (v) => emit('update:modelValue', v)

})



const title = computed(() => (props.mode === 'showcase' ? '商品采集' : '积分商品采集'))

const activeTab = ref('priceTag')

const importShow = ref(true)

const priceTagShowcaseShow = ref(false)

const collectUrl = ref('')

const platform = ref('taobao')

const loading = ref(false)

const result = ref<any>(null)



const showcaseList = ref<any[]>([])

const showcaseKeyword = ref('')

const selectedShowcaseIds = ref<string[]>([])

const showcaseTableRef = ref()



const crmebList = ref<any[]>([])

const crmebLoading = ref(false)

const crmebKeyword = ref('')

const crmebPage = ref(1)

const crmebPageSize = 20

const crmebTotal = ref(0)

const selectedCrmebIds = ref<number[]>([])

const crmebTableRef = ref()



const filteredShowcase = computed(() => {

  const kw = showcaseKeyword.value.trim().toLowerCase()

  if (!kw) return showcaseList.value

  return showcaseList.value.filter((p) =>

    String(p.storeName || '').toLowerCase().includes(kw)

  )

})



const submitLabel = computed(() => {

  if (activeTab.value === 'url') return '提交采集'

  if (activeTab.value === 'crmeb') return selectedCrmebIds.value.length ? `导入 ${selectedCrmebIds.value.length} 件` : '导入所选'

  if (activeTab.value === 'showcase' && props.mode === 'integral') {

    return selectedShowcaseIds.value.length ? `导入 ${selectedShowcaseIds.value.length} 件` : '导入所选'

  }

  if (activeTab.value === 'priceTagIntegral') return '价签采集并转积分'

  return '开始采集'

})



watch(() => props.modelValue, (open) => {

  if (!open) return

  result.value = null

  if (props.mode === 'integral') {

    activeTab.value = 'showcase'

    loadShowcase()

  } else {

    activeTab.value = 'priceTag'

  }

})



watch(activeTab, (tab) => {

  if (tab === 'crmeb' && !crmebList.value.length) loadCrmeb()

})



function sourceLabel(s: string) {

  const map: Record<string, string> = {

    crmeb: 'CRMEB',

    official: '价签',

    dji: 'DJI'

  }

  return map[s] || s || '-'

}



async function loadShowcase() {

  try {

    const data = await request.get('/api/admin/products', { params: { status: 'all' } })

    showcaseList.value = data?.list || []

  } catch {

    showcaseList.value = []

  }

}



async function loadCrmeb() {

  crmebLoading.value = true

  try {

    const data = await request.get('/api/admin/crmeb-products', {

      params: { page: crmebPage.value, pageSize: crmebPageSize, keyword: crmebKeyword.value || undefined }

    })

    crmebList.value = data?.list || []

    crmebTotal.value = data?.total || 0

  } catch {

    crmebList.value = []

  } finally {

    crmebLoading.value = false

  }

}



function searchCrmeb() {

  crmebPage.value = 1

  loadCrmeb()

}



function onCrmebSelect(rows: any[]) {

  selectedCrmebIds.value = rows.map((r) => Number(r.id)).filter(Boolean)

}



function onShowcaseSelect(rows: any[]) {

  selectedShowcaseIds.value = rows.map((r) => String(r.id))

}



function selectAllCrmebPage() {

  crmebTableRef.value?.toggleAllSelection?.()

}



function selectAllShowcase() {

  showcaseTableRef.value?.toggleAllSelection?.()

}



function reset() {

  collectUrl.value = ''

  selectedShowcaseIds.value = []

  selectedCrmebIds.value = []

  result.value = null

  loading.value = false

  showcaseKeyword.value = ''

  crmebKeyword.value = ''

}



async function submit() {

  loading.value = true

  try {

    if (activeTab.value === 'priceTag') {

      result.value = await request.post('/api/admin/products/collect', { isShow: importShow.value })

      ElMessage.success('价签采集完成')

      emit('success')

      return

    }



    if (activeTab.value === 'crmeb') {

      if (!selectedCrmebIds.value.length) {

        ElMessage.warning('请勾选 CRMEB 商品')

        return

      }

      const api = props.mode === 'showcase'

        ? '/api/admin/products/collect-from-crmeb'

        : '/api/admin/integral-mall/products/collect-from-crmeb'

      result.value = await request.post(api, {

        ids: selectedCrmebIds.value,

        isShow: props.mode === 'showcase' ? importShow.value : false

      })

      ElMessage.success(result.value?.message || '导入完成')

      emit('success')

      return

    }



    if (activeTab.value === 'showcase' && props.mode === 'integral') {

      if (!selectedShowcaseIds.value.length) {

        ElMessage.warning('请勾选展示商品')

        return

      }

      result.value = await request.post('/api/admin/integral-mall/products/collect-batch-showcase', {

        showcaseIds: selectedShowcaseIds.value

      })

      ElMessage.success(`导入完成：新增 ${result.value?.createdCount ?? 0}`)

      emit('success')

      return

    }



    if (activeTab.value === 'priceTagIntegral') {

      result.value = await request.post('/api/admin/integral-mall/products/collect-from-price-tags', {

        isShow: priceTagShowcaseShow.value

      })

      ElMessage.success(`完成：积分新增 ${result.value?.createdCount ?? 0}`)

      emit('success')

      return

    }



    const url = collectUrl.value.trim()

    if (!url) {

      ElMessage.warning('请输入商品链接')

      return

    }

    const api = props.mode === 'showcase'

      ? '/api/admin/products/collect-url'

      : '/api/admin/integral-mall/products/collect-url'

    const data = await request.post(api, { url, platform: platform.value })

    ElMessage.info(data?.message || '已提交，解析能力下一版接入')

  } catch { /* handled */ }

  finally { loading.value = false }

}

</script>



<style scoped>

.collect-result { font-size: 13px; margin-top: 12px; padding: 8px 12px; background: #f6ffed; border-radius: 6px; }

.muted { color: rgba(0,0,0,0.45); }

.hint { font-size: 12px; color: rgba(0,0,0,0.45); margin-top: 8px; }

.pager { margin-top: 8px; display: flex; justify-content: flex-end; }

</style>

