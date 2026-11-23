/**
 * 通用认证请求工具（axios 401 刷新重放 + fetch token 注入）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. token 存储 key、刷新接口、登出行为全部配置化。
 *  2. 不写死 localStorage 具体键名，避免多项目冲突。
 */
import type { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';

export interface TokenStore {
  getToken: () => string | null;
  getRefreshToken?: () => string | null;
  setTokens: (access: string, refresh?: string) => void;
  clear: () => void;
}

/** 默认 localStorage 令牌存储（key 可配置） */
export function createTokenStore(keys = { access: 'token', refresh: 'refreshToken' }): TokenStore {
  return {
    getToken: () => localStorage.getItem(keys.access),
    getRefreshToken: () => localStorage.getItem(keys.refresh),
    setTokens: (access, refresh) => {
      localStorage.setItem(keys.access, access);
      if (refresh) localStorage.setItem(keys.refresh, refresh);
    },
    clear: () => { localStorage.removeItem(keys.access); localStorage.removeItem(keys.refresh); }
  };
}

export interface AuthRequestOptions {
  store: TokenStore;
  refreshUrl?: string;        // 默认 /api/refresh
  loginPath?: string;         // 刷新失败跳转，默认 /login
  onUnauthorized?: () => void; // 401 且刷新失败的回调（如清 store、跳登录）
  header?: string;            // 默认 Authorization
  scheme?: string;            // 默认 'Bearer'
}

/**
 * 给 axios 实例安装请求拦截（注入 token）与 401 刷新重放响应拦截。
 * 返回 uninstall 函数。
 */
export function installAuthInterceptors(axiosInstance: AxiosInstance, options: AuthRequestOptions) {
  const {
    store, refreshUrl = '/api/refresh', loginPath = '/login',
    onUnauthorized, header = 'Authorization', scheme = 'Bearer'
  } = options;
  let refreshing: Promise<string | null> | null = null;

  const onRequest = (config: InternalAxiosRequestConfig) => {
    const token = store.getToken();
    if (token) config.headers[header] = `${scheme} ${token}`;
    return config;
  };

  const doRefresh = async (): Promise<string | null> => {
    const refreshToken = store.getRefreshToken?.();
    try {
      const resp = await fetch(refreshUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });
      if (!resp.ok) return null;
      const data = await resp.json();
      const newToken = data?.data?.token || data?.token;
      if (newToken) {
        store.setTokens(newToken, data?.data?.refreshToken || data?.refreshToken);
        return newToken;
      }
      return null;
    } catch { return null; }
  };

  const onResponseError = async (error: any) => {
    const status = error?.response?.status;
    const original = error?.config as AxiosRequestConfig & { _retry?: boolean };
    if (status !== 401 || !original || original._retry) {
      // 刷新接口自身的 401：直接登出
      if (status === 401 && original?.url?.includes(refreshUrl)) {
        store.clear();
        if (onUnauthorized) onUnauthorized();
        else window.location.href = loginPath;
      }
      return Promise.reject(error);
    }
    original._retry = true;
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
    const newToken = await refreshing;
    if (newToken) {
      (original.headers as any)[header] = `${scheme} ${newToken}`;
      return axiosInstance(original);
    }
    store.clear();
    if (onUnauthorized) onUnauthorized();
    else window.location.href = loginPath;
    return Promise.reject(error);
  };

  const reqId = axiosInstance.interceptors.request.use(onRequest);
  const resId = axiosInstance.interceptors.response.use(r => r, onResponseError);

  return () => {
    axiosInstance.interceptors.request.eject(reqId);
    axiosInstance.interceptors.response.eject(resId);
  };
}

/**
 * 全局 fetch 包装：自动为相对 /api 请求注入 token（只包装一次）。
 */
export function installFetchToken(store: TokenStore, marker = '__authkit_fetch_wrapped__') {
  const w = window as any;
  if (w[marker]) return;
  w[marker] = true;
  const rawFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const headers = new Headers(init?.headers || {});
    if (url.startsWith('/api') && !headers.has('Authorization')) {
      const token = store.getToken();
      if (token) headers.set('Authorization', `Bearer ${token}`);
    }
    return rawFetch(input, { ...(init || {}), headers });
  };
}

export default { createTokenStore, installAuthInterceptors, installFetchToken };
