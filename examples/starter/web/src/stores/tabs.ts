/** 多标签页导航 store：记录打开的路由 tab，支持关闭/关闭其他/关闭全部。 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';

export interface TabItem {
  key: string;
  title: string;
  path: string;
  icon?: string;
  closable: boolean;
}

export const useTabsStore = defineStore('tabs', () => {
  const tabs = ref<TabItem[]>([]);
  const activeKey = ref('');
  // 被关闭的组件 key，喂给 KeepAlive 的 exclude 以清除缓存
  const excluded = ref<string[]>([]);

  const openedKeys = computed(() => tabs.value.map((t) => t.key));

  function add(route: RouteLocationNormalized) {
    const key = String(route.path);
    if (!key || key === '/login') return;
    const title = (route.meta?.title as string) || '未命名';
    if (!tabs.value.some((t) => t.key === key)) {
      // 从 exclude 移除，允许重新缓存
      excluded.value = excluded.value.filter((k) => k !== key);
      tabs.value.push({ key, title, path: key, closable: key !== '/', icon: route.meta?.icon as string });
    }
    activeKey.value = key;
  }

  function close(key: string): string | null {
    const idx = tabs.value.findIndex((t) => t.key === key);
    if (idx < 0 || !tabs.value[idx].closable) return null;
    tabs.value.splice(idx, 1);
    excluded.value.push(key);
    if (activeKey.value === key) {
      const next = tabs.value[Math.min(idx, tabs.value.length - 1)];
      activeKey.value = next?.key || '';
      return next?.path || '/';
    }
    return null;
  }
  function closeOther(key: string) {
    tabs.value.filter((t) => t.key !== key && t.closable).forEach((t) => excluded.value.push(t.key));
    tabs.value = tabs.value.filter((t) => t.key === key || !t.closable);
    activeKey.value = key;
  }
  function closeAll() {
    tabs.value.filter((t) => t.closable).forEach((t) => excluded.value.push(t.key));
    tabs.value = tabs.value.filter((t) => !t.closable);
    const home = tabs.value[0];
    activeKey.value = home?.key || '';
    return home?.path || '/';
  }

  return { tabs, activeKey, excluded, openedKeys, add, close, closeOther, closeAll };
});
