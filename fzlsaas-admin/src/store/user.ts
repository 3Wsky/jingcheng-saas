import { defineStore } from 'pinia'
import request from '@/utils/request'

export const useUserStore = defineStore('user', {
  state: () => ({
    isLoggedIn: false,
    username: '',
    role: 'admin' as 'admin' | 'manager' | 'clerk' | 'merchant',
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
    },

    logout() {
      request.post('/admin/logout').catch(() => {})
      this.isLoggedIn = false
      this.username = ''
    },
  },
})
