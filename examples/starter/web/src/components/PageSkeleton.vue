<template>
  <div class="page-skeleton">
    <el-skeleton animated>
      <template #template>
        <el-skeleton-item variant="h1" style="width: 180px; height: 24px; margin-bottom: 20px;" />
        <el-skeleton-item variant="rect" style="width: 100%; height: 48px; margin-bottom: 16px; border-radius: 8px;" />
        <div v-for="i in rows" :key="i" style="display:flex;gap:12px;margin-bottom:14px;">
          <el-skeleton-item variant="circle" style="width: 36px; height: 36px; flex-shrink:0;" />
          <div style="flex:1;">
            <el-skeleton-item variant="text" style="width: 45%; height: 16px; margin-bottom: 8px;" />
            <el-skeleton-item variant="text" style="width: 80%; height: 14px;" />
          </div>
        </div>
      </template>
    </el-skeleton>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ rows?: number }>(), { rows: 5 });
</script>

<style scoped>
.page-skeleton { padding: 24px; background: var(--card-bg); border-radius: 12px; }
</style>
