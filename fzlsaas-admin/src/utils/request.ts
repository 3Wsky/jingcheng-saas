import axios from 'axios'
import type { AxiosInstance } from 'axios'
import { ElMessage } from 'element-plus'
import router from '@/router'
import { useUserStore } from '@/store/user'

// 响应拦截器已解包 body.data，故对外方法返回的是业务数据(any)，
// 用该类型覆盖 axios 默认的 AxiosResponse 返回类型，便于在视图里直接取字段。
type DataInstance = Omit<AxiosInstance, 'get' | 'post' | 'put' | 'patch' | 'delete'> & {
  get<T = any>(url: string, config?: any): Promise<T>
  post<T = any>(url: string, data?: any, config?: any): Promise<T>
  put<T = any>(url: string, data?: any, config?: any): Promise<T>
  patch<T = any>(url: string, data?: any, config?: any): Promise<T>
  delete<T = any>(url: string, config?: any): Promise<T>
}

const instance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '',
  timeout: 30000,
  withCredentials: true,
})

instance.interceptors.response.use(
  (res) => {
    const data = res.data
    if (data && data.status !== undefined) {
      if (data.status === 200 || data.status === 1) return data.data !== undefined ? data.data : data
      ElMessage.error(data.msg || '请求失败')
      return Promise.reject(new Error(data.msg || '请求失败'))
    }
    return data
  },
  (err) => {
    if (err.response?.status === 401) {
      const userStore = useUserStore()
      userStore.logout()
      ElMessage.warning('登录已过期，请重新登录')
      if (router.currentRoute.value.path !== '/login') {
        router.push('/login')
      }
    } else {
      ElMessage.error(err.response?.data?.msg || err.message || '网络异常')
    }
    return Promise.reject(err)
  }
)

const request = instance as unknown as DataInstance
export default request
