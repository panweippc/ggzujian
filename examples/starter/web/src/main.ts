import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import './assets/styles/variables.css';
import './assets/styles/themes.css';
import './assets/styles/responsive.css';
import axios from 'axios';
import {
  createTokenStore, installAuthInterceptors, installFetchToken, startIdleDetector
} from '@panweippc/admin-ui/utils';
import App from './App.vue';
import router from './router';
import { useUserStore } from './stores/user';

// token 存储（key 与 services/api.ts、stores/user.ts 保持一致：token）
const store = createTokenStore({ access: 'token', refresh: 'refreshToken' });

// axios 拦截器（401 刷新需后端实现 /api/refresh，未实现时清理并跳登录）
const api = axios.create({ baseURL: '/api' });
installAuthInterceptors(api, {
  store,
  onUnauthorized: () => { store.clear(); router.push('/login'); }
});
installFetchToken(store); // 原生 fetch('/api/...') 自动带 token

// 空闲 30 分钟自动登出（RBAC 底座能力）
startIdleDetector({
  timeout: 30 * 60 * 1000,
  loginPath: '/login',
  onTimeout: () => store.clear()
});

const app = createApp(App);
const pinia = createPinia();
app.use(pinia).use(router).use(ElementPlus, { locale: zhCn });

// v-perm 按钮级权限指令：无权限则移除元素（admin 全放行）
app.directive('perm', {
  mounted(el, binding) {
    if (binding.value && !useUserStore(pinia).can(binding.value)) el.parentNode?.removeChild(el);
  }
});

app.mount('#app');
