<template>
  <aside class="sidebar" :class="{ collapsed }">
    <div class="side-brand">
      <span class="side-logo">{{ BRAND.logo }}</span>
      <span class="side-title">{{ BRAND.shortName }}</span>
    </div>
    <nav class="nav">
      <template v-for="mod in menus" :key="mod.id">
        <!-- 有子菜单：可折叠分组 -->
        <div v-if="mod.children?.length" class="side-group" :class="{ open: openSet.has(mod.id) }">
          <div class="side-item root group-head" @click="toggle(mod.id)">
            <span class="ico">{{ iconOf(mod.icon) }}</span>
            <span class="label">{{ mod.name }}</span>
            <span class="arrow">▸</span>
          </div>
          <div class="sub-list">
            <router-link v-for="c in mod.children" :key="c.id" :to="c.path" class="side-item sub" active-class="router-link-active">
              <span class="dot">•</span><span>{{ c.name }}</span>
            </router-link>
          </div>
        </div>
        <!-- 无子菜单：叶子项 -->
        <router-link v-else :to="mod.path || '/'" class="side-item root" active-class="router-link-active">
          <span class="ico">{{ iconOf(mod.icon) }}</span><span>{{ mod.name }}</span>
        </router-link>
      </template>
    </nav>
  </aside>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { BRAND, SIDE_MENUS } from '../config';

const menus = SIDE_MENUS;
const openSet = ref<Set<number>>(new Set());
const props = defineProps<{ collapsed?: boolean }>();

const icons: Record<string, string> = {
  home: '🏠', setting: '⚙️', clipboard: '📋', users: '👥', dashboard: '📊',
  'bar-chart': '📈', database: '🗄', key: '🔑', file: '📁', alert: '⚠️',
  email: '✉️', search: '🔍', palette: '🎨', monitor: '📡', book: '📖',
  clock: '⏰', sliders: '🎛', shield: '🛡', quality: '🧩',
};
const iconOf = (k?: string) => (k && icons[k]) || '📄';

function toggle(id: number) {
  const s = new Set(openSet.value);
  s.has(id) ? s.delete(id) : s.add(id);
  openSet.value = s;
}

onMounted(() => {
  // 默认展开所有分组
  const open = new Set<number>();
  for (const m of menus) if (m.children?.length) open.add(m.id);
  openSet.value = open;
});
</script>

<style scoped>
/* 侧边栏：白底 + 紫蓝激活态（qygl 风格） */
.sidebar {
  width: var(--sidebar-width, 200px);
  background: #fff;
  border-right: 1px solid #eef0f7;
  padding: 0;
  overflow-y: auto;
  flex-shrink: 0;
}
.side-brand {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 18px;
  border-bottom: 1px solid #eef0f7;
}
.side-logo { font-size: 20px; color: #667eea; }
.side-title {
  font-weight: 700; font-size: 16px; letter-spacing: 1px;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent;
  background-clip: text;
}

.nav { padding: 8px 0; }
.side-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 11px 18px;
  color: #5c6675;
  text-decoration: none;
  font-size: 14px;
  border-left: 3px solid transparent;
  transition: all 0.2s;
  cursor: pointer;
  user-select: none;
}
.side-item .ico { width: 18px; text-align: center; }
.side-item .label { flex: 1; }
.side-item .arrow { transition: transform 0.2s; font-size: 12px; color: #a0a8b5; }
.side-group.open .arrow { transform: rotate(90deg); }
.side-item:hover,
.side-item.router-link-active {
  background: linear-gradient(90deg, rgba(102, 126, 234, 0.12), rgba(118, 75, 162, 0.05));
  color: #667eea;
  border-left-color: #667eea;
  font-weight: 600;
}
.sub-list { display: none; background: #f7f8fc; }
.side-group.open .sub-list { display: block; }
.side-item.sub { padding: 9px 18px 9px 42px; font-size: 13px; color: #7a8699; }
.side-item.sub .dot { color: #667eea; }

/* 折叠态：只显示图标 */
.sidebar.collapsed { --sidebar-width: 64px; }
.sidebar.collapsed .side-title,
.sidebar.collapsed .side-item > span:not(.ico),
.sidebar.collapsed .side-item .label,
.sidebar.collapsed .side-item .arrow,
.sidebar.collapsed .sub-list { display: none; }
.sidebar.collapsed .side-item { justify-content: center; padding-left: 0; padding-right: 0; }
.sidebar.collapsed .side-brand { justify-content: center; }
</style>
