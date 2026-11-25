/**
 * 轻量 i18n 框架（零依赖）
 * 用 reactive 单例 + t() 函数；语言偏好持久化到 localStorage。
 * 扩展语言：在 LOCALES 增加字典即可。Element Plus 的 locale 切换见 main.ts。
 */
import { reactive, computed } from 'vue';

type Dict = Record<string, string>;
const LOCALES: Record<string, Dict> = {
  'zh-CN': {
    'app.name': '管理系统',
    'nav.home': '工作台', 'nav.messages': '消息中心', 'nav.logs': '操作日志',
    'nav.system': '系统管理', 'nav.security': '安全设置', 'nav.config': '配置中心',
    'common.save': '保存', 'common.cancel': '取消', 'common.delete': '删除',
    'common.confirm': '确定', 'common.search': '搜索', 'common.reset': '重置',
    'login.title': '登录', 'login.username': '用户名', 'login.password': '密码',
  },
  'en-US': {
    'app.name': 'Management System',
    'nav.home': 'Dashboard', 'nav.messages': 'Messages', 'nav.logs': 'Operation Logs',
    'nav.system': 'System', 'nav.security': 'Security', 'nav.config': 'Config Center',
    'common.save': 'Save', 'common.cancel': 'Cancel', 'common.delete': 'Delete',
    'common.confirm': 'Confirm', 'common.search': 'Search', 'common.reset': 'Reset',
    'login.title': 'Sign In', 'login.username': 'Username', 'login.password': 'Password',
  },
};

const state = reactive({ locale: localStorage.getItem('i18n.locale') || 'zh-CN' });
export const locale = computed(() => state.locale);
export const availableLocales = Object.keys(LOCALES);

export function setLocale(l: string) {
  if (!LOCALES[l]) return;
  state.locale = l;
  localStorage.setItem('i18n.locale', l);
  document.documentElement.lang = l;
}
export function t(key: string, fallback?: string): string {
  return LOCALES[state.locale]?.[key] ?? LOCALES['zh-CN'][key] ?? fallback ?? key;
}
export function addLocale(lang: string, dict: Dict) { LOCALES[lang] = { ...(LOCALES[lang] || {}), ...dict }; }
export default { t, setLocale, locale, availableLocales, addLocale };
