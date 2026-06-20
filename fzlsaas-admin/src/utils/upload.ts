import request from '@/utils/request'

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const data = await request.post<{ url: string }>('/api/admin/upload/image', form)
  if (!data?.url) throw new Error('上传失败')
  return data.url
}
