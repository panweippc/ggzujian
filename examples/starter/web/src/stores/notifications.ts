/**
 * 消息中心全局 store（照搬 qy 的 useNotificationStore，改走 starter 的 JWT API）。
 * 顶栏铃铛 / 下拉面板 / 消息中心页共用同一份数据，未读状态始终同步。
 * 关键能力：登出清数据、切号竞态防护、幂等轮询、浏览器通知。
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import {
  getNotifications, getNotificationUnreadCount,
  markNotificationRead, markAllNotificationsRead,
  deleteNotification, type NotificationItem
} from '../services/api';
import { NOTIFICATION_TYPES, NOTIFICATION_DEFAULT } from '../config';

export const useNotificationStore = defineStore('notifications', () => {
  const list = ref<NotificationItem[]>([]);
  const unreadCount = ref(0);
  const loading = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;
  let started = false;
  let loadSeq = 0;
  let loadedUser = '';

  const currentUser = () => localStorage.getItem('username') || '';

  function clearAll() {
    loadSeq++;
    list.value = [];
    unreadCount.value = 0;
    loading.value = false;
    loadedUser = '';
  }

  async function load() {
    const user = currentUser();
    if (!user) { if (loadedUser) clearAll(); return; }
    if (user !== loadedUser) { clearAll(); loadedUser = user; }
    const seq = ++loadSeq;
    loading.value = true;
    try {
      const res = await getNotifications(500);
      if (seq === loadSeq && currentUser() === user && res.success) list.value = res.data;
    } catch { /* 静默 */ }
    try {
      unreadCount.value = await getNotificationUnreadCount();
    } catch { /* 静默 */ }
    if (seq === loadSeq) loading.value = false;
  }

  async function markRead(id: number) {
    try { await markNotificationRead(id); } catch { /* 静默 */ }
    const item = list.value.find((n) => n.id === id);
    if (item && !item.isRead) {
      item.isRead = 1;
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
  }

  async function markAllRead() {
    try { await markAllNotificationsRead(); } catch { /* 静默 */ }
    list.value.forEach((n) => { n.isRead = 1; });
    unreadCount.value = 0;
  }

  async function remove(id: number) {
    try { await deleteNotification(id); } catch { /* 静默 */ }
    const item = list.value.find((n) => n.id === id);
    if (item && !item.isRead) unreadCount.value = Math.max(0, unreadCount.value - 1);
    list.value = list.value.filter((n) => n.id !== id);
  }

  function startPolling() {
    if (started) return;
    started = true;
    load();
    timer = setInterval(load, 30_000);
  }
  function stopPolling() {
    if (timer) { clearInterval(timer); timer = null; }
    started = false;
  }

  const unreadPreview = computed(() => list.value.filter((n) => !n.isRead).slice(0, 5));
  function typeConf(type: string) { return NOTIFICATION_TYPES[type] || NOTIFICATION_DEFAULT; }

  return {
    list, unreadCount, loading, unreadPreview,
    load, clearAll, markRead, markAllRead, remove,
    startPolling, stopPolling, typeConf
  };
});
