<template>
  <div class="oplog">
    <h2 class="page-title">操作日志</h2>

    <!-- 筛选栏：照搬 qygl 的模块/操作/日期区间 + 查询/重置 -->
    <div class="filter-bar">
      <div class="filter-group">
        <label>模块</label>
        <el-select v-model="filters.module" placeholder="全部模块" clearable size="small" style="width: 150px">
          <el-option v-for="m in logFilters.modules" :key="m.value" :label="m.label" :value="m.value" />
        </el-select>
      </div>
      <div class="filter-group">
        <label>操作</label>
        <el-select v-model="filters.action" placeholder="全部操作" clearable size="small" style="width: 130px">
          <el-option v-for="a in logFilters.actions" :key="a.value" :label="a.label" :value="a.value" />
        </el-select>
      </div>
      <div class="filter-group" v-if="logFilters.showDateRange">
        <label>开始日期</label>
        <el-date-picker v-model="filters.startDate" type="date" placeholder="开始日期" size="small" style="width: 145px" value-format="YYYY-MM-DD" />
      </div>
      <div class="filter-group" v-if="logFilters.showDateRange">
        <label>结束日期</label>
        <el-date-picker v-model="filters.endDate" type="date" placeholder="结束日期" size="small" style="width: 145px" value-format="YYYY-MM-DD" />
      </div>
      <el-button type="primary" size="small" @click="search">查询</el-button>
      <el-button size="small" @click="resetFilters">重置</el-button>
      <el-button size="small" @click="exportAudit">审计导出</el-button>
      <el-button size="small" @click="policyVisible = true">脱敏策略</el-button>
    </div>

    <!-- 脱敏策略配置弹窗 -->
    <el-dialog v-model="policyVisible" title="导出脱敏策略" width="440px">
      <el-form label-width="130px">
        <el-form-item label="IP 地址脱敏"><el-switch v-model="policy.maskIp" /></el-form-item>
        <el-form-item label="用户名脱敏"><el-switch v-model="policy.maskUsername" /></el-form-item>
        <el-form-item label="导出水印"><el-switch v-model="policy.watermark" /></el-form-item>
        <el-form-item label="水印文字"><el-input v-model="policy.watermarkText" :disabled="!policy.watermark" /></el-form-item>
      </el-form>
      <p class="policy-tip">策略保存在本地，导出审计日志时自动应用。</p>
      <template #footer>
        <el-button size="small" @click="policyVisible = false">取消</el-button>
        <el-button type="primary" size="small" @click="savePolicy">保存</el-button>
      </template>
    </el-dialog>

    <!-- 表格：照搬 qygl 的可展开变更详情 + 时间/操作人/操作tag/模块/对象/详情/IP -->
    <div class="log-table">
      <el-table :data="rows" v-loading="loading" size="small" style="width: 100%" empty-text="暂无操作日志">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div v-if="hasDiff(row)" class="diff-detail">
              <h4>数据变更详情</h4>
              <div class="diff-grid">
                <div class="diff-col">
                  <div class="diff-title">变更前</div>
                  <div v-for="(v, k) in parseDiff(row.beforeValue)" :key="k" class="diff-item">
                    <span class="diff-key">{{ fieldLabel(k) }}</span><span class="diff-val old">{{ v ?? '（空）' }}</span>
                  </div>
                  <div v-if="!Object.keys(parseDiff(row.beforeValue)).length" class="diff-empty">（无）</div>
                </div>
                <div class="diff-col">
                  <div class="diff-title">变更后</div>
                  <div v-for="(v, k) in parseDiff(row.afterValue)" :key="k" class="diff-item">
                    <span class="diff-key">{{ fieldLabel(k) }}</span><span class="diff-val new">{{ v ?? '（空）' }}</span>
                  </div>
                  <div v-if="!Object.keys(parseDiff(row.afterValue)).length" class="diff-empty">（无）</div>
                </div>
              </div>
            </div>
            <div v-else class="diff-detail diff-none">本次操作无可展开的数据变更详情</div>
          </template>
        </el-table-column>
        <el-table-column v-for="col in logColumns" :key="col.prop" :prop="col.prop" :label="col.label" :width="col.width" :min-width="col.minWidth" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="col.prop === 'createdAt'">{{ fmt(row.createdAt) }}</template>
            <template v-else-if="col.prop === 'module'">{{ moduleLabel(row.module) }}</template>
            <template v-else-if="col.prop === 'action'"><el-tag size="small" :type="actionTag(row.action)">{{ actionLabel(row.action) }}</el-tag></template>
            <template v-else>{{ row[col.prop] || '—' }}</template>
          </template>
        </el-table-column>
      </el-table>
      <div class="pagination-bar" v-if="total > 0">
        <el-pagination
          layout="total, prev, pager, next" :total="total" :page-size="pageSize"
          v-model:current-page="page" background small @current-change="loadLogs" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getLogs } from '../services/api';
