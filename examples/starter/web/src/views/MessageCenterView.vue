<template>
  <div class="message-center">
    <PageHeaderBar title="消息中心">
      <template #actions>
        <div class="header-actions">
          <el-button size="small" @click="markAllRead" :disabled="ns.unreadCount === 0">全部标记已读</el-button>
          <el-button size="small" @click="refresh">刷新</el-button>
        </div>
      </template>
    </PageHeaderBar>

    <div class="mc-body">
      <div class="tabs-bar">
        <button class="tab-btn" :class="{ active: activeTab === 'all' }" @click="activeTab = 'all'">全部 ({{ total }})</button>
        <button class="tab-btn" :class="{ active: activeTab === 'unread' }" @click="activeTab = 'unread'">未读 ({{ ns.unreadCount }})</button>
      </div>

      <div class="notification-list" v-loading="ns.loading">
        <div v-if="filteredList.length === 0" class="empty-state">
          <span class="empty-icon">📭</span>
          <p>暂无消息</p>
        </div>
        <div
          v-for="item in filteredList"
          :key="item.id"
          class="notification-item"
          :class="{ unread: !item.isRead }"
          @click="handleItemClick(item)"
        >
          <div class="notif-dot" v-if="!item.isRead" />
          <div class="notif-icon" :style="{ background: conf(item.type).color + '1f' }">
            <span>{{ conf(item.type).icon }}</span>
          </div>
          <div class="notif-body">
            <div class="notif-title">{{ item.title }}</div>
            <div class="notif-content" v-if="item.content">{{ item.content }}</div>
            <div class="notif-time">{{ formatTime(item.createdAt) }} · {{ conf(item.type).label }}</div>
          </div>
          <button class="notif-close" title="删除" @click.stop="deleteNotif(item)">✕</button>
        </div>
        <div class="pagination-bar" v-if="total > pageSize">
          <el-pagination layout="prev, pager, next" :total="total" :page-size="pageSize" v-model:current-page="currentPage" background small />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import { useNotificationStore } from '../stores/notifications';
import type { NotificationItem } from '../services/api';

const router = useRouter();
const ns = useNotificationStore();

const currentPage = ref(1);
const pageSize = 20;
const activeTab = ref('all');
const total = computed(() => activeTab.value === 'unread' ? ns.unreadCount : ns.list.length);
const filteredList = computed(() => {
  const base = activeTab.value === 'unread' ? ns.list.filter((n) => !n.isRead) : ns.list;
  const start = (currentPage.value - 1) * pageSize;
  return base.slice(start, start + pageSize);
});
watch(activeTab, () => { currentPage.value = 1; });

function conf(type: string) { return ns.typeConf(type); }
function formatTime(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr.replace(' ', 'T'));
  if (isNaN(d.getTime())) return dateStr;
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return Math.floor(diff / 60_000) + '分钟前';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000) + '小时前';
  if (diff < 172_800_000) return '昨天 ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('zh-CN') + ' ' + d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

async function refresh() { await ns.load(); }
async function markAllRead() { await ns.markAllRead(); ElMessage.success('全部标记为已读'); }

async function handleItemClick(item: NotificationItem) {
  if (!item.isRead) await ns.markRead(item.id);
  if (item.link) {
    const sep = item.link.includes('?') ? '&' : '?';
    router.push(item.link + sep + 'fromNotification=1');
  }
}

async function deleteNotif(item: NotificationItem) {
  try {
    await ElMessageBox.confirm('确定要删除这条消息吗？', '删除消息', {
      confirmButtonText: '确定', cancelButtonText: '取消', type: 'warning'
    });
    await ns.remove(item.id);
  } catch { /* 取消 */ }
}

onMounted(() => ns.startPolling());
</script>

<style scoped>
.message-center { min-height: 100%; display: flex; flex-direction: column; }
.mc-body { width: 100%; max-width: 800px; margin: 0 auto; padding: 24px; flex: 1; }
.header-actions { display: flex; gap: 8px; }
.tabs-bar { display: flex; margin-bottom: 16px; background: #f5f7fa; border-radius: 8px; overflow: hidden; }
.tab-btn { flex: 1; padding: 10px; border: none; background: transparent; cursor: pointer; font-size: 14px; color: #666; transition: all 0.3s; font-family: inherit; }
.tab-btn.active { background: #fff; color: #667eea; font-weight: 600; box-shadow: 0 2px 8px rgba(102,126,234,0.15); }
.notification-list { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); min-height: 200px; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; color: #999; }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.notification-item { display: flex; align-items: flex-start; gap: 12px; padding: 16px 20px; border-bottom: 1px solid #f0f2f5; cursor: pointer; transition: background 0.2s; position: relative; }
.notification-item:hover { background: #f8f9fb; }
.notification-item.unread { background: #f0f4ff; }
.notif-dot { position: absolute; left: 10px; top: 22px; width: 6px; height: 6px; border-radius: 50%; background: #667eea; }
.notif-icon { width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 18px; flex-shrink: 0; margin-left: 6px; }
.notif-body { flex: 1; min-width: 0; }
.notif-title { font-size: 14px; font-weight: 500; color: #1a1a2e; margin-bottom: 4px; }
.notif-content { font-size: 13px; color: #666; line-height: 1.5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notif-time { font-size: 12px; color: #bbb; margin-top: 6px; }
.notif-close { background: none; border: none; color: #ccc; cursor: pointer; font-size: 14px; padding: 4px; opacity: 0; transition: opacity 0.2s; }
.notification-item:hover .notif-close { opacity: 1; }
.notif-close:hover { color: #f44336; }
.pagination-bar { display: flex; justify-content: center; padding: 16px; }
</style>
