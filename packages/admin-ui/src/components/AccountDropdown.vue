<template>
  <el-dropdown trigger="click" @command="onCommand">
    <span class="ak-account__trigger">
      <el-avatar :size="30" :src="config.avatar">{{ initial }}</el-avatar>
      <span class="ak-account__name">{{ config.displayName }}</span>
      <el-icon><ArrowDown /></el-icon>
    </span>
    <template #dropdown>
      <el-dropdown-menu>
        <el-dropdown-item v-for="item in config.items" :key="item.command" :command="item.command" :divided="item.divided">
          <el-icon v-if="item.icon"><component :is="item.icon" /></el-icon>{{ item.label }}
        </el-dropdown-item>
        <slot name="extra-items" />
      </el-dropdown-menu>
    </template>
  </el-dropdown>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ArrowDown } from '@element-plus/icons-vue';

export interface AccountMenuItem {
  command: string;
  label: string;
  icon?: any;       // Element Plus 图标组件
  divided?: boolean;
}
export interface AccountConfig {
  displayName: string;
  avatar?: string;
  items: AccountMenuItem[];  // 如 个人中心/修改密码/退出登录
}

const props = defineProps<{ config: AccountConfig }>();
const emit = defineEmits<{ (e: 'command', command: string): void }>();

const initial = computed(() => String(props.config.displayName || '?').slice(0, 1).toUpperCase());
const onCommand = (command: string) => emit('command', command);
</script>

<style scoped>
.ak-account__trigger { display: flex; align-items: center; gap: 8px; cursor: pointer; color: #fff; outline: none; }
.ak-account__name { font-size: 14px; }
</style>
