<template>
  <el-popover
    v-model:visible="visible"
    placement="bottom-end"
    :width="360"
    trigger="click"
    popper-class="notif-popover"
    @show="onShow"
  >
    <template #reference>
      <button type="button" class="notif-bell" title="消息通知">
        <el-badge :value="unread" :hidden="unread === 0" :max="99">
          <span class="bell-ico">🔔</span>
        </el-badge>
      </button>
    </template>

    <div class="notif-panel">
      <div class="notif-head">
        <span class="notif-title">消息通知</span>
        <button type="button" class="notif-readall" :disabled="unread === 0" @click="readAll">全部已读</button>
      </div>

      <div v-if="loading" class="notif-loading"><el-skeleton :rows="3" animated /></div>
      <div v-else-if="list.length === 0" class="notif-empty">
        <span class="empty-ico">📭</span>
        <span>暂无通知</span>
      </div>
      <div v-else class="notif-list">
        <div
          v-for="n in preview"
          :key="n.id"
          class="notif-item"
          :class="{ unread: !n.isRead }"
          @click="handleItemClick(n)"
        >
          <span class="notif-type-ico" :style="{ background: conf(n.type).color + '1f', color: conf(n.type).color }">
            {{ conf(n.type).icon }}
          </span>
          <div class="notif-body">
            <div class="notif-row">
              <span class="notif-item-title">{{ n.title }}</span>
              <span v-if="!n.isRead" class="notif-dot"></span>
            </div>
            <div class="notif-content">{{ n.content }}</div>
          </div>
        </div>
      </div>
      <button type="button" class="notif-viewall" @click="viewAll">查看全部消息 →</button>
    </div>
  </el-popover>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationItem } from '../services/api';

const router = useRouter();
const ns = useNotificationStore();
const visible = ref(false);

const unread = computed(() => ns.unreadCount);
const list = computed(() => ns.list);
const loading = computed(() => ns.loading);
const preview = computed(() => ns.unreadPreview.length ? ns.unreadPreview : ns.list.slice(0, 5));

function onShow() { ns.load(); }
function conf(type: string) { return ns.typeConf(type); }

function viewAll() {
  visible.value = false;
  router.push('/messages');
}
function handleItemClick(n: NotificationItem) {
  if (!n.isRead) ns.markRead(n.id);
  visible.value = false;
  if (n.link) {
    const sep = n.link.includes('?') ? '&' : '?';
    router.push(n.link + sep + 'fromNotification=1');
  } else {
    router.push('/messages');
  }
}
function readAll() { ns.markAllRead(); }

// ===== 浏览器通知能力（照搬 qy 的 DashboardHeader）=====
let titleTimer: ReturnType<typeof setInterval> | null = null;
let originalTitle = '';
let lastNotified = -1;

function startTitleFlash() {
  if (titleTimer) return;
  originalTitle = document.title;
  let on = false;
  titleTimer = setInterval(() => {
    document.title = on ? `(${unread.value}) 新消息` : originalTitle;
    on = !on;
  }, 1000);
}
function stopTitleFlash() {
  if (titleTimer) { clearInterval(titleTimer); titleTimer = null; }
  if (originalTitle) document.title = originalTitle;
}
function drawRedDotFavicon() {
  const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
  if (!link) return;
  if (!link.dataset.origFav) link.dataset.origFav = link.href;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 32;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#667eea';
  ctx.beginPath(); ctx.arc(16, 16, 14, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('!', 16, 17);
  link.href = canvas.toDataURL();
}
function restoreFavicon() {
  const link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
  if (link && link.dataset.origFav) link.href = link.dataset.origFav;
}
function notifySystem(count: number) {
  if (!('Notification' in window)) return;
  const fire = () => { try { new Notification('您有新消息', { body: `当前有 ${count} 条未读消息`, icon: '/favicon.ico' }); } catch {} };
  if (Notification.permission === 'granted') fire();
  else if (Notification.permission !== 'denied') Notification.requestPermission().then((p) => { if (p === 'granted') fire(); });
}
function onVisibilityChange() {
  if (document.hidden) {
    if (unread.value > 0) {
      startTitleFlash();
      drawRedDotFavicon();
      if (lastNotified !== unread.value) { notifySystem(unread.value); lastNotified = unread.value; }
    }
  } else {
    stopTitleFlash();
    restoreFavicon();
    lastNotified = -1;
  }
}
watch(unread, (count) => {
  if (document.hidden && count > 0) {
    startTitleFlash();
    drawRedDotFavicon();
    if (lastNotified !== count) { notifySystem(count); lastNotified = count; }
  } else if (count === 0) { stopTitleFlash(); restoreFavicon(); }
});

onMounted(() => document.addEventListener('visibilitychange', onVisibilityChange));
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange);
  stopTitleFlash();
  restoreFavicon();
});
</script>

<style>
.notif-popover.el-popover { padding: 0 !important; border-radius: 12px !important; overflow: hidden; }
</style>
<style scoped>
.notif-bell {
  position: relative; display: inline-flex; align-items: center; justify-content: center;
  width: 38px; height: 38px; border: 1px solid #eef0f7; background: #f7f8fc;
  border-radius: 8px; cursor: pointer; transition: all .2s;
}
.notif-bell:hover { color: #667eea; background: rgba(102,126,234,.08); border-color: rgba(102,126,234,.3); }
.bell-ico { font-size: 18px; line-height: 1; }
.notif-panel { font-family: inherit; }
.notif-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #eef0f7; }
.notif-title { font-size: 15px; font-weight: 700; color: #1f2d3d; }
.notif-readall { font-size: 12px; color: #667eea; background: none; border: none; cursor: pointer; font-family: inherit; padding: 2px 4px; }
.notif-readall:disabled { color: #c0c4cc; cursor: not-allowed; }
.notif-loading { padding: 16px; }
.notif-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 30px 0; color: #98a2b3; font-size: 13px; }
.empty-ico { font-size: 30px; }
.notif-list { max-height: 340px; overflow-y: auto; }
.notif-item { display: flex; gap: 12px; padding: 13px 16px; cursor: pointer; border-bottom: 1px solid #f4f5f9; transition: background .2s; }
.notif-item:last-child { border-bottom: none; }
.notif-item:hover { background: #f7f8fc; }
.notif-item.unread { background: rgba(102,126,234,.04); }
.notif-type-ico { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
.notif-body { flex: 1; min-width: 0; }
.notif-row { display: flex; align-items: center; gap: 6px; }
.notif-item-title { font-size: 13px; font-weight: 600; color: #2c3542; }
.notif-dot { width: 7px; height: 7px; border-radius: 50%; background: #667eea; flex: 0 0 7px; }
.notif-content { font-size: 12px; color: #7b8494; line-height: 1.5; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notif-viewall { display: block; width: 100%; padding: 12px; font-size: 13px; color: #667eea; background: #fafbff; border: none; border-top: 1px solid #eef0f7; cursor: pointer; font-family: inherit; }
.notif-viewall:hover { background: rgba(102,126,234,.08); }
</style>
