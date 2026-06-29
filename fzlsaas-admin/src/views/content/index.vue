<template>
  <PageShell title="内容管理" subtitle="小程序「现金券使用须知」与「消费券活动说明」文案，修改后小程序实时生效">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="说明：以下内容会同步到小程序——「现金券使用须知」用于现金券钱包页弹窗，「消费券活动说明」用于现金券页底部的活动说明独立页。每一行为一条；保存后小程序下次打开即生效（无需重新提审）。"
      style="margin-bottom: 16px"
    />

    <el-row :gutter="20" v-loading="loading">
      <!-- 现金券使用须知 -->
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <span>现金券使用须知</span>
            <el-tag size="small" type="info" style="margin-left: 12px">现金券钱包弹窗</el-tag>
          </template>
          <el-form label-position="top">
            <el-form-item label="标题">
              <el-input v-model="terms.title" maxlength="30" placeholder="现金券使用须知" />
            </el-form-item>
            <el-form-item label="条款内容（每行一条）">
              <el-input
                v-model="termsText"
                type="textarea"
                :autosize="{ minRows: 12, maxRows: 30 }"
                placeholder="每行一条须知，留空行将被忽略"
              />
              <p class="hint">共 {{ termsLineCount }} 条</p>
            </el-form-item>
            <el-form-item>
              <el-button type="primary" :loading="savingTerms" @click="saveTerms">保存使用须知</el-button>
              <el-button :disabled="savingTerms" @click="resetTermsToDefault">恢复默认文案</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <!-- 消费券活动说明 -->
      <el-col :xs="24" :md="12">
        <el-card shadow="never">
          <template #header>
            <span>消费券活动说明</span>
            <el-tag size="small" type="info" style="margin-left: 12px">现金券页 · 独立页</el-tag>
          </template>
          <el-form label-position="top">
            <el-form-item label="活动名称">
              <el-input v-model="rules.activityName" maxlength="40" placeholder="米东区联盟消费券购机赠送活动" />
            </el-form-item>
            <el-form-item label="副标题">
              <el-input v-model="rules.subTitle" maxlength="40" placeholder="活动说明（最终审核版）" />
            </el-form-item>
            <el-form-item label="顶部重要提示（选填）">
              <el-input
                v-model="rules.notice"
                type="textarea"
                :autosize="{ minRows: 2, maxRows: 5 }"
                maxlength="500"
                show-word-limit
                placeholder="显示在活动说明页顶部的醒目提示语"
              />
            </el-form-item>
          </el-form>

          <el-divider content-position="left">分段内容</el-divider>
          <p class="hint" style="margin-bottom: 12px">每个分段含一个小标题 + 若干条款（条款每行一条）。可上下移动、删除、新增。</p>

          <div v-for="(sec, idx) in rules.sections" :key="idx" class="section-block">
            <div class="section-block-head">
              <span class="section-no">{{ idx + 1 }}</span>
              <el-input v-model="sec.title" size="small" maxlength="40" placeholder="分段标题，如：一、活动性质说明" class="section-title-input" />
              <div class="section-ops">
                <el-button link size="small" :disabled="idx === 0" @click="moveSection(idx, -1)">上移</el-button>
                <el-button link size="small" :disabled="idx === rules.sections.length - 1" @click="moveSection(idx, 1)">下移</el-button>
                <el-button link type="danger" size="small" @click="removeSection(idx)">删除</el-button>
              </div>
            </div>
            <el-input
              v-model="sec._text"
              type="textarea"
              :autosize="{ minRows: 3, maxRows: 20 }"
              placeholder="该分段下的条款，每行一条"
            />
          </div>

          <el-button style="margin-top: 12px" @click="addSection">+ 新增分段</el-button>

          <el-form-item style="margin-top: 16px">
            <el-button type="primary" :loading="savingRules" @click="saveRules">保存活动说明</el-button>
            <el-button :disabled="savingRules" @click="resetRulesToDefault">恢复默认文案</el-button>
          </el-form-item>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import request from '@/utils/request'
import { ElMessage, ElMessageBox } from 'element-plus'
import PageShell from '@/components/PageShell.vue'

interface TermsContent {
  title: string
  items: string[]
  updatedAt?: string
}
interface RuleSection {
  title: string
  items: string[]
  _text?: string
}
interface RulesContent {
  activityName: string
  subTitle: string
  notice: string
  sections: RuleSection[]
  updatedAt?: string
}

const loading = ref(false)
const savingTerms = ref(false)
const savingRules = ref(false)