import { exportExcel } from '../utils/excel';
import { getMaskPolicy, saveMaskPolicy, applyMaskPolicy, watermarkLabel, type MaskPolicy } from '../utils/mask';
import {
  LOG_FILTERS, LOG_COLUMNS,
  ACTION_LABELS, MODULE_LABELS, FIELD_LABELS, ACTION_TAGS,
} from '../config';

const logFilters = LOG_FILTERS;
const logColumns = LOG_COLUMNS;

const loading = ref(false);
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const filters = reactive<{ module: string; action: string; startDate: string; endDate: string }>({
  module: '', action: '', startDate: '', endDate: '',
});

// 脱敏策略 + 审计导出
const policyVisible = ref(false);
const policy = ref<MaskPolicy>(getMaskPolicy());
function savePolicy() { saveMaskPolicy(policy.value); policyVisible.value = false; ElMessage.success('策略已保存'); }
function exportAudit() {
  if (!rows.value.length) return ElMessage.warning('暂无数据可导出');
  const cleaned = rows.value.map((r) => applyMaskPolicy({
    createdAt: fmt(r.createdAt), username: r.username, action: actionLabel(r.action),
    module: moduleLabel(r.module), targetName: r.targetName, detail: r.detail, ipAddress: r.ipAddress
  }, policy.value));
  exportExcel(cleaned, [
    { key: 'createdAt', label: '时间', width: 20 }, { key: 'username', label: '操作人', width: 14 },
    { key: 'action', label: '操作', width: 12 }, { key: 'module', label: '模块', width: 14 },
    { key: 'targetName', label: '操作对象', width: 20 }, { key: 'detail', label: '详情', width: 40 },
    { key: 'ipAddress', label: 'IP', width: 16 },
  ], `审计日志${watermarkLabel(policy.value)}`, '审计日志');
  ElMessage.success('审计日志已导出（已应用脱敏策略）');
}

// 映射函数（照搬 qygl，映射表在 config）
const actionLabel = (a: string) => ACTION_LABELS[a] || a || '—';
const moduleLabel = (m: string) => MODULE_LABELS[m] || m || '—';
const fieldLabel = (k: string) => FIELD_LABELS[k] || k;
const actionTag = (a: string): any => ACTION_TAGS[a] || 'info';
const fmt = (v: any) => (v ? String(v).replace('T', ' ').slice(0, 19) : '—');

// beforeValue/afterValue 可能是 JSON 字符串或对象，兼容解析
const parseDiff = (v: any): Record<string, any> => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try { return JSON.parse(v); } catch { return {}; }
};
const hasDiff = (row: any) => Object.keys(parseDiff(row.beforeValue)).length > 0 || Object.keys(parseDiff(row.afterValue)).length > 0;

async function loadLogs() {
  loading.value = true;
  try {
    const res = await getLogs({
      page: page.value, pageSize,
      module: filters.module, action: filters.action,
    });
    if (res.success) { rows.value = res.data; total.value = res.total; }
    else ElMessage.error('日志加载失败');
  } catch { ElMessage.error('日志加载失败'); }
  finally { loading.value = false; }
}
function search() { page.value = 1; loadLogs(); }
function resetFilters() {
  filters.module = ''; filters.action = ''; filters.startDate = ''; filters.endDate = '';
  page.value = 1;
  loadLogs();
}

onMounted(loadLogs);
</script>

<style scoped>
.oplog { padding: 20px 22px; }
.page-title { font-size: 22px; font-weight: 700; color: #1f2d3d; margin: 0 0 18px; }

/* 筛选栏：白底圆角卡片，科技蓝主色 */
.filter-bar {
  display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; flex-wrap: wrap;
  background: #fff; padding: 16px 20px; border-radius: 12px; box-shadow: 0 1px 4px rgba(16, 42, 82, .07);
}
.filter-group { display: flex; flex-direction: column; gap: 5px; }
.filter-group label { font-size: 12px; color: #909399; }

/* 表格卡片 */
.log-table { background: #fff; border-radius: 12px; box-shadow: 0 1px 4px rgba(16, 42, 82, .07); padding: 8px; }
.pagination-bar { display: flex; justify-content: center; padding: 16px; }

/* 变更详情 diff */
.diff-detail { padding: 12px 16px; }
.diff-detail h4 { margin: 0 0 10px; font-size: 13px; color: #1f2d3d; }
.diff-none { color: #a0a8b5; font-size: 13px; }
.diff-grid { display: flex; gap: 24px; }
.diff-col { flex: 1; }
.diff-title { font-size: 12px; color: #909399; margin-bottom: 6px; font-weight: 600; }
.diff-item { display: flex; gap: 8px; padding: 2px 0; font-size: 13px; align-items: baseline; }
.diff-key { color: #606266; min-width: 70px; }
.diff-val.old { color: #d9534f; }
.diff-val.new { color: #28a745; }
.diff-empty { color: #c0c4cc; font-size: 12px; }
.policy-tip { font-size: 12px; color: #909399; margin: 0; padding: 0 0 4px 130px; }
</style>
