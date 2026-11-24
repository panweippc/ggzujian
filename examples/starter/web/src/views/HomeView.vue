<template>
  <div class="home">
    <h2 class="page-title">工作台</h2>
    <p class="page-sub">欢迎回来，{{ userStore.displayName }}。这里是骨架示例的工作台，可按需替换成你的业务看板。</p>

    <el-row :gutter="16" class="stat-row">
      <el-col :span="8" v-for="card in cards" :key="card.label">
        <el-card class="stat-card" shadow="hover">
          <div class="stat-ico" :style="{ background: card.bg }" v-html="card.icon"></div>
          <div class="stat-body">
            <div class="stat-value">{{ card.value }}</div>
            <div class="stat-label">{{ card.label }}</div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="tip-card" shadow="never">
      <template #header><span class="tip-title">🚀 骨架使用说明</span></template>
      <ol class="tip-list">
        <li>所有品牌与配置集中在 <code>src/config.ts</code>，新项目只改这一个文件。</li>
        <li>后端接口封装在 <code>src/services/api.ts</code>，按自己的后端补充函数。</li>
        <li>RBAC 底座（登录/验证码/鉴权拦截器/空闲登出）来自 <code>@panweippc/admin-ui</code> 与 <code>@panweippc/auth-kit</code>。</li>
        <li>系统管理、操作日志页面的字段与筛选项均从 config 读取，无需改组件。</li>
      </ol>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useUserStore } from '../stores/user';
import { getUsers, getLogs } from '../services/api';

const userStore = useUserStore();
const userCount = ref(0);
const logCount = ref(0);

const cards = computed(() => [
  { label: '用户总数', value: userCount.value, bg: 'rgba(74,168,255,.14)', icon: ICON('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>', '#1E5AA8') },
  { label: '操作日志', value: logCount.value, bg: 'rgba(52,211,153,.15)', icon: ICON('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>', '#0f9d76') },
  { label: '系统状态', value: '正常', bg: 'rgba(251,191,36,.16)', icon: ICON('<path d="M12 3l9 16H3z"/><path d="M12 9v4M12 16v.5"/>', '#c28706') },
]);

function ICON(path: string, color: string) {
  return `<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}

onMounted(async () => {
  try {
    const [u, l] = await Promise.all([getUsers(), getLogs({ page: 1, pageSize: 1 })]);
    userCount.value = u.total || 0;
    logCount.value = l.total || 0;
  } catch { /* 忽略统计失败 */ }
});
</script>

<style scoped>
.home { padding: 20px; }
.page-title { font-size: 20px; font-weight: 700; color: #1f2d3d; margin: 0 0 6px; }
.page-sub { color: #606266; font-size: 13px; margin: 0 0 20px; }
.stat-row { margin-bottom: 20px; }
.stat-card { display: flex; align-items: center; gap: 14px; min-height: 100px; }
.stat-card :deep(.el-card__body) { display: flex; align-items: center; gap: 14px; width: 100%; }
.stat-ico { width: 52px; height: 52px; border-radius: 13px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.stat-value { font-size: 26px; font-weight: 700; color: #1f2d3d; line-height: 1.1; }
.stat-label { font-size: 13px; color: #909399; margin-top: 4px; }
.tip-card { max-width: 900px; }
.tip-title { font-weight: 700; color: #1f2d3d; }
.tip-list { margin: 0; padding-left: 20px; color: #606266; font-size: 14px; line-height: 2; }
.tip-list code { background: #f0f4fa; color: #1E5AA8; padding: 1px 6px; border-radius: 4px; font-size: 13px; }
</style>
