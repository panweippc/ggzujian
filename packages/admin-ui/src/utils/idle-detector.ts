/**
 * 会话空闲超时检测（通用版，无 socket 业务依赖）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. 移除写死的 disconnectSocket() 依赖，改为 onTimeout 回调注入。
 *  2. 登录页路径、清理策略可配置。
 */
let lastActivity = Date.now();
let timer: number | null = null;
let enabled = false;

const DEFAULT_TIMEOUT = 30 * 60 * 1000; // 30 分钟
const EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel'];

const onActivity = () => { lastActivity = Date.now(); };

interface IdleOptions {
  timeout?: number;          // 空闲阈值毫秒，默认 30 分钟
  checkInterval?: number;    // 检查周期毫秒，默认 60 秒
  loginPath?: string;        // 超时跳转的登录页，默认 /login
  onTimeout?: () => void;    // 超时回调（如停止 socket、清 store）
  clearStorage?: boolean;    // 是否清理 localStorage，默认 true
  reason?: string;           // URL reason 参数，默认 idle
}

function makeChecker(opts: Required<Pick<IdleOptions, 'timeout' | 'loginPath' | 'clearStorage' | 'reason'>> & IdleOptions) {
  return function checkIdle() {
    if (Date.now() - lastActivity < opts.timeout) return;
    stopIdleDetector();
    if (opts.onTimeout) {
      try { opts.onTimeout(); } catch { /* ignore */ }
    }
    if (opts.clearStorage) localStorage.clear();
    const params = new URLSearchParams(window.location.search);
    params.set('reason', opts.reason);
    window.location.href = `${opts.loginPath}?${params.toString()}`;
  };
}

/** 启用空闲检测 */
export function startIdleDetector(options: IdleOptions = {}): void {
  if (enabled) return;
  const opts = {
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
    checkInterval: options.checkInterval ?? 60 * 1000,
    loginPath: options.loginPath ?? '/login',
    clearStorage: options.clearStorage ?? true,
    reason: options.reason ?? 'idle',
    onTimeout: options.onTimeout
  };
  enabled = true;
  lastActivity = Date.now();
  EVENTS.forEach(ev => window.addEventListener(ev, onActivity, { passive: true }));
  timer = window.setInterval(makeChecker(opts), opts.checkInterval);
}

/** 停止空闲检测（退出登录时调用） */
export function stopIdleDetector(): void {
  if (!enabled) return;
  enabled = false;
  EVENTS.forEach(ev => window.removeEventListener(ev, onActivity));
  if (timer) { clearInterval(timer); timer = null; }
}

export default { startIdleDetector, stopIdleDetector };
