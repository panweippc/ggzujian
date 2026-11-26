<template>
  <el-dropdown trigger="click" @command="onCommand">
    <span class="locale-trigger" :title="t('common.language') || '语言'">🌐 {{ locale }}</span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-for="l in availableLocales" :key="l" :command="l" :disabled="l === locale">
          {{ l === 'zh-CN' ? '简体中文' : 'English' }}
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>
<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { locale, availableLocales, setLocale, t } from '../i18n';
function onCommand(l: string) {
  setLocale(l);
  ElMessage.success(`已切换为 ${l}`);
  // Element Plus 组件内部文案需刷新页面才能完全切换（locale 在挂载时注入）
}
</script>
<style scoped>
.locale-trigger { cursor: pointer; font-size: 13px; color: var(--el-text-color-regular); padding: 0 8px; }
</style>
