<template>
  <div class="sec-alert">
    <div class="page-header">
      <h2 class="section-title">
        <span class="title-icon">🛡️</span> 安全事件监控
      </h2>
      <p class="page-subtitle">登录爆破、异常登录与高危操作告警（管理员可见）</p>
    </div>

    <div class="stats-row">
      <div v-for="s in statCards" :key="s.key" class="stat-card" :class="s.key">
        <div class="stat-num">{{ stats[s.key] ?? 0 }}</div>
        <div class="stat-label">{{ s.label }}</div>
      </div>
    </div>

    <div class="filter-bar">
      <el-select v-model="level" placeholder="全部级别" clearable size="small" style="width: 130px" @change="load">
        <el-option label="高危 HIGH" value="HIGH" />
        <el-option label="告警 WARN" value="WARN" />
      </el-select>
      <el-select v-model="type" placeholder="全部类型" clearable size="small" style="width: 160px" @change="load">
        <el-option label="登录失败" value="login_fail" />
        <el-option label="登录爆破" value="login_brute_force" />
        <el-option label="账号锁定" value="login_locked" />
      </el-select>
      <el-button size="small" @click="load">刷新</el-button>
    </div>

    <el-table :data="list" v-loading="loading" size="small" stripe style="width: 100%">
      <el-table-column prop="time" label="时间" width="170" />
      <el-table-column prop="level" label="级别" width="90">
        <template #default="{ row }">
          <el-tag :type="row.level === 'HIGH' || row.level === 'CRITICAL' ? 'danger' : 'warning'" size="small">
            {{ row.level }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column prop="type" label="事件类型" width="160">
        <template #default="{ row }">{{ typeLabel(row.type) }}</template>
      </el-table-column>
      <el-table-column prop="username" label="用户" width="120" />
      <el-table-column prop="ip" label="IP" width="140" />
      <el-table-column prop="detail" label="详情" min-width="220" />
    </el-table>
    <div v-if="list.length === 0 && !loading" class="empty">暂无安全告警记录</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getSecurityAlerts } from '../services/api';

const loading = ref(false);
const level = ref('');
const type = ref('');
const list = ref<any[]>([]);
const stats = ref<Record<string, number>>({});
const statCards = [
  { key: 'total', label: '总告警' },
  { key: 'high', label: '高危事件' },
  { key: 'brute_force', label: '登录爆破' },
  { key: 'login_fail', label: '登录失败' },
  { key: 'other', label: '其他' },
];

const TYPE_LABELS: Record<string, string> = {
  login_fail: '登录失败', login_brute_force: '登录爆破', login_locked: '账号锁定',
  change_password: '修改密码', create_user: '创建用户', delete_user: '删除用户',
};
const typeLabel = (t: string) => TYPE_LABELS[t] || t;

async function load() {
  loading.value = true;
  try {
    const res: any = await getSecurityAlerts({ level: level.value, type: type.value, limit: 200 });
    if (res.success) { list.value = res.data.list; stats.value = res.data.stats; }
  } catch { ElMessage.error('加载安全告警失败'); }
  finally { loading.value = false; }
}

onMounted(load);
</script>

<style scoped>
.sec-alert { padding: 20px 22px; }
.page-header { margin-bottom: 18px; }
.section-title { font-size: 22px; font-weight: 700; color: #1f2d3d; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
.title-icon { color: #667eea; }
.page-subtitle { font-size: 13px; color: #909399; margin: 0; }
.stats-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 16px; }
.stat-card { background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(16,42,82,.07); border-left: 3px solid #667eea; }
.stat-card.high { border-left-color: #f56c6c; }
.stat-card.brute_force { border-left-color: #e6a23c; }
.stat-num { font-size: 26px; font-weight: 700; color: #1f2d3d; }
.stat-label { font-size: 12px; color: #909399; margin-top: 4px; }
.filter-bar { display: flex; gap: 10px; margin-bottom: 14px; }
.empty { text-align: center; color: #c0c4cc; padding: 40px; font-size: 13px; }
</style>
