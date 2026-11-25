/**
 * API 层 —— 只暴露 starter 后端真实实现的接口。
 * 新项目接自己的后端时，在这里加函数即可；组件不直接写 axios。
 */
import axios from 'axios';

export const api = axios.create({ baseURL: '/api', timeout: 30000 });

// 请求拦截：自动带 token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers = config.headers || {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 全链路追踪：保存最近一个响应头中的 Trace ID，供日志页检索
let lastTraceId = '';
export const getLastTraceId = () => lastTraceId;

// 响应拦截：401 清理并跳登录（starter 后端未实现 /api/refresh，故直接登出）
api.interceptors.response.use(
  (response) => {
    const tid = response.headers?.['x-request-id'];
    if (tid) lastTraceId = tid;
    return response;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 401 && window.location.pathname !== '/login') {
      localStorage.clear();
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// ===== 认证 =====
export const getCaptcha = async () => {
  const r = await api.get('/captcha'); // { success, data: { token, svg } }
  return { token: r.data.data.token, svg: r.data.data.svg };
};

export interface LoginResult {
  success: boolean;
  message?: string;
  data?: { token: string; username: string; role: string };
}

export const login = (payload: { username: string; password: string; captcha: string; captchaToken: string }) =>
  api.post('/login', payload).then((r) => r.data as LoginResult);

export const getHealth = () => api.get('/health').then((r) => r.data);

// 当前用户权限（RBAC 执行层）
export interface MyPermissions {
  isAdmin: boolean;
  role: string;
  roleName: string;
  menus: string[];
  buttons: string[];
  dataScope: 'all' | 'dept' | 'self';
  department: string;
}
export const getMyPermissions = () => api.get('/me/permissions').then((r) => ({
  success: r.data.success, data: r.data.data as MyPermissions
}));

// 天气（后端代理转发 open-meteo，避免浏览器直连被墙）
export const getWeather = () => api.get('/weather').then((r) => r.data as { success: boolean; data: { temp: number; code: number } | null });

// ===== 用户管理 =====
export const getUsers = (p?: { page?: number; pageSize?: number }) =>
  api.get('/users', { params: p }).then((r) => ({
    success: r.data.success,
    data: r.data.data || [],
    total: (r.data.data || []).length,
  }));

export const createUser = (form: { username: string; password: string; role?: string }) =>
  api.post('/users', form).then((r) => r.data);

// ===== 操作日志 + 全链路追踪 =====
export const getLogs = (p: { page?: number; pageSize?: number; module?: string; action?: string; traceId?: string }) =>
  api.get('/logs', { params: p }).then((r) => ({
    success: r.data.success,
    data: r.data.data || [],
    total: r.data.total || 0,
  }));

// ===== 消息通知中心 =====
export interface NotificationItem {
  id: number;
  recipient: string;
  type: string;
  title: string;
  content: string;
  link: string | null;
  isRead: number;
  createdAt: string;
}
export const getNotifications = (limit = 50) =>
  api.get('/notifications', { params: { limit } }).then((r) => ({
    success: r.data.success,
    data: (r.data.data || []) as NotificationItem[],
  }));
export const getNotificationUnreadCount = () =>
  api.get('/notifications/unread-count').then((r) => (r.data?.data?.count || 0) as number);
export const markNotificationRead = (id: number) =>
  api.post(`/notifications/${id}/read`).then((r) => r.data);
export const markAllNotificationsRead = () =>
  api.post('/notifications/read-all').then((r) => r.data);
export const deleteNotification = (id: number) =>
  api.delete(`/notifications/${id}`).then((r) => r.data);

// ===== 安全事件监控 =====
export const getSecurityAlerts = (p: { level?: string; type?: string; limit?: number } = {}) =>
  api.get('/security-alerts', { params: p }).then((r) => r.data);

// ===== 数据字典 =====
export interface DictItem { id: number; category: string; label: string; value: string; sort: number; status: number; remark: string | null }
export interface DictCategory { id: number; code: string; name: string; description: string | null; sort: number; status: number }
export const getDictItems = (category?: string, all = false) =>
  api.get('/dict-items', { params: { category, all: all ? '1' : '0' } }).then((r) => r.data);
export const batchGetDictItems = (categories: string[], all = false) =>
  api.post('/dict-items/batch', { categories, all }).then((r) => r.data);
export const createDictItem = (form: Partial<DictItem>) => api.post('/dict-items', form).then((r) => r.data);
export const updateDictItem = (id: number, form: Partial<DictItem>) => api.put(`/dict-items/${id}`, form).then((r) => r.data);
export const deleteDictItem = (id: number) => api.delete(`/dict-items/${id}`).then((r) => r.data);
export const getDictCategories = () => api.get('/dict-categories').then((r) => r.data);
export const createDictCategory = (form: Partial<DictCategory>) => api.post('/dict-categories', form).then((r) => r.data);
export const updateDictCategory = (id: number, form: Partial<DictCategory>) => api.put(`/dict-categories/${id}`, form).then((r) => r.data);
export const deleteDictCategory = (id: number) => api.delete(`/dict-categories/${id}`).then((r) => r.data);

// ===== 公共基础数据 =====
export interface BaseDataItem {
  id: number; type: string; code: string; name: string; parentCode: string | null;
  sort: number; status: number; remark: string | null; children?: BaseDataItem[];
}
export const getBaseData = (params?: { type?: string; parentCode?: string; all?: boolean }) =>
  api.get('/base-data', { params: { ...params, all: params?.all ? '1' : undefined } }).then((r) => r.data);
export const getBaseDataTree = (type: string) => api.get('/base-data/tree', { params: { type } }).then((r) => r.data);
export const createBaseData = (form: Partial<BaseDataItem>) => api.post('/base-data', form).then((r) => r.data);
export const updateBaseData = (id: number, form: Partial<BaseDataItem>) => api.put(`/base-data/${id}`, form).then((r) => r.data);
export const deleteBaseData = (id: number) => api.delete(`/base-data/${id}`).then((r) => r.data);

// ===== 配置中心 =====
export interface AppConfig { id: number; configKey: string; configValue: string; category: string; env: string; version: number; description: string | null; updatedBy: string | null; updatedAt: string }
export const getConfigs = (category?: string, env?: string) => api.get('/configs', { params: { category, env } }).then((r) => r.data);
export const saveConfig = (key: string, form: { configValue: string; description?: string }, env?: string) => api.put(`/configs/${key}`, { ...form, env }).then((r) => r.data);
export const createConfig = (form: Partial<AppConfig>) => api.post('/configs', form).then((r) => r.data);
export const deleteConfig = (key: string, env?: string) => api.delete(`/configs/${key}`, { params: { env } }).then((r) => r.data);
// 配置历史与回滚（多环境）
export const getConfigHistory = (key: string, env: string) => api.get(`/configs/${key}/history`, { params: { env } }).then((r) => r.data);
export const rollbackConfig = (key: string, version: number, env: string) => api.post(`/configs/${key}/rollback`, { version, env }).then((r) => r.data);

// ===== 定时任务 =====
export interface ScheduledTask { id: number; taskName: string; taskKey: string; cron: string; description: string | null; enabled: number; lastRunAt: string | null; lastStatus: string | null }
export const getTasks = () => api.get('/tasks').then((r) => r.data);
export const toggleTask = (id: number, enabled: boolean) => api.put(`/tasks/${id}/toggle`, { enabled }).then((r) => r.data);
export const createTask = (form: Partial<ScheduledTask>) => api.post('/tasks', form).then((r) => r.data);
export const updateTask = (id: number, form: Partial<ScheduledTask>) => api.put(`/tasks/${id}`, form).then((r) => r.data);
export const deleteTask = (id: number) => api.delete(`/tasks/${id}`).then((r) => r.data);

// ===== 在线会话 =====
export interface UserSession { id: number; username: string; tokenVersion: number; ipAddress: string | null; userAgent: string | null; loginAt: string; lastActiveAt: string }
export const getSessions = () => api.get('/sessions').then((r) => r.data);
export const kickSession = (id: number) => api.delete(`/sessions/${id}`).then((r) => r.data);

// ===== IP 白名单 =====
export interface IpEntry { id: number; ip: string; remark: string | null; createdAt: string }
export const getIpWhitelist = () => api.get('/ip-whitelist').then((r) => r.data);
export const addIpWhitelist = (form: { ip: string; remark?: string }) => api.post('/ip-whitelist', form).then((r) => r.data);
export const deleteIpWhitelist = (id: number) => api.delete(`/ip-whitelist/${id}`).then((r) => r.data);
export const checkIp = () => api.get('/ip-check').then((r) => r.data);

// ===== 系统监控 =====
export const getMonitor = () => api.get('/monitor').then((r) => r.data);

// ===== TOTP 二次验证 =====
export const getTotpStatus = () => api.get('/totp/status').then((r) => r.data);
export const setupTotp = () => api.post('/totp/setup').then((r) => r.data);
export const enableTotp = (token: string) => api.post('/totp/enable', { token }).then((r) => r.data);
export const disableTotp = (token: string) => api.post('/totp/disable', { token }).then((r) => r.data);

// ===== 统一文件服务 =====
export const uploadFile = (file: File) => {
  const fd = new FormData();
  fd.append('file', file);
  return api.post('/files/upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
};
export const getFiles = (params?: { page?: number; pageSize?: number }) => api.get('/files', { params }).then((r) => r.data);
export const deleteFile = (key: string) => api.delete(`/files/${key}`).then((r) => r.data);
// 预览/下载走 axios blob，自动带 Bearer token（window.open 无法带自定义头）
export const previewFile = (key: string) =>
  api.get(`/files/${key}/preview`, { responseType: 'blob' }).then((r) => URL.createObjectURL(r.data as Blob));
export const downloadFile = async (key: string, filename: string) => {
  const resp = await api.get(`/files/${key}/download`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data as Blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
};

// ===== 统一消息通道（B档预留）=====
export const sendMessage = (form: { channel: string; to?: string; title: string; content?: string; link?: string; type?: string }) =>
  api.post('/messages/send', form).then((r) => r.data);
export const getMessageChannels = () => api.get('/messages/channels').then((r) => r.data);
export const getMessageLogs = (limit = 50) => api.get('/messages/logs', { params: { limit } }).then((r) => r.data);

// ===== 文件驱动热切换（方案A：配置入库 + 生效）=====
export const getFileDriver = () => api.get('/files/driver').then((r) => r.data);
export const switchFileDriver = (driver: string) => api.put('/files/driver', { driver }).then((r) => r.data);

// ===== 全局回收站 =====
export const getRecycleBin = (params: { page?: number; pageSize?: number; keyword?: string; module?: string }) =>
  api.get('/recycle-bin', { params }).then((r) => r.data);
export const getRecycleModules = () => api.get('/recycle-bin/modules').then((r) => r.data);
export const restoreRecycleItem = (id: number) => api.post(`/recycle-bin/${id}/restore`).then((r) => r.data);
export const purgeRecycleItem = (id: number) => api.delete(`/recycle-bin/${id}`).then((r) => r.data);

// ===== 平台化能力（工作流 / 表单 / 报表 / 租户 / 合规 / 集成）=====
export const platformApi = {
  workflows: () => api.get('/workflows').then((r) => r.data),
  createWorkflow: (form: any) => api.post('/workflows', form).then((r) => r.data),
  startWorkflow: (code: string, form: any) => api.post(`/workflows/${code}/start`, form).then((r) => r.data),
  myInstances: () => api.get('/workflows/instances').then((r) => r.data),
  instanceDetail: (id: number) => api.get(`/workflows/instances/${id}`).then((r) => r.data),
  myTasks: () => api.get('/workflows/tasks/mine').then((r) => r.data),
  handleTask: (id: number, form: any) => api.post(`/workflows/tasks/${id}/handle`, form).then((r) => r.data),
  formSchemas: () => api.get('/form-schemas').then((r) => r.data),
  saveFormSchema: (form: any) => api.post('/form-schemas', form).then((r) => r.data),
  reports: () => api.get('/reports').then((r) => r.data),
  reportData: (code: string) => api.get(`/reports/${code}/data`).then((r) => r.data),
  tenants: () => api.get('/tenants').then((r) => r.data),
  plans: () => api.get('/plans').then((r) => r.data),
  classifications: () => api.get('/classifications').then((r) => r.data),
  saveClassification: (form: any) => api.post('/classifications', form).then((r) => r.data),
  encrypt: (value: string) => api.post('/classifications/encrypt', { value }).then((r) => r.data),
  decrypt: (cipher: string) => api.post('/classifications/decrypt', { cipher }).then((r) => r.data),
  delegations: () => api.get('/delegations').then((r) => r.data),
  saveDelegation: (form: any) => api.post('/delegations', form).then((r) => r.data),
  subscriptions: () => api.get('/event-subscriptions').then((r) => r.data),
  saveSubscription: (form: any) => api.post('/event-subscriptions', form).then((r) => r.data),
  etl: () => api.get('/etl').then((r) => r.data),
  saveEtl: (form: any) => api.post('/etl', form).then((r) => r.data),
  apiKeys: () => api.get('/api-keys').then((r) => r.data),
  createApiKey: (form: any) => api.post('/api-keys', form).then((r) => r.data),
};

// ===== 稳定性 / 可观测 / AI =====
export const opsApi = {
  status: () => api.get('/platform/status').then((r) => r.data),
  circuit: () => api.get('/resilience/circuit').then((r) => r.data),
  cacheStats: () => api.get('/resilience/cache/stats').then((r) => r.data),
  featureFlags: () => api.get('/feature-flags').then((r) => r.data),
  logs: (file: string, lines: number) => api.get('/observability/logs', { params: { file, lines } }).then((r) => r.data),
  traces: () => api.get('/observability/traces').then((r) => r.data),
  sampling: () => api.get('/observability/sampling').then((r) => r.data),
  ueba: () => api.get('/ueba/alerts').then((r) => r.data),
  chat: (messages: any[]) => api.post('/ai/chat', { messages }).then((r) => r.data),
  rag: (query: string) => api.post('/ai/rag/search', { query }).then((r) => r.data),
  nl2sql: (question: string) => api.post('/ai/nl2sql', { question }).then((r) => r.data),
  inspect: () => api.get('/ai/inspect').then((r) => r.data),
};

export default api;
