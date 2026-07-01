/** 默认近 N 天日期范围（YYYY-MM-DD，供 el-date-picker） */
export function lastNDaysRange(days = 7): [string, string] {
  const end = new Date()
  const start = new Date()
  start.setDate(end.getDate() - (days - 1))
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return [fmt(start), fmt(end)]
}

/** 日期字符串 → 当日 00:00 / 23:59:59 Unix 秒 */
export function dateRangeToUnix(range: [string, string] | null): { startAt?: number; endAt?: number } {
  if (!range?.[0] || !range?.[1]) return {}
  const startAt = Math.floor(new Date(`${range[0]}T00:00:00`).getTime() / 1000)
  const endAt = Math.floor(new Date(`${range[1]}T23:59:59`).getTime() / 1000)
  return { startAt, endAt }
}

/** 某月(YYYY-MM 或 Date)的起止日期 [该月1号, 该月最后一天]（YYYY-MM-DD） */
export function monthRange(month: string | Date): [string, string] {
  const d = typeof month === 'string' ? new Date(`${month}-01T00:00:00`) : month
  const y = d.getFullYear()
  const m = d.getMonth()
  const first = new Date(y, m, 1)
  const last = new Date(y, m + 1, 0)
  const fmt = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
  return [fmt(first), fmt(last)]
}
