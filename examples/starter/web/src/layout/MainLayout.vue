<template>
  <div class="layout">
    <DynamicSidebar v-if="!isMobile" :collapsed="layout.sidebarCollapsed" />
    <el-drawer v-else v-model="mobileDrawer" direction="ltr" :with-header="false" size="240px" class="mobile-drawer">
      <DynamicSidebar :collapsed="false" />
    </el-drawer>
    <div class="main">
      <header class="topbar">
        <div class="brand">
          <button type="button" class="collapse-btn" :title="isMobile ? '打开菜单' : '收起/展开侧边栏'" @click="onToggleSidebar">☰</button>
          <span class="logo-mark">{{ BRAND.logo }}</span>
          <span class="brand-name">{{ BRAND.title }}</span>
        </div>
        <div class="top-actions">
          <button type="button" class="top-action" @click="openSearch">
            <span class="act-ico">⌕</span><span>搜索</span><span class="kbd-hint">Ctrl K</span>
          </button>
          <button type="button" class="top-action" title="回收站" @click="openRecycle">
            <span class="act-ico">♻</span><span>回收站</span>
          </button>
        </div>
        <div class="top-right">
          <NotificationCenter class="top-notif" />
          <LocaleSwitcher />
          <button type="button" class="top-icon-btn" title="主题/布局设置" @click="settingsVisible = true">
            <span class="act-ico">🎨</span>
          </button>
          <el-dropdown trigger="click" @command="onCommand">
            <span class="account">
              <el-avatar :size="32" class="avatar">{{ initial }}</el-avatar>
              <span class="uname">{{ userStore.displayName }}</span>
              <el-icon class="caret"><CaretBottom /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="profile"><el-icon><User /></el-icon><span>个人中心</span></el-dropdown-item>
                <el-dropdown-item command="changePassword"><el-icon><Lock /></el-icon><span>修改密码</span></el-dropdown-item>
                <el-dropdown-item command="security"><el-icon><Lock /></el-icon><span>安全设置</span></el-dropdown-item>
                <el-dropdown-item command="settings" divided><el-icon><Setting /></el-icon><span>主题设置</span></el-dropdown-item>
                <el-dropdown-item command="logout"><el-icon><SwitchButton /></el-icon><span>退出登录</span></el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </header>

      <TabBar v-if="layout.showTabs" @refresh="refreshView" />

      <main class="content">
        <router-view v-slot="{ Component, route: r }">
          <keep-alive :exclude="tabsStore.excluded">
            <component :is="Component" :key="r.fullPath" v-if="!refreshing" />
          </keep-alive>
        </router-view>
      </main>
    </div>
    <SettingsDrawer v-model:visible="settingsVisible" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { CaretBottom, User, Lock, SwitchButton, Setting } from '@element-plus/icons-vue';
import DynamicSidebar from '../components/DynamicSidebar.vue';
import NotificationCenter from '../components/NotificationCenter.vue';
import TabBar from '../components/TabBar.vue';
import SettingsDrawer from '../components/SettingsDrawer.vue';
import LocaleSwitcher from '../components/LocaleSwitcher.vue';
import { useUserStore } from '../stores/user';
import { useGlobalSearch } from '../composables/useGlobalSearch';
import { useRecycleBin } from '../composables/useRecycleBin';
import { useTabsStore } from '../stores/tabs';
import { useTheme } from '../composables/useTheme';
import { BRAND } from '../config';

const router = useRouter();
const route = useRoute();
const userStore = useUserStore();
const { open: openSearch } = useGlobalSearch();
const { open: openRecycle } = useRecycleBin();
const tabsStore = useTabsStore();
const { layout, updateLayout } = useTheme();
const initial = computed(() => (userStore.displayName ? userStore.displayName.charAt(0).toUpperCase() : 'U'));
const settingsVisible = ref(false);
const refreshing = ref(false);

// ===== 多端适配：窄屏（<900px）侧边栏改为抽屉 =====
const MOBILE_BREAKPOINT = 900;
const isMobile = ref(window.innerWidth < MOBILE_BREAKPOINT);
const mobileDrawer = ref(false);
function onResize() { isMobile.value = window.innerWidth < MOBILE_BREAKPOINT; }
function onToggleSidebar() {
  if (isMobile.value) mobileDrawer.value = true;
  else updateLayout({ sidebarCollapsed: !layout.sidebarCollapsed });
}
window.addEventListener('resize', onResize);
onUnmounted(() => window.removeEventListener('resize', onResize));

// 路由变化 → 记录 tab；窄屏时自动关抽屉
watch(() => route.fullPath, () => {
  tabsStore.add(route);
  if (isMobile.value) mobileDrawer.value = false;
}, { immediate: true });

async function refreshView() {
  refreshing.value = true;
  await nextTick();
  refreshing.value = false;
}

function onCommand(cmd: string) {
  if (cmd === 'profile') router.push('/profile');
  else if (cmd === 'changePassword') router.push('/change-password');
  else if (cmd === 'security') router.push('/security');
  else if (cmd === 'settings') settingsVisible.value = true;
  else if (cmd === 'logout') { userStore.logout(); tabsStore.closeAll(); router.push('/login'); }
}
</script>

<style scoped>
.layout { display: flex; height: 100vh; background: var(--bg-color); }
.main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

.topbar {
  height: 56px; display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px; position: relative; background: var(--topbar-bg);
  box-shadow: 0 1px 8px rgba(102, 126, 234, 0.12); border-bottom: 1px solid var(--border-color);
}
.brand { display: flex; align-items: center; gap: 10px; z-index: 1; }
.collapse-btn {
  border: none; background: none; font-size: 18px; color: var(--text-secondary);
  cursor: pointer; padding: 4px 6px; border-radius: 6px; font-family: inherit;
}
.collapse-btn:hover { color: var(--primary-color); background: var(--hover-bg); }
.logo-mark {
  font-size: 22px; color: #fff; background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end));
  width: 32px; height: 32px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  box-shadow: 0 3px 10px rgba(102, 126, 234, 0.35);
}
.brand-name {
  font-size: 18px; font-weight: 700; letter-spacing: 1px;
  background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.top-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; margin-right: 16px; z-index: 1; }
.top-action, .top-icon-btn {
  display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px;
  font-size: 13px; color: var(--text-secondary); background: var(--hover-bg);
  border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; font-family: inherit; transition: all .2s;
}
.top-action:hover, .top-icon-btn:hover { color: var(--primary-color); border-color: var(--primary-color); }
.top-icon-btn { padding: 7px 10px; }
.act-ico { font-size: 16px; line-height: 1; }
.kbd-hint { font-size: 10px; color: #98a2b3; border: 1px solid #dfe3ec; border-radius: 4px; padding: 0 4px; }
.top-right { z-index: 1; display: flex; align-items: center; gap: 12px; }
.top-notif { display: inline-flex; }
.account { display: flex; align-items: center; gap: 8px; cursor: pointer; color: var(--text-color); outline: none; }
.avatar { background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end)); color: #fff; font-weight: 700; }
.uname { font-size: 14px; }
.caret { color: var(--text-secondary); }

.content { flex: 1; overflow-y: auto; background: var(--bg-gradient); }

/* 窄屏抽屉里的侧边栏：撑满、去边框 */
:deep(.mobile-drawer .el-drawer__body) { padding: 0; }
:deep(.mobile-drawer .sidebar) { width: 100% !important; height: 100%; border-right: none; }
</style>
