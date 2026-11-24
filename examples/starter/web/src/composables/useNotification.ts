/**
 * 消息通知兼容层。
 * 早期顶栏铃铛走本文件；现在统一代理到 Pinia store（notifications），
 * 保证铃铛/下拉/消息中心页三处状态一致。旧调用方可继续用 useNotification()。
 */
import { computed } from 'vue';
import { useNotificationStore } from '../stores/notifications';

export function useNotification() {
  const ns = useNotificationStore();
  return {
    visible: computed({
      get: () => (ns as any).visible ?? false,
      set: (v: boolean) => { (ns as any).visible = v; }
    }),
    loading: computed(() => ns.loading),
    list: computed(() => ns.list),
    unread: computed(() => ns.unreadCount),
    open: () => ns.load(),
    close: () => {},
    loadList: () => ns.load(),
    loadUnread: () => ns.load(),
    readOne: (item: { id: number }) => ns.markRead(item.id),
    readAll: () => ns.markAllRead(),
    startPolling: () => ns.startPolling(),
    stopPolling: () => ns.stopPolling(),
  };
}
