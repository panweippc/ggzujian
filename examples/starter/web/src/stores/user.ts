/** 用户会话 store（轻量版，只保留骨架需要的字段） */
import { defineStore } from 'pinia';

function safeParse<T>(v: string | null, fallback: T): T {
  if (!v) return fallback;
  try { return JSON.parse(v) as T; } catch { return fallback; }
}

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    username: localStorage.getItem('username') || '',
    role: localStorage.getItem('role') || '',
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    displayName: (s) => s.username || '未登录',
  },
  actions: {
    setSession(payload: { token: string; username: string; role: string }) {
      this.token = payload.token;
      this.username = payload.username;
      this.role = payload.role;
      localStorage.setItem('token', payload.token);
      localStorage.setItem('username', payload.username);
      localStorage.setItem('role', payload.role);
    },
    logout() {
      this.token = '';
      this.username = '';
      this.role = '';
      localStorage.clear();
    },
  },
});
