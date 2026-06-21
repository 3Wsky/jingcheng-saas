import request from '@/utils/request'

/** 分页拉取全量列表（单页最大 100，与后端 zod 校验一致） */
export async function fetchAllPages<T = any>(
  url: string,
  baseParams: Record<string, unknown> = {},
  pageSize = 100
): Promise<T[]> {
  const all: T[] = []
  let page = 1
  let total = Infinity

  while (all.length < total) {
    const data = await request.get(url, {
      params: { ...baseParams, page, pageSize },
    })
    const list: T[] = data?.list || []
    total = Number(data?.total ?? list.length)
    all.push(...list)
    if (!list.length || list.length < pageSize) break
    page += 1
  }

  return all
}
