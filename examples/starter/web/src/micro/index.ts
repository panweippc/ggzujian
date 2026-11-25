/**
 * 微前端基座预留层（零依赖）
 * 设计：主应用暴露 registerMicroApp() 与 mountMicroApp() 两个接口；
 * 未接入 qiankun 时明确提示，不静默失败。接入时只需在 bootstrap() 里换成 qiankun 的 registerMicroApps/start。
 */
import { ElMessage } from 'element-plus';

export interface MicroApp {
  name: string;        // 子应用名（唯一）
  entry: string;       // 子应用入口 URL
  container: string;   // 挂载容器选择器，如 #micro-container
  activeRule: string;  // 激活路由前缀，如 /app/order
  props?: Record<string, any>;
}

const APPS = new Map<string, MicroApp>();
let booted = false;

export function registerMicroApp(app: MicroApp) {
  if (!app.name || !app.entry || !app.activeRule) throw new Error('微应用 name/entry/activeRule 必填');
  APPS.set(app.name, app);
  return true;
}

export function listMicroApps(): MicroApp[] { return [...APPS.values()]; }

/**
 * 引导基座。未配置 qiankun 时仅打印提示（不影响主应用运行）。
 * 接入步骤：
 *   npm i qiankun
 *   在下方 import { registerMicroApps, start } from 'qiankun'
 *   把 APPS 转成 qiankun 的 apps 数组后调用 registerMicroApps(apps); start();
 */
export function bootstrapMicroFrontend() {
  if (booted) return { booted, apps: APPS.size, adapter: 'placeholder' };
  booted = true;
  if (APPS.size > 0 && !(window as any).__QIANKUN_READY__) {
    console.info(`[micro] 已注册 ${APPS.size} 个子应用，但 qiankun 适配器未接入；请在 src/micro/index.ts 的 bootstrapMicroFrontend 中启用。`);
  }
  return { booted, apps: APPS.size, adapter: (window as any).__QIANKUN_READY__ ? 'qiankun' : 'placeholder' };
}

/** 手动挂载（预留接口） */
export function mountMicroApp(name: string) {
  const app = APPS.get(name);
  if (!app) { ElMessage.warning(`微应用 ${name} 未注册`); return false; }
  if (!(window as any).__QIANKUN_READY__) {
    ElMessage.info(`微应用 ${app.name} 已配置，接入 qiankun 后可从 ${app.activeRule} 加载（入口 ${app.entry}）`);
    return false;
  }
  return true;
}
