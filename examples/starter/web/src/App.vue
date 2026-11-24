<template>
  <router-view />
  <GlobalSearchModal />
  <RecycleBinDrawer v-if="route.name !== 'login'" />
  <BackToTop v-if="route.name !== 'login'" />
  <AiAssistant v-if="route.name !== 'login' && route.name !== 'onboarding'" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import GlobalSearchModal from './components/GlobalSearchModal.vue';
import RecycleBinDrawer from './components/RecycleBinDrawer.vue';
import BackToTop from './components/BackToTop.vue';
import AiAssistant from './components/AiAssistant.vue';
import { useGlobalSearch } from './composables/useGlobalSearch';
import { useNotificationStore } from './stores/notifications';

const router = useRouter();
const route = useRoute();
const { open } = useGlobalSearch();
const notificationStore = useNotificationStore();

// 登录后全局启动通知轮询；登出/切号由 store 内部 load() 自动清理残留
function syncNotificationPolling() {
  const token = localStorage.getItem('token');
  if (token && route.name !== 'login') notificationStore.startPolling();
  else notificationStore.stopPolling();
}
function onKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    open();
  }
}
onMounted(() => { window.addEventListener('keydown', onKeydown); syncNotificationPolling(); });
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
watch(() => route.name, syncNotificationPolling);
</script>

<style>
* { box-sizing: border-box; }
html, body, #app { height: 100%; margin: 0; padding: 0; }
body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  background: var(--bg-color);
  color: var(--text-color);
}
</style>
