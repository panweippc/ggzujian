<template>
  <el-dialog
    :model-value="visible"
    @update:model-value="(v: boolean) => { if (!v) close() }"
    width="640px"
    :show-close="true"
    class="gs-dialog"
    @open="onOpen"
    @closed="onClosed"
  >
    <div class="gs-box">
      <div class="gs-input-row">
        <span class="gs-ico">⌕</span>
        <input
          ref="inputRef"
          v-model="localKeyword"
          class="gs-input"
          placeholder="搜索 菜单 / 用户 / 操作日志"
          @input="onInput(localKeyword)"
          @keydown.up.prevent="move(-1)"
          @keydown.down.prevent="move(1)"
          @keydown.enter.prevent="goActive"
        />
        <span class="gs-esc">ESC</span>
      </div>

      <div class="gs-body" v-loading="loading">
        <el-empty
          v-if="!keyword || (!loading && total === 0)"
          :description="keyword ? '没有找到相关内容' : '输入关键词开始搜索'"
          :image-size="90"
        />
        <div v-else class="gs-results">
          <div v-for="(g, gi) in results" :key="g.module" class="gs-group">
            <div class="gs-group-title">{{ g.label }}</div>
            <div
              v-for="(it, ii) in g.items"
              :key="g.module + '-' + it.id"
              class="gs-item"
              :class="{ on: activeIndex === globalIndex(gi, ii) }"
              @mouseenter="activeIndex = globalIndex(gi, ii)"
              @click="go(it)"
            >
              <span class="gs-badge" :class="'gs-badge-' + it.type">{{ typeLabel(it.type) }}</span>
              <div class="gs-text">
                <div class="gs-title" v-html="highlight(it.title, keyword)"></div>
                <div class="gs-sub">{{ it.sub }}</div>
              </div>
              <span class="gs-arrow">↵</span>
            </div>
          </div>
        </div>
      </div>

      <div class="gs-foot">
        <span>↑↓ 选择</span><span>↵ 打开</span><span>ESC 关闭</span>
        <span class="gs-foot-right">共 {{ total }} 条结果</span>
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { useGlobalSearch, type SearchItem } from '../composables/useGlobalSearch';

const router = useRouter();
const { visible, keyword, results, total, loading, close, onInput } = useGlobalSearch();
const localKeyword = ref('');
const inputRef = ref<HTMLInputElement | null>(null);
const activeIndex = ref(0);

const flatItems = computed(() => results.value.flatMap((g) => g.items));
function globalIndex(gi: number, ii: number) {
  let idx = 0;
  for (let i = 0; i < gi; i++) idx += results.value[i].items.length;
  return idx + ii;
}
function typeLabel(t: string) {
  return ({ menu: '菜单', user: '用户', log: '日志' } as Record<string, string>)[t] || t;
}
function highlight(text: string, kw: string) {
  if (!kw) return text;
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(esc, 'gi'), (m) => `<mark>${m}</mark>`);
}
function onOpen() { nextTick(() => inputRef.value?.focus()); }
function onClosed() { activeIndex.value = 0; }
function move(d: number) {
  const n = flatItems.value.length;
  if (!n) return;
  activeIndex.value = (activeIndex.value + d + n) % n;
}
function goActive() { const it = flatItems.value[activeIndex.value]; if (it) go(it); }
function go(it: SearchItem) { close(); router.push({ path: it.route, query: it.query || {} }); }
</script>

<style scoped>
.gs-box { display: flex; flex-direction: column; min-height: 200px; }
.gs-input-row {
  display: flex; align-items: center; gap: 10px;
  border: 1.5px solid #667eea; border-radius: 8px; padding: 10px 12px;
  box-shadow: 0 0 0 3px rgba(102, 126, 234, .1);
}
.gs-ico { font-size: 18px; color: #667eea; }
.gs-input { flex: 1; border: none; outline: none; font-size: 15px; background: transparent; color: #303133; }
.gs-esc { font-size: 11px; color: #909399; border: 1px solid #dcdfe6; border-radius: 4px; padding: 0 5px; }
.gs-body { margin-top: 12px; max-height: 420px; overflow-y: auto; min-height: 120px; }
.gs-group { margin-bottom: 10px; }
.gs-group-title { font-size: 12px; color: #909399; margin: 8px 0 6px; font-weight: 600; }
.gs-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.gs-item.on { background: linear-gradient(90deg, rgba(102,126,234,.1), rgba(118,75,162,.06)); }
.gs-badge { flex-shrink: 0; font-size: 11px; color: #fff; border-radius: 6px; padding: 2px 7px; min-width: 32px; text-align: center; background: #909399; }
.gs-badge-menu { background: #667eea; }
.gs-badge-user { background: #378add; }
.gs-badge-log { background: #764ba2; }
.gs-text { flex: 1; min-width: 0; }
.gs-title { font-size: 14px; color: #303133; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.gs-title :deep(mark) { background: #fde9a9; color: inherit; border-radius: 3px; padding: 0 2px; }
.gs-sub { font-size: 12px; color: #909399; margin-top: 2px; }
.gs-arrow { color: #c0c4cc; font-size: 13px; }
.gs-foot { display: flex; align-items: center; gap: 14px; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eef0f7; font-size: 11px; color: #909399; }
.gs-foot-right { margin-left: auto; }
</style>