const terms = ref<TermsContent>({ title: '现金券使用须知', items: [] })
const termsText = ref('')
const rules = ref<RulesContent>({ activityName: '', subTitle: '', notice: '', sections: [] })

let defaultTerms: TermsContent | null = null
let defaultRules: RulesContent | null = null

const termsLineCount = computed(() => textToLines(termsText.value).length)

function textToLines(text: string): string[] {
  return String(text || '')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function linesToText(items: string[]): string {
  return (items || []).join('\n')
}

function hydrateRules(data: RulesContent): RulesContent {
  return {
    activityName: data.activityName || '',
    subTitle: data.subTitle || '',
    notice: data.notice || '',
    updatedAt: data.updatedAt,
    sections: (data.sections || []).map((s) => ({
      title: s.title || '',
      items: s.items || [],
      _text: linesToText(s.items || []),
    })),
  }
}

onMounted(load)

async function load() {
  loading.value = true
  try {
    const data = await request.get('/api/miniapp/content')
    terms.value = { title: data.cashVoucherTerms?.title || '现金券使用须知', items: data.cashVoucherTerms?.items || [] }
    termsText.value = linesToText(terms.value.items)
    rules.value = hydrateRules(data.activityRules || { activityName: '', subTitle: '', notice: '', sections: [] })
    // 缓存一份默认（即首次接口返回，含后端内置默认文案）用于「恢复默认」
    if (!defaultTerms) defaultTerms = JSON.parse(JSON.stringify(terms.value))
    if (!defaultRules) defaultRules = JSON.parse(JSON.stringify(rules.value))
  } catch {
    /* handled by interceptor */
  } finally {
    loading.value = false
  }
}

async function saveTerms() {
  const items = textToLines(termsText.value)
  if (!items.length) {
    ElMessage.warning('请至少填写一条须知')
    return
  }
  savingTerms.value = true
  try {
    await request.put('/api/admin/config/mp-content', {
      cashVoucherTerms: { title: terms.value.title || '现金券使用须知', items },
    })
    ElMessage.success('现金券使用须知已保存')
  } catch {
    /* handled */
  } finally {
    savingTerms.value = false
  }
}

async function saveRules() {
  const sections = rules.value.sections
    .map((s) => ({ title: (s.title || '').trim(), items: textToLines(s._text || '') }))
    .filter((s) => s.title || s.items.length)
  if (!sections.length) {
    ElMessage.warning('请至少填写一个分段')
    return
  }
  savingRules.value = true
  try {
    await request.put('/api/admin/config/mp-content', {
      activityRules: {
        activityName: rules.value.activityName || '米东区联盟消费券购机赠送活动',
        subTitle: rules.value.subTitle || '',
        notice: rules.value.notice || '',
        sections,
      },
    })
    ElMessage.success('消费券活动说明已保存')
  } catch {
    /* handled */
  } finally {
    savingRules.value = false
  }
}

function addSection() {
  rules.value.sections.push({ title: '', items: [], _text: '' })
}
function removeSection(idx: number) {
  rules.value.sections.splice(idx, 1)
}
function moveSection(idx: number, dir: number) {
  const target = idx + dir
  if (target < 0 || target >= rules.value.sections.length) return
  const arr = rules.value.sections
  ;[arr[idx], arr[target]] = [arr[target], arr[idx]]
}

async function resetTermsToDefault() {
  try {
    await ElMessageBox.confirm('恢复为系统内置的默认须知文案？（保存后才会写入）', '恢复默认', { type: 'warning' })
  } catch {
    return
  }
  if (defaultTerms) {
    terms.value = JSON.parse(JSON.stringify(defaultTerms))
    termsText.value = linesToText(terms.value.items)
  }
}

async function resetRulesToDefault() {
  try {
    await ElMessageBox.confirm('恢复为系统内置的默认活动说明文案？（保存后才会写入）', '恢复默认', { type: 'warning' })
  } catch {
    return
  }
  if (defaultRules) {
    rules.value = JSON.parse(JSON.stringify(defaultRules))
  }
}
</script>

<style scoped>
.hint { font-size: 12px; color: #9CA3AF; margin: 4px 0 0; line-height: 1.5; }
.section-block { padding: 12px; margin-bottom: 12px; border: 1px solid #ebeef5; border-radius: 8px; background: #fafafa; }
.section-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.section-no {
  flex: 0 0 auto; width: 22px; height: 22px; line-height: 22px; text-align: center;
  border-radius: 50%; background: #e6b84e; color: #fff; font-size: 12px; font-weight: 700;
}
.section-title-input { flex: 1 1 auto; }
.section-ops { flex: 0 0 auto; white-space: nowrap; }
</style>
