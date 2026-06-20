export function fmtUnixTime(ts?: number | null): string {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString('zh-CN')
}

export function fmtMoney(val?: number | null): string {
  const n = Number(val || 0)
  return `¥${n.toFixed(2)}`
}
