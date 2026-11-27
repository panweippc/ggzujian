<template>
  <div class="page">
    <el-card class="box" shadow="never">
      <template #header>
        <div class="head">
          <div>
            <div class="title">安全自检</div>
            <div class="sub">集中执行密钥扫描、冗余代码审查与等保技术项自查，结果口径与 CI 门禁一致</div>
          </div>
          <el-tag type="warning" size="small">自查非测评</el-tag>
        </div>
      </template>

      <el-alert v-if="loadError" type="error" :closable="false" :title="loadError" show-icon />
      <template v-else>
        <div class="toolbar">
          <el-button size="small" @click="selectAll">全选</el-button>
          <el-button size="small" :disabled="!selected.length" @click="selected = []">清空</el-button>
          <el-select v-model="level" size="small" class="level-select">
            <el-option v-for="l in levels" :key="l" :label="l" :value="l" />
          </el-select>
          <el-button type="primary" size="small" :loading="running" :disabled="!selected.length" @click="run(false)">执行选中项</el-button>
          <el-button type="success" size="small" :loading="running" @click="run(true)">一键执行全部</el-button>
          <span v-if="ranAt" class="muted">最近执行：{{ ranAt }}</span>
        </div>

        <div class="checks">
          <div v-for="c in checks" :key="c.id" class="check-item" :class="{ active: selected.includes(c.id) }" @click="toggle(c.id, !selected.includes(c.id))">
            <el-checkbox :model-value="selected.includes(c.id)">
              <span class="check-name">{{ c.name }}</span>
            </el-checkbox>
            <div class="check-desc">{{ c.description }}</div>
            <el-tag size="small" type="info" class="check-tag">{{ c.result }}</el-tag>
          </div>
        </div>
        <el-empty v-if="!checks.length && !loadError" description="暂无可用检测项" :image-size="50" />
      </template>
    </el-card>

    <el-card v-if="results.length" class="box" shadow="never">
      <template #header>
        <div class="head">
          <span>检测结果</span>
          <span class="muted">
            通过 {{ summary.pass || 0 }} · 需关注 {{ summary.warn || 0 }} · 未通过 {{ summary.fail || 0 }} · 失败 {{ summary.error || 0 }}
          </span>
        </div>
      </template>
      <el-alert type="warning" :closable="false" :title="disclaimer" show-icon />
      <el-table :data="results" size="small" border class="result-table">
        <el-table-column prop="name" label="检测项" min-width="150" />
        <el-table-column label="结论" width="100">
          <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag></template>
        </el-table-column>
        <el-table-column label="摘要" min-width="260">
          <template #default="{ row }">
            <span v-if="row.error" class="danger-text">{{ row.error }}</span>
            <span v-else class="summary">{{ Object.entries(row.summary || {}).map(([k, v]) => k + ' ' + v).join(' · ') }}</span>
          </template>
        </el-table-column>
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.durationMs != null ? row.durationMs + ' ms' : '-' }}</template>
        </el-table-column>
        <el-table-column label="明细" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="!row.findings?.length" @click="openDetail(row)">查看</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="detailVisible" :title="current?.name + ' · 明细'" width="820px">
      <el-alert v-if="current?.note" type="info" :closable="false" :title="current.note" show-icon class="detail-note" />
      <el-table :data="current?.findings || []" size="small" border max-height="440">
        <el-table-column prop="level" label="级别" width="100" />
        <el-table-column label="位置" width="230">
          <template #default="{ row }">{{ row.file }}{{ row.line ? ':' + row.line : '' }}</template>
        </el-table-column>
        <el-table-column prop="message" label="说明" min-width="220" />
        <el-table-column prop="detail" label="补充" min-width="180" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button @click="detailVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getSecurityChecks, runSecurityChecks,
  type SecurityCheckItem, type SecurityCheckResult,
} from '../services/api';

const checks = ref<SecurityCheckItem[]>([]);
const selected = ref<string[]>([]);
const levels = ref<string[]>(['三级', '二级']);
const level = ref('三级');
const running = ref(false);
const loadError = ref('');
const results = ref<SecurityCheckResult[]>([]);
const summary = ref<Record<string, string | number | boolean>>({});
const disclaimer = ref('技术项自查，不构成等级保护测评结论；正式测评须由有资质机构出具');
const ranAt = ref('');
const detailVisible = ref(false);
const current = ref<SecurityCheckResult | null>(null);

const statusText = (s: string) => ({ pass: '通过', warn: '需关注', fail: '未通过', error: '执行失败' } as Record<string, string>)[s] || s;
const statusType = (s: string) => ({ pass: 'success', warn: 'warning', fail: 'danger', error: 'info' } as Record<string, string>)[s] || 'info';

const toggle = (id: string, on: unknown) => {
  const next = new Set(selected.value);
  if (on) next.add(id); else next.delete(id);
  selected.value = [...next];
};
const selectAll = () => { selected.value = checks.value.map((c) => c.id); };

const openDetail = (row: SecurityCheckResult) => { current.value = row; detailVisible.value = true; };

const run = async (all: boolean) => {
  const ids = all ? checks.value.map((c) => c.id) : selected.value;
  if (!ids.length || running.value) return;
  running.value = true;
  try {
    const r = await runSecurityChecks({ checks: ids, level: level.value });
    if (!r.success) {
      ElMessage.error('检测执行失败');
      return;
    }
    results.value = r.data?.results || [];
    summary.value = r.data?.summary || {};
    disclaimer.value = r.data?.disclaimer || disclaimer.value;
    ranAt.value = r.data?.ranAt || '';
    ElMessage.success('检测完成');
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || '检测执行失败';
    ElMessage.error(msg);
    if (e?.response?.status === 403) loadError.value = msg;
  } finally {
    running.value = false;
  }
};

onMounted(async () => {
  try {
    const r = await getSecurityChecks();
    if (!r.success) throw new Error('检测项加载失败');
    checks.value = r.data || [];
    levels.value = r.levels?.length ? r.levels : ['三级', '二级'];
    selected.value = checks.value.map((c) => c.id);
  } catch (e: any) {
    loadError.value = e?.response?.data?.message || e?.message || '检测项加载失败';
  }
});
</script>

<style scoped>
.page { padding: 16px; }
.box { margin-bottom: 16px; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.title { font-size: 16px; font-weight: 600; }
.sub { font-size: 12px; color: #909399; margin-top: 4px; }
.muted { font-size: 12px; color: #909399; }
.danger-text { color: #d03050; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; }
.level-select { width: 110px; }
.checks { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
.check-item { position: relative; border: 1px solid #e4e7ed; border-radius: 6px; padding: 12px; cursor: pointer; transition: border-color .2s; }
.check-item:hover { border-color: #409eff; }
.check-item.active { border-color: #409eff; background: #f5f9ff; }
.check-name { font-weight: 600; }
.check-desc { font-size: 12px; color: #606266; margin: 8px 0 10px 22px; line-height: 1.5; }
.check-tag { margin-left: 22px; }
.result-table { margin-top: 12px; }
.summary { font-size: 12px; color: #606266; }
.detail-note { margin-bottom: 12px; }
</style>
