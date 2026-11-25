/** PWA Service Worker 注册（仅生产环境启用，避免开发期缓存干扰 HMR） */
export function registerPWA() {
  if (!('serviceWorker' in navigator)) return { registered: false, reason: 'unsupported' };
  if (import.meta.env.DEV) return { registered: false, reason: 'dev-mode' };
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* 注册失败不影响应用 */ });
  });
  return { registered: true };
}
