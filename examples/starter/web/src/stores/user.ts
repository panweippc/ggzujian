/** 用户会话 store：账号信息 + RBAC 权限上下文 */
import { defineStore } from 'pinia';
import { getMyPermissions, type MyPermissions } from '../services/api';

const DEFAULT_PERMS: MyPermissions = {
  isAdmin: false, role: '', roleName: '', menus: [], buttons: [], dataScope: 'self', department: ''
};

export const useUserStore = defineStore('user', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    username: localStorage.getItem('username') || '',
    role: localStorage.getItem('role') || '',
    perms: null as MyPermissions | null,
    permsLoaded: false,
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    displayName: (s) => s.username || '未登录',
    // 权限上下文：未加载时用空权限（安全默认值），避免放行
    permissions: (s): MyPermissions => s.perms || DEFAULT_PERMS,
  },
  actions: {
    setSession(payload: { token: string; username: string; role: string }) {
      this.token = payload.token;
      this.username = payload.username;
      this.role = payload.role;
      this.perms = null;
      this.permsLoaded = false;
      localStorage.setItem('token', payload.token);
      localStorage.setItem('username', payload.username);
      localStorage.setItem('role', payload.role);
    },
    // 拉取并缓存权限；failed 时保持空权限（最小权限）
    async loadPermissions(force = false) {
      if (!this.token) return DEFAULT_PERMS;
      if (this.permsLoaded && !force) return this.permissions;
      try {
        const res = await getMyPermissions();
        this.perms = res.data || DEFAULT_PERMS;
      } catch {
        this.perms = DEFAULT_PERMS;
      }
      this.permsLoaded = true;
      return this.permissions;
    },
    // 菜单权限：admin 全放行；否则按 path 精确/前缀匹配
    canVisit(path: string): boolean {
      const p = this.permissions;
      if (p.isAdmin || p.menus.includes('*')) return true;
      return p.menus.some((m) => m === path || (m !== '/' && path.startsWith(m + '/')));
    },
    // 按钮权限：admin 全放行
    can(buttonKey: string): boolean {
      const p = this.permissions;
      return p.isAdmin || p.buttons.includes('*') || p.buttons.includes(buttonKey);
    },
    logout() {
      this.token = '';
      this.username = '';
      this.role = '';
      this.perms = null;
      this.permsLoaded = false;
      localStorage.clear();
    },
  },
});
