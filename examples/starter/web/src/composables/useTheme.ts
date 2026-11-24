/**
 * 主题切换单例（亮色 / 暗色 / 紫蓝三套），localStorage 持久化。
 * 通过 document.documentElement.dataset.theme 切换，CSS 变量定义在 themes.css。
 * 新项目加主题：themes.css 加一段 [data-theme='xxx'] + THEMES 加一项即可。
 */
import { ref, computed } from 'vue';

export interface ThemeOption { key: string; name: string; icon: string }
export const THEMES: ThemeOption[] = [
  { key: 'purple', name: '紫蓝（默认）', icon: '🟣' },
  { key: 'light', name: '简约亮色', icon: '⚪' },
  { key: 'dark', name: '暗夜模式', icon: '🌙' },
];

const KEY = 'app-theme';
const current = ref<string>(localStorage.getItem(KEY) || 'purple');

function apply(theme: string) {
  if (!THEMES.some((t) => t.key === theme)) theme = 'purple';
  current.value = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(KEY, theme);
}
function setTheme(key: string) { apply(key); }
function cycle() {
  const idx = THEMES.findIndex((t) => t.key === current.value);
  apply(THEMES[(idx + 1) % THEMES.length].key);
}

// 布局设置
export interface LayoutSettings {
  sidebarCollapsed: boolean;
  showTabs: boolean;
  compact: boolean;
}
const LAYOUT_KEY = 'app-layout';
const defaults: LayoutSettings = { sidebarCollapsed: false, showTabs: true, compact: false };
const layout = ref<LayoutSettings>({ ...defaults, ...safeParse(localStorage.getItem(LAYOUT_KEY)) });

function safeParse(s: string | null): Partial<LayoutSettings> {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}
function updateLayout(patch: Partial<LayoutSettings>) {
  layout.value = { ...layout.value, ...patch };
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout.value));
  document.documentElement.classList.toggle('compact-mode', layout.value.compact);
}

const currentTheme = computed(() => THEMES.find((t) => t.key === current.value) || THEMES[0]);

export function useTheme() {
  return { current, currentTheme, themes: THEMES, setTheme, cycle, apply, layout, updateLayout };
}

// 模块加载时立即应用一次，避免首屏闪烁
apply(current.value);
updateLayout({});
