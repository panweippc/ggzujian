<template>
  <div class="tabbar" v-if="tabs.tabs.length">
    <div class="tab-scroll">
      <div
        v-for="tab in tabs.tabs"
        :key="tab.key"
        class="tab-item"
        :class="{ active: tabs.activeKey === tab.key }"
        @click="activate(tab)"
        @contextmenu.prevent="openMenu($event, tab)"
      >
        <span class="tab-dot"></span>
        <span class="tab-title">{{ tab.title }}</span>
        <button v-if="tab.closable" class="tab-close" @click.stop="closeTab(tab)" title="关闭">✕</button>
      </div>
    </div>
    <div class="tab-tools">
      <el-dropdown trigger="click" @command="onCommand">
        <button class="tool-btn" title="标签操作">⋯</button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="other">关闭其他</el-dropdown-item>
            <el-dropdown-item command="all">关闭全部</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <ul v-if="menu.visible" class="ctx-menu" :style="{ left: menu.x + 'px', top: menu.y + 'px' }">
      <li @click="ctxAction('refresh')">🔄 刷新</li>
      <li @click="ctxAction('close')" :class="{ disabled: !ctxTab?.closable }">✕ 关闭</li>
      <li @click="ctxAction('other')">⊘ 关闭其他</li>
      <li @click="ctxAction('all')">⊘ 关闭全部</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useTabsStore, type TabItem } from '../stores/tabs';

const emit = defineEmits<{ refresh: [] }>();
const router = useRouter();
const tabs = useTabsStore();

function activate(tab: TabItem) { tabs.activeKey = tab.key; router.push(tab.path); }
function closeTab(tab: TabItem) {
  const path = tabs.close(tab.key);
  if (path && tabs.activeKey === tab.key) router.push(path);
  else if (path) router.push(path);
}

const menu = reactive({ visible: false, x: 0, y: 0 });
const ctxTab = ref<TabItem | null>(null);
function openMenu(e: MouseEvent, tab: TabItem) {
  ctxTab.value = tab;
  tabs.activeKey = tab.key;
  menu.x = e.clientX; menu.y = e.clientY; menu.visible = true;
}
function closeMenu() { menu.visible = false; }
function onCommand(cmd: string) {
  if (cmd === 'other') { tabs.closeOther(tabs.activeKey); router.push(tabs.activeKey); }
  else if (cmd === 'all') { router.push(tabs.closeAll() || '/'); }
}
function ctxAction(action: string) {
  const tab = ctxTab.value;
  closeMenu();
  if (!tab) return;
  if (action === 'refresh') { emit('refresh'); return; }
  if (action === 'close') { closeTab(tab); }
  else if (action === 'other') { tabs.closeOther(tab.key); router.push(tab.key); }
  else if (action === 'all') { router.push(tabs.closeAll() || '/'); }
}
onMounted(() => { document.addEventListener('click', closeMenu); window.addEventListener('contextmenu', closeMenu); });
onUnmounted(() => { document.removeEventListener('click', closeMenu); window.removeEventListener('contextmenu', closeMenu); });
</script>

<style scoped>
.tabbar {
  display: flex; align-items: center; height: 40px; flex-shrink: 0;
  background: var(--card-bg); border-bottom: 1px solid var(--border-color); padding: 0 10px; gap: 8px;
}
.tab-scroll { display: flex; gap: 4px; overflow-x: auto; flex: 1; height: 100%; align-items: center; scrollbar-width: none; }
.tab-scroll::-webkit-scrollbar { display: none; }
.tab-item {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px;
  border: 1px solid transparent; border-radius: 6px; cursor: pointer; white-space: nowrap;
  font-size: 13px; color: var(--text-secondary); transition: all .2s;
}
.tab-item:hover { background: var(--hover-bg); }
.tab-item.active { background: rgba(102,126,234,.08); border-color: rgba(102,126,234,.25); color: var(--primary-color); font-weight: 600; }
.tab-dot { width: 6px; height: 6px; border-radius: 50%; background: transparent; }
.tab-item.active .tab-dot { background: var(--primary-color); }
.tab-close { border: none; background: none; color: var(--text-secondary); cursor: pointer; font-size: 11px; padding: 0 2px; font-family: inherit; }
.tab-close:hover { color: #f56c6c; }
.tab-tools { flex-shrink: 0; }
.tool-btn { border: 1px solid var(--border-color); background: var(--card-bg); color: var(--text-secondary); border-radius: 6px; width: 30px; height: 26px; cursor: pointer; font-family: inherit; }
.tool-btn:hover { color: var(--primary-color); border-color: var(--primary-color); }
.ctx-menu {
  position: fixed; z-index: 3000; list-style: none; margin: 0; padding: 6px 0;
  background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,.12); min-width: 130px; font-size: 13px;
}
.ctx-menu li { padding: 8px 14px; cursor: pointer; color: var(--text-color); }
.ctx-menu li:hover { background: var(--hover-bg); }
.ctx-menu li.disabled { opacity: .4; pointer-events: none; }
</style>
