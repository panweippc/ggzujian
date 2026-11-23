import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import axios from 'axios';
import {
  createTokenStore, installAuthInterceptors, installFetchToken, startIdleDetector
} from '@panweippc/admin-ui/utils';
import App from './App.vue';
import router from './router';

// token 存储（key 可自定义，避免与其他系统冲突）
const store = createTokenStore({ access: 'token', refresh: 'refreshToken' });

// axios 拦截器（401 刷新需后端实现 /api/refresh，未实现时清理并跳登录）
const api = axios.create({ baseURL: '/api' });
installAuthInterceptors(api, {
  store,
  onUnauthorized: () => { store.clear(); router.push('/login'); }
});
installFetchToken(store); // 原生 fetch('/api/...') 自动带 token

// 空闲 30 分钟自动登出
startIdleDetector({
  timeout: 30 * 60 * 1000,
  loginPath: '/login',
  onTimeout: () => store.clear()
});

createApp(App).use(router).use(ElementPlus).mount('#app');
