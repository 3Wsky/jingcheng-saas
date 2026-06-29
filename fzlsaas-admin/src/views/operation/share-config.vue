<template>
  <PageShell
    title="小程序分享设置"
    subtitle="配置小程序首页「转发给好友 / 分享到朋友圈」的封面图、标题与简介（由本系统统一管理，无需 CRMEB）"
  >
    <template #actions>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存并生效</el-button>
    </template>

    <el-row :gutter="20">
      <el-col :xs="24" :md="14">
        <el-card shadow="never" v-loading="loading">
          <template #header><span>分享内容</span></template>

          <el-form label-width="92px" label-position="right">
            <el-form-item label="启用">
              <el-switch v-model="form.enabled" />
              <p class="hint">
                {{ form.enabled
                  ? '已启用：小程序首页分享将使用下方配置'
                  : '未启用：小程序首页分享回退到 CRMEB 默认配置' }}
              </p>
            </el-form-item>

            <el-form-item label="分享封面">
              <ImageUrlInput v-model="form.pic" placeholder="点击上传或粘贴图片 URL" />
            </el-form-item>
            <el-form-item label=" ">
              <p class="hint">
                建议尺寸 <b>5:4</b>（如 500×400），小于 <b>5MB</b>。微信转发卡片会按 5:4 裁剪显示，过大或过长的图可能显示不全。
              </p>
            </el-form-item>

            <el-form-item label="分享标题">
              <el-input
                v-model="form.title"
                maxlength="30"
                show-word-limit
                placeholder="如：您的专属手机管家"
              />
            </el-form-item>

            <el-form-item label="分享简介">
              <el-input
                v-model="form.desc"
                type="textarea"
                :rows="2"
                maxlength="60"
                show-word-limit
                placeholder="如：解决你所有的用机烦恼！（朋友圈/部分场景展示）"
              />
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :xs="24" :md="10">
        <el-card shadow="never" class="preview-card">
          <template #header><span>转发卡片预览</span></template>
          <p class="hint mb">微信「转发给好友」时朋友看到的样子：</p>

          <div class="wx-share">
            <div class="wx-share-text">
              <div class="wx-share-title">{{ form.title || '（未设置标题，将用 CRMEB 默认）' }}</div>
              <div class="wx-share-from">来自：锦程数码</div>
            </div>
            <div class="wx-share-thumb">
              <el-image v-if="form.pic" :src="previewSrc" fit="cover" class="thumb-img">
                <template #error>
                  <div class="thumb-empty">图片加载失败</div>
                </template>
              </el-image>
              <div v-else class="thumb-empty">未设置封面</div>
            </div>
          </div>

          <el-divider />
          <p class="hint">
            <el-icon><InfoFilled /></el-icon>
            保存后，用户<b>重新进入小程序首页</b>再转发即生效，<b>无需重新提审</b>。
          </p>
          <p class="hint" v-if="effective?.enabled">
            当前线上生效：<el-tag size="small" type="success">已启用自定义分享</el-tag>
          </p>
          <p class="hint" v-else>
            当前线上生效：<el-tag size="small" type="info">CRMEB 默认分享</el-tag>
          </p>
        </el-card>
      </el-col>
    </el-row>
  </PageShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { InfoFilled } from '@element-plus/icons-vue'
import request from '@/utils/request'
import PageShell from '@/components/PageShell.vue'
import ImageUrlInput from '@/components/ImageUrlInput.vue'

interface ShareRaw { pic: string; title: string; desc: string; enabled: boolean }

const loading = ref(false)
const saving = ref(false)
const form = ref<ShareRaw>({ pic: '', title: '', desc: '', enabled: false })
const effective = ref<{ enabled: boolean } | null>(null)

const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

// 预览：相对路径补成可访问 URL（后端存的是 /uploads/... 或 /api/file?p=...）
const previewSrc = computed(() => {
  const p = (form.value.pic || '').trim()
  if (!p) return ''
  if (/^(https?:)?\/\/|^data:|^blob:/i.test(p)) return p
  const path = p.startsWith('/') ? p : `/${p}`
  return `${API_BASE}${path}`
})

async function load() {
  loading.value = true
  try {
    const data = await request.get<ShareRaw>('/api/admin/config/miniapp-share')
    form.value = {
      pic: data?.pic || '',
      title: data?.title || '',
      desc: data?.desc || '',
      enabled: Boolean(data?.enabled),
    }
    // 同步读取「小程序实际拿到」的生效状态
    try {
      effective.value = await request.get<{ enabled: boolean }>('/api/miniapp/share')
    } catch { effective.value = null }
  } catch {
    /* handled by interceptor */
  } finally {
    loading.value = false
  }
}

async function save() {
  if (form.value.enabled && !form.value.pic.trim()) {
    ElMessage.warning('已启用自定义分享，请先设置分享封面图')
    return
  }
  saving.value = true
  try {
    await request.put('/api/admin/config/miniapp-share', {
      pic: form.value.pic.trim(),
      title: form.value.title.trim(),
      desc: form.value.desc.trim(),
      enabled: form.value.enabled,
    })
    ElMessage.success('分享配置已保存并生效')
    await load()
  } catch {
    /* handled */
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.hint { margin: 6px 0 0; font-size: 12px; color: rgba(0, 0, 0, 0.45); line-height: 18px; display: flex; align-items: center; gap: 4px; }
.hint.mb { margin-bottom: 12px; }
.preview-card { position: sticky; top: 12px; }

/* 模拟微信转发卡片 */
.wx-share {
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--gov-border, #ebeef5);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
  max-width: 340px;
}
.wx-share-text { min-width: 0; flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
.wx-share-title {
  font-size: 14px;
  color: #1a1a1a;
  line-height: 20px;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.wx-share-from { font-size: 11px; color: #b2b2b2; margin-top: 8px; }
.wx-share-thumb {
  width: 84px;
  height: 67px; /* 5:4 */
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
  background: #f5f7fa;
}
.thumb-img { width: 100%; height: 100%; }
.thumb-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: #c0c4cc;
  text-align: center;
}
</style>
