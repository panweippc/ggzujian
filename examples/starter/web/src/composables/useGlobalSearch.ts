/**
 * 全局搜索 —— 单例状态（顶栏按钮 / Ctrl+K / 弹窗共享同一份）
 * 骨架版：本地搜侧边栏菜单 + 调现有 users/logs 接口，不依赖额外后端。
 * 新项目接自己的搜索接口时，把 runSearch 里的本地逻辑换成 api.globalSearch(q) 即可。
 */
import { ref } from 'vue';
import { SIDE_MENUS } from '../config';
import { getUsers, getLogs } from '../services/api';

export interface SearchItem {
  id: string;
  type: string;
  title: string;
  sub: string;
  route: string;
  query?: Record<string, any>;
}
export interface SearchGroup {
  module: string;
  label: string;
  items: SearchItem[];
}

// 模块级单例
const visible = ref(false);
const keyword = ref('');
const results = ref<SearchGroup[]>([]);
const total = ref(0);
const loading = ref(false);
let timer: any = null;

// 菜单扁平化（本地搜索源）
interface MenuLeaf { name: string; path: string }
const menuLeaves: MenuLeaf[] = [];
(function flatten() {
  for (const m of SIDE_MENUS as any[]) {
    if (m.children?.length) for (const c of m.children) menuLeaves.push({ name: c.name, path: c.path });
    else if (m.path) menuLeaves.push({ name: m.name, path: m.path });
  }
})();

async function runSearch(q: string) {
  keyword.value = q;
  const text = q.trim();
  if (!text) { results.value = []; total.value = 0; return; }
  loading.value = true;
  const lower = text.toLowerCase();
  try {
    const groups: SearchGroup[] = [];

    // 1) 菜单（本地即时）
    const menuItems: SearchItem[] = menuLeaves
      .filter((m) => m.name.includes(text))
      .map((m) => ({ id: 'menu-' + m.path, type: 'menu', title: m.name, sub: '菜单 · ' + m.path, route: m.path }));
    if (menuItems.length) groups.push({ module: 'menu', label: '功能菜单', items: menuItems });

    // 2) 用户 + 日志（后端真实接口，失败不影响菜单结果）
    const [u, l] = await Promise.allSettled([
      getUsers({ page: 1, pageSize: 100 }),
      getLogs({ page: 1, pageSize: 100 }),
    ]);
    const userItems: SearchItem[] = (u.status === 'fulfilled' && u.value.success ? u.value.data : [])
      .filter((x: any) => String(x.username).toLowerCase().includes(lower))
      .map((x: any) => ({ id: 'user-' + x.id, type: 'user', title: x.username, sub: '用户 · ' + (x.role || ''), route: '/system' }));
    if (userItems.length) groups.push({ module: 'user', label: '用户', items: userItems });

    const logItems: SearchItem[] = (l.status === 'fulfilled' && l.value.success ? l.value.data : [])
      .filter((x: any) => [x.username, x.action, x.module, x.targetName, x.detail].some((v) => v && String(v).toLowerCase().includes(lower)))
      .slice(0, 20)
      .map((x: any) => ({ id: 'log-' + x.id, type: 'log', title: x.detail || `${x.module} · ${x.action}`, sub: `日志 · ${x.username} · ${x.createdAt || ''}`, route: '/logs' }));
    if (logItems.length) groups.push({ module: 'log', label: '操作日志', items: logItems });

    results.value = groups;
    total.value = groups.reduce((s, g) => s + g.items.length, 0);
  } catch {
    results.value = []; total.value = 0;
  } finally { loading.value = false; }
}

function onInput(q: string) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => runSearch(q), 250);
}
function open() { visible.value = true; keyword.value = ''; results.value = []; total.value = 0; }
function close() { visible.value = false; }

export function useGlobalSearch() {
  return { visible, keyword, results, total, loading, open, close, onInput, runSearch };
}
