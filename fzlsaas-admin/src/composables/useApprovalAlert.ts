import { ref, onMounted, onBeforeUnmount } from 'vue'
import { ElMessage, ElNotification } from 'element-plus'
import request from '@/utils/request'

const POLL_MS = 30_000
const STORAGE_MUTE = 'approval-voice-alert-muted'
const STORAGE_DESKTOP = 'approval-voice-alert-desktop'

/** 全局共享：布局与其它页面都能读到当前待终审数量 */
const pendingCount = ref(0)
// 首次使用必须由管理员主动点击开启，以满足浏览器的声音和通知授权要求。
const muted = ref(localStorage.getItem(STORAGE_MUTE) !== '0')
const desktopNotify = ref(localStorage.getItem(STORAGE_DESKTOP) !== '0')
const notificationPermission = ref<NotificationPermission | 'unsupported'>(
  typeof Notification === 'undefined' ? 'unsupported' : Notification.permission
)
const voiceUnlocked = ref(false)
const lastSpokenAt = ref(0)

let timer: ReturnType<typeof setInterval> | null = null
let knownIds = new Set<number>()
let bootstrapped = false
let started = false
let pollInFlight = false
let ownerCount = 0
let audioContext: AudioContext | null = null

function unlockVoice() {
  if (voiceUnlocked.value) return true
  if (typeof window === 'undefined' || !window.speechSynthesis) return false
  try {
    const u = new SpeechSynthesisUtterance('')
    u.volume = 0
    window.speechSynthesis.speak(u)

    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (Ctx && !audioContext) audioContext = new Ctx()
    audioContext?.resume().catch(() => {})
    voiceUnlocked.value = true
  } catch {
    return false
  }
  window.removeEventListener('pointerdown', unlockVoice)
  window.removeEventListener('keydown', unlockVoice)
  return true
}

function speak(text: string) {
  if (muted.value) return
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  try {
    window.speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    u.lang = 'zh-CN'
    u.rate = 1
    u.volume = 1
    const voices = window.speechSynthesis.getVoices()
    const zh =
      voices.find((v) => /zh-CN|zh_CN|Chinese/.test(v.lang) && /female|Xiaoxiao|Xiaoyi|Huihui|Tingting/i.test(v.name)) ||
      voices.find((v) => /zh-CN|zh_CN|Chinese/.test(v.lang))
    if (zh) u.voice = zh
    window.speechSynthesis.speak(u)
  } catch {
    /* ignore */
  }
}

function playBeep() {
  if (muted.value) return
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext
    if (!Ctx) return
    const ctx = audioContext || new Ctx()
    audioContext = ctx
    ctx.resume().catch(() => {})
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = 880
    g.gain.value = 0.0001
    o.connect(g)
    g.connect(ctx.destination)
    const now = ctx.currentTime
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.35)
    o.start(now)
    o.stop(now + 0.4)
  } catch {
    /* ignore */
  }
}

function notifyUi(newCount: number, total: number) {
  ElNotification({
    title: '待管理员终审',
    message: newCount > 0
      ? `新增 ${newCount} 条终审待办，当前共 ${total} 条，请及时处理`
      : `当前有 ${total} 条终审待办，请及时处理`,
    type: 'warning',
    duration: 8000,
    position: 'top-right',
    onClick: () => {
      location.hash = '#/approval?tab=pending'
    },
  })

  // 仅在用户已授权系统通知时推送；不主动弹权限窗
  if (desktopNotify.value && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      const n = new Notification('待管理员终审', {
        body: newCount > 0
          ? `新增 ${newCount} 条终审待办，当前共 ${total} 条`
          : `当前有 ${total} 条终审待办`,
        tag: 'approval-admin-todo',
      } as NotificationOptions)
      n.onclick = () => {
        window.focus()
        location.hash = '#/approval?tab=pending'
        n.close()
      }
    } catch {
      /* ignore */
    }
  }
}

function alertNew(newCount: number, total: number) {
  const now = Date.now()
  if (now - lastSpokenAt.value < 10_000) return
  lastSpokenAt.value = now

  playBeep()
  const text =
    newCount === 1
      ? `您有一条新的管理员终审待办，当前共 ${total} 条，请及时处理`
      : `您有 ${newCount} 条新的管理员终审待办，当前共 ${total} 条，请及时处理`
  speak(text)
  notifyUi(newCount, total)
}

async function pollOnce() {
  if (pollInFlight) return
  pollInFlight = true
  try {
    const data = await request.get('/api/admin/approval/todos', { silent: true })
    const rows: any[] = Array.isArray(data) ? data : []
    const ids = new Set<number>()
    for (const row of rows) {
      const id = Number(row.requestId ?? row.request_id ?? row.id)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    }
    pendingCount.value = ids.size

    if (!bootstrapped) {
      knownIds = ids
      bootstrapped = true
      return
    }

    let added = 0
    for (const id of ids) {
      if (!knownIds.has(id)) added += 1
    }
    knownIds = ids

    if (added > 0) {
      alertNew(added, ids.size)
    }
  } catch {
    // 会话失效等由 request 拦截器处理；轮询失败静默
  } finally {
    pollInFlight = false
  }
}

