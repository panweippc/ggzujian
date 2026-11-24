<template>
  <div class="monitor-view">
    <PageHeaderBar title="系统监控">
      <template #actions>
        <el-button size="small" @click="load">刷新</el-button>
      </template>
    </PageHeaderBar>

    <div class="mv-body" v-loading="loading">
      <!-- 服务状态卡片 -->
      <div class="stat-cards">
        <div class="stat-card">
          <div class="sc-ico cpu">🖥</div>
          <div><div class="sc-label">CPU 使用率</div><div class="sc-value">{{ data?.cpu?.usagePercent ?? '--' }}<small>%</small></div></div>
        </div>
        <div class="stat-card">
          <div class="sc-ico mem">💾</div>
          <div><div class="sc-label">内存使用率</div><div class="sc-value">{{ data?.memory?.usagePercent ?? '--' }}<small>%</small></div></div>
        </div>
        <div class="stat-card">
          <div class="sc-ico db">🗄</div>
          <div><div class="sc-label">数据库</div><div class="sc-value service" :class="data?.services?.database">{{ data?.services?.database === 'up' ? '正常' : '异常' }}</div></div>
        </div>
        <div class="stat-card">
          <div class="sc-ico up">⏱</div>
          <div><div class="sc-label">运行时长</div><div class="sc-value small-val">{{ uptimeText }}</div></div>
        </div>
      </div>

      <!-- 图表 -->
      <el-row :gutter="16">
        <el-col :span="12">
          <div class="chart-card"><h3>内存使用</h3><div ref="memChart" class="chart"></div></div>
        </el-col>
        <el-col :span="12">
          <div class="chart-card"><h3>磁盘空间</h3><div ref="diskChart" class="chart"></div></div>
        </el-col>
      </el-row>

      <!-- 系统信息 -->
      <div class="info-card">
        <h3>系统信息</h3>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="平台">{{ data?.system?.platform }} / {{ data?.system?.arch }}</el-descriptions-item>
          <el-descriptions-item label="Node 版本">{{ data?.system?.nodeVersion }}</el-descriptions-item>
          <el-descriptions-item label="主机名">{{ data?.system?.hostname }}</el-descriptions-item>
          <el-descriptions-item label="CPU 型号" :span="2">{{ data?.cpu?.model }}</el-descriptions-item>
          <el-descriptions-item label="逻辑核心">{{ data?.cpu?.count }}</el-descriptions-item>
          <el-descriptions-item label="内存总量" :span="3">{{ formatBytes(data?.memory?.total) }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue';
import * as echarts from 'echarts';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import { getMonitor } from '../services/api';

const loading = ref(false);
const data = ref<any>(null);
const memChart = ref<HTMLElement>();
const diskChart = ref<HTMLElement>();
let memInstance: echarts.ECharts | null = null;
let diskInstance: echarts.ECharts | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const uptimeText = computed(() => {
  const s = data.value?.system?.uptime || 0;
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return `${d}天 ${h}小时 ${m}分`;
});
function formatBytes(b?: number) { return b ? (b / 1024 / 1024 / 1024).toFixed(2) + ' GB' : '--'; }

async function load() {
  loading.value = true;
  try { const r = await getMonitor(); if (r.success) { data.value = r.data; await nextTick(); renderCharts(); } }
  finally { loading.value = false; }
}
function renderCharts() {
  const d = data.value;
  if (memChart.value) {
    memInstance ||= echarts.init(memChart.value);
    const used = d?.memory ? d.memory.used / 1024 / 1024 / 1024 : 0;
    const total = d?.memory ? d.memory.total / 1024 / 1024 / 1024 : 0;
    memInstance.setOption({
      tooltip: { trigger: 'item', formatter: '{b}: {c} GB' },
      series: [{ type: 'pie', radius: ['45%', '70%'], label: { formatter: '{b}\n{d}%' },
        data: [{ value: +used.toFixed(2), name: '已用' }, { value: +(total - used).toFixed(2), name: '空闲' }],
        color: ['#667eea', '#eef1f9'] }]
    }, true);
  }
  if (diskChart.value) {
    diskInstance ||= echarts.init(diskChart.value);
    const disks = d?.disks || [];
    diskInstance.setOption({
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: disks.map((x: any) => x.caption) },
      yAxis: { type: 'value', max: 100, axisLabel: { formatter: '{value}%' } },
      series: [{ type: 'bar', data: disks.map((x: any) => x.usagePercent), itemStyle: { color: '#764ba2', borderRadius: [5, 5, 0, 0] }, barWidth: '40%' }]
    }, true);
  }
}
function onResize() { memInstance?.resize(); diskInstance?.resize(); }

onMounted(() => { load(); timer = setInterval(load, 15_000); window.addEventListener('resize', onResize); });
onUnmounted(() => { if (timer) clearInterval(timer); window.removeEventListener('resize', onResize); memInstance?.dispose(); diskInstance?.dispose(); });
</script>

<style scoped>
.monitor-view { min-height: 100%; display: flex; flex-direction: column; }
.mv-body { padding: 20px 24px; flex: 1; }
.stat-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 16px; }
.stat-card { display: flex; align-items: center; gap: 14px; background: var(--card-bg); border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.sc-ico { width: 46px; height: 46px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 24px; background: rgba(102,126,234,.1); }
.sc-label { font-size: 12px; color: var(--text-secondary); }
.sc-value { font-size: 26px; font-weight: 700; color: var(--text-color); margin-top: 4px; }
.sc-value small { font-size: 14px; color: var(--text-secondary); }
.sc-value.service { font-size: 18px; }
.sc-value.up { color: #67c23a; }
.sc-value.down { color: #f56c6c; }
.small-val { font-size: 17px; }
.chart-card, .info-card { background: var(--card-bg); border-radius: 12px; padding: 18px; box-shadow: 0 1px 3px rgba(0,0,0,.06); margin-bottom: 16px; }
.chart-card h3, .info-card h3 { margin: 0 0 12px; font-size: 15px; color: var(--text-color); }
.chart { height: 240px; }
@media (max-width: 900px) { .stat-cards { grid-template-columns: 1fr 1fr; } }
</style>
