const STORAGE_KEY = 'fzlsaas_recent_store_names'
const MAX_RECENT = 20

export function readRecentStoreNames(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const list = raw ? JSON.parse(raw) : []
    if (!Array.isArray(list)) return []
    return list.map((item) => String(item || '').trim()).filter(Boolean).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function rememberStoreName(name: string) {
  const value = String(name || '').trim()
  if (!value) return
  const next = [value, ...readRecentStoreNames().filter((item) => item !== value)].slice(0, MAX_RECENT)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

export function mergeStoreOptions(apiList: Array<{ id?: number; name: string; staffCount?: number }>, recent: string[] = readRecentStoreNames()) {
  const seen = new Set<string>()
  const merged: Array<{ id?: number; name: string; recent?: boolean; staffCount?: number }> = []

  recent.forEach((name) => {
    if (seen.has(name)) return
    seen.add(name)
    merged.push({ name, recent: true })
  })

  ;(apiList || []).forEach((item) => {
    const name = String(item.name || '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    merged.push({ id: item.id, name, staffCount: item.staffCount })
  })

  return merged
}
