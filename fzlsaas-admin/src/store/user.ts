import { defineStore } from 'pinia'
import request from '@/utils/request'

export const useUserStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false,
    username: '',
    role: 'admin' as 'admin' | 'manager' | 'clerk' | 'merchant',
    isSuperAdmin: true,
    _checked: false,
  }),

  actions: {
    async login(username: string, password: string) {
      const formData = new URLSearchParams()
      formData.append('username', username)
      formData.append('password', password)

      await request.post('/admin/login', formData.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        maxRedirects: 0,
        validateStatus: (s: number) => s < 400,
      })

      this.isLoggedIn = true
      this.username = username
      this.role = 'admin'
      this._checked = true
      try {
        const me: any = await request.get('/api/admin/me')
        this.isSuperAdmin = me?.isSuperAdmin !== false
      } catch { this.isSuperAdmin = true }
    },

    logout() {
      request.post('/admin/logout').catch(() => {})
      this.isLoggedIn = false
      this.username = ''
      this._checked = true
    },

    async checkSession(): Promise<boolean> {
      if (this._checked) return this.isLoggedIn
      try {
        const data: any = await request.get('/api/admin/me')
        this.isLoggedIn = true
        this.username = data?.username || 'admin'
        this.role = 'admin'
        this.isSuperAdmin = data?.isSuperAdmin !== false
      } catch {
        this.isLoggedIn = false
        this.username = ''
      }
      this._checked = true
      return this.isLoggedIn
    },
  },
})