function onVisibility() {
  if (document.visibilityState === 'visible') {
    pollOnce()
  }
}

function startPolling() {
  if (started) return
  started = true
  window.addEventListener('pointerdown', unlockVoice, { once: true })
  window.addEventListener('keydown', unlockVoice, { once: true })
  document.addEventListener('visibilitychange', onVisibility)
  try {
    window.speechSynthesis?.getVoices()
    window.speechSynthesis?.addEventListener?.('voiceschanged', () => {
      window.speechSynthesis.getVoices()
    })
  } catch {
    /* ignore */
  }
  pollOnce()
  timer = setInterval(pollOnce, POLL_MS)
}

function stopPolling() {
  if (!started) return
  started = false
  bootstrapped = false
  knownIds = new Set()
  if (timer) {
    clearInterval(timer)
    timer = null
  }
  document.removeEventListener('visibilitychange', onVisibility)
  window.removeEventListener('pointerdown', unlockVoice)
  window.removeEventListener('keydown', unlockVoice)
  window.speechSynthesis?.cancel()
  audioContext?.close().catch(() => {})
  audioContext = null
  voiceUnlocked.value = false
}

function setMuted(v: boolean) {
  muted.value = v
  localStorage.setItem(STORAGE_MUTE, v ? '1' : '0')
  if (!v) unlockVoice()
}

function toggleMuted() {
  setMuted(!muted.value)
}

async function enableDesktopNotify() {
  if (typeof Notification === 'undefined') {
    notificationPermission.value = 'unsupported'
    return false
  }
  if (Notification.permission === 'granted') {
    notificationPermission.value = 'granted'
    desktopNotify.value = true
    localStorage.setItem(STORAGE_DESKTOP, '1')
    return true
  }
  if (Notification.permission === 'denied') {
    notificationPermission.value = 'denied'
    desktopNotify.value = false
    localStorage.setItem(STORAGE_DESKTOP, '0')
    return false
  }
  const perm = await Notification.requestPermission()
  notificationPermission.value = perm
  const ok = perm === 'granted'
  desktopNotify.value = ok
  localStorage.setItem(STORAGE_DESKTOP, ok ? '1' : '0')
  return ok
}

function testSpeak(text = '测试：您有一条新的管理员终审待办，请及时处理') {
  unlockVoice()
  playBeep()
  speak(text)
}

/** 由用户点击触发：解锁浏览器声音、申请桌面通知并立即测试播报。 */
async function activateAlerts() {
  setMuted(false)
  const voiceOk = unlockVoice()
  const text = pendingCount.value > 0
    ? `终审提醒已开启，当前有 ${pendingCount.value} 条待办，请及时处理`
    : '终审语音提醒已开启'
  testSpeak(text)

  const desktopOk = await enableDesktopNotify()
  if (!voiceOk) {
    ElMessage.warning('当前浏览器不支持语音播报')
  } else if (notificationPermission.value === 'denied') {
    ElMessage.warning('语音提醒已开启；桌面通知被浏览器阻止')
  } else if (notificationPermission.value === 'unsupported') {
    ElMessage.success('语音提醒已开启')
  } else {
    ElMessage.success(desktopOk ? '语音和桌面通知已开启' : '语音提醒已开启')
  }
}

async function toggleAlerts() {
  if (muted.value || !voiceUnlocked.value || notificationPermission.value === 'default') {
    await activateAlerts()
    return
  }
  setMuted(true)
  window.speechSynthesis?.cancel()
  ElMessage.info('语音提醒已关闭，桌面通知仍然保留')
}

/**
 * 仅在布局中调用：挂载时启动全局轮询，卸载（退出登录）时停止。
 */
export function useApprovalAlert() {
  onMounted(() => {
    ownerCount += 1
    startPolling()
  })
  onBeforeUnmount(() => {
    ownerCount = Math.max(0, ownerCount - 1)
    if (ownerCount === 0) stopPolling()
  })

  return {
    pendingCount,
    muted,
    desktopNotify,
    notificationPermission,
    voiceUnlocked,
    toggleAlerts,
    toggleMuted,
    setMuted,
    enableDesktopNotify,
    testSpeak,
    pollOnce,
  }
}

/**
 * 其它页面只读共享状态 / 手动刷新，不接管轮询生命周期。
 */
export function useApprovalAlertState() {
  return {
    pendingCount,
    muted,
    desktopNotify,
    notificationPermission,
    voiceUnlocked,
    toggleAlerts,
    toggleMuted,
    setMuted,
    enableDesktopNotify,
    testSpeak,
    pollOnce,
  }
}

export {
  pendingCount as approvalPendingCount,
  muted as approvalAlertMuted,
}
