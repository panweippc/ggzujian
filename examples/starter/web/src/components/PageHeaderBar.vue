<template>
  <header class="phb-header">
    <div class="phb-logo">
      <span class="phb-logo-mark">{{ BRAND.logo }}</span>
      <span class="phb-logo-text">{{ BRAND.title }}</span>
    </div>
    <nav class="phb-nav">
      <router-link to="/" class="phb-item"><span class="phb-ico">🏠</span>首页</router-link>
      <span v-if="title" class="phb-item phb-current active">{{ title }}</span>
      <span v-if="$slots.actions" class="phb-actions"><slot name="actions" /></span>
      <button type="button" class="phb-item phb-recycle" @click="openRecycleBin" title="回收站：恢复近 30 天删除的记录">
        <span class="phb-ico">♻</span><span>回收站</span>
      </button>
      <button class="phb-item phb-back" @click="handleBack"><span class="phb-ico">↩</span>返回</button>
    </nav>
  </header>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router';
import { useRecycleBin } from '../composables/useRecycleBin';
import { BRAND } from '../config';

/**
 * 全站统一页头（照搬 qy 的 PageHeaderBar，品牌名/Logo 改走 config 配置）。
 * 结构：品牌 ｜ 首页 · 当前页(高亮) · [自定义操作] · 回收站 · 返回
 */
const props = withDefaults(defineProps<{
  title?: string;
  backTo?: string;
}>(), { title: '', backTo: '' });

const router = useRouter();
const route = useRoute();
const { open: openRecycleBin } = useRecycleBin();

function handleBack() {
  if (props.backTo) { router.push(props.backTo); return; }
  if (route.query.fromNotification) { router.push('/'); return; }
  const state = window.history.state as { back?: string | null } | null;
  if (state && state.back) router.back();
  else router.push('/');
}
</script>

<style scoped>
.phb-header {
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid rgba(102, 126, 234, 0.2);
  padding: 0 24px; min-height: 60px;
  display: flex; align-items: center; justify-content: space-between;
  position: relative; z-index: 100;
  box-shadow: 0 2px 10px rgba(102, 126, 234, 0.06); flex-shrink: 0;
}
.phb-logo { display: flex; align-items: center; gap: 10px; }
.phb-logo-mark {
  font-size: 20px; color: #fff; width: 32px; height: 32px; border-radius: 8px;
  display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #667eea, #764ba2);
  box-shadow: 0 3px 10px rgba(102, 126, 234, 0.35);
}
.phb-logo-text {
  font-size: 18px; font-weight: 700;
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.phb-nav { display: flex; gap: 8px; align-items: center; justify-content: flex-end; width: 100%; max-width: 820px; flex-wrap: wrap; }
.phb-item {
  white-space: nowrap; color: rgba(51, 51, 51, 0.8); text-decoration: none;
  padding: 8px 13px; border-radius: 6px; font-size: 14px; font-weight: 500;
  transition: all 0.25s ease; border: 1px solid transparent; background: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
}
.phb-item:hover, .phb-item.active {
  color: #667eea; background: rgba(102, 126, 234, 0.1); border-color: rgba(102, 126, 234, 0.22);
}
.phb-current { cursor: default; }
.phb-actions { display: flex; align-items: center; gap: 8px; }
.phb-recycle { border-color: rgba(102, 126, 234, 0.28); background: rgba(102, 126, 234, 0.06); color: #667eea; }
.phb-recycle:hover { background: rgba(102, 126, 234, 0.16); }
.phb-back { background: rgba(244, 67, 54, 0.08); color: #d32f2f; border-color: rgba(244, 67, 54, 0.25); }
.phb-back:hover { background: rgba(244, 67, 54, 0.16); color: #c62828; }
.phb-ico { font-size: 15px; line-height: 1; }
@media (max-width: 768px) { .phb-header { padding: 0 12px; } .phb-nav { max-width: none; } }
</style>
