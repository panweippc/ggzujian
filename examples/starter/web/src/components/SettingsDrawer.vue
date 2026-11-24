<template>
  <el-drawer v-model="visible" title="布局与主题设置" size="320px" :with-header="true">
    <div class="settings-body">
      <div class="setting-section">
        <h4>主题风格</h4>
        <div class="theme-grid">
          <button
            v-for="t in themes"
            :key="t.key"
            class="theme-card"
            :class="{ active: current === t.key }"
            @click="setTheme(t.key)"
          >
            <span class="theme-ico">{{ t.icon }}</span>
            <span class="theme-name">{{ t.name }}</span>
            <span v-if="current === t.key" class="theme-check">✓</span>
          </button>
        </div>
      </div>

      <el-divider />

      <div class="setting-section">
        <h4>布局选项</h4>
        <div class="setting-row">
          <span>显示多标签页导航</span>
          <el-switch v-model="showTabs" @change="(v:boolean)=>updateLayout({showTabs:v})" />
        </div>
        <div class="setting-row">
          <span>紧凑模式</span>
          <el-switch v-model="compact" @change="(v:boolean)=>updateLayout({compact:v})" />
        </div>
        <div class="setting-row">
          <span>收起侧边栏</span>
          <el-switch v-model="sidebarCollapsed" @change="(v:boolean)=>updateLayout({sidebarCollapsed:v})" />
        </div>
      </div>

      <div class="settings-tip">
        <p>设置会自动保存到本地，下次进入仍生效。</p>
      </div>
    </div>
  </el-drawer>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useTheme } from '../composables/useTheme';

const visible = defineModel<boolean>('visible', { default: false });
const { current, themes, setTheme, layout, updateLayout } = useTheme();

const showTabs = ref(layout.value.showTabs);
const compact = ref(layout.value.compact);
const sidebarCollapsed = ref(layout.value.sidebarCollapsed);
watch(() => layout.value, (l) => {
  showTabs.value = l.showTabs; compact.value = l.compact; sidebarCollapsed.value = l.sidebarCollapsed;
}, { deep: true });
</script>

<style scoped>
.settings-body { padding: 4px 6px; }
.setting-section h4 { margin: 0 0 14px; font-size: 14px; color: var(--text-color); }
.theme-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.theme-card {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 16px 8px; border: 2px solid var(--border-color); border-radius: 10px;
  background: var(--card-bg); cursor: pointer; transition: all .2s; font-family: inherit;
}
.theme-card:hover { border-color: var(--primary-color); }
.theme-card.active { border-color: var(--primary-color); background: rgba(102,126,234,.06); }
.theme-ico { font-size: 26px; }
.theme-name { font-size: 12px; color: var(--text-color); }
.theme-check { position: absolute; top: 4px; right: 8px; color: var(--primary-color); font-weight: 700; }
.setting-row { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; font-size: 14px; color: var(--text-color); }
.settings-tip { margin-top: 24px; padding: 12px; background: var(--hover-bg); border-radius: 8px; font-size: 12px; color: var(--text-secondary); }
.settings-tip p { margin: 0; }
</style>
