<template>
  <div class="ak-at">
    <div class="ak-at__toolbar">
      <el-input v-if="config.searchable !== false" v-model="keyword" clearable placeholder="搜索"
                size="small" class="ak-at__search" @input="onSearch" />
      <el-select v-if="columnOptions.length" v-model="visibleCols" multiple collapse-tags collapse-tags-tooltip
                 size="small" class="ak-at__cols" placeholder="显示列" @change="persistCols">
        <el-option v-for="c in columnOptions" :key="c.prop" :label="c.label" :value="c.prop" />
      </el-select>
      <div class="ak-at__tools">
        <el-tooltip content="紧凑/默认行高" placement="top">
          <el-button size="small" :icon="densityIcon" @click="toggleDensity" />
        </el-tooltip>
        <el-button v-if="config.exportFilename" size="small" @click="exportCsv">导出</el-button>
        <slot name="toolbar" />
      </div>
    </div>

    <el-table
      ref="tableRef" :data="pagedRows" v-loading="loading"
      :size="density === 'compact' ? 'small' : 'default'" border
      :row-key="config.rowKey || 'id'" :default-sort="defaultSort"
      @sort-change="onSortChange" :row-class-name="rowClassName"
      @selection-change="(v:any)=>emit('selection-change', v)"
      style="width:100%"
    >
      <el-table-column v-if="config.selectable" type="selection" width="46" />
      <el-table-column
        v-for="col in shownColumns" :key="col.prop" :prop="col.prop" :label="col.label"
        :width="col.width" :min-width="col.minWidth" :align="col.align || 'left'"
        :sortable="col.sortable === false ? false : 'custom'" :fixed="col.fixed"
      >
        <template #default="scope">
          <slot :name="'cell-' + col.prop" :row="scope.row" :value="scope.row[col.prop]">
            {{ formatCell(scope.row[col.prop], col, scope.row) }}
          </slot>
        </template>
      </el-table-column>
      <el-table-column v-if="config.actions !== false" label="操作" :width="config.actionWidth || 160" fixed="right">
        <template #default="scope"><slot name="actions" :row="scope.row" /></template>
      </el-table-column>
    </el-table>

    <el-pagination
      v-if="config.pagination !== false" class="ak-at__pager" background
      layout="total,sizes,prev,pager,next,jumper" :total="filteredRows.length"
      v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { Fold, Expand } from '@element-plus/icons-vue';

export interface AdvancedColumn {
  prop: string; label: string; width?: number; minWidth?: number;
  align?: 'left' | 'center' | 'right'; sortable?: boolean; fixed?: boolean | 'left' | 'right';
  formatter?: (v: any, row: any) => string; valueKey?: string;
}
export interface AdvancedTableConfig {
  columns: AdvancedColumn[];
  list: (params?: any) => Promise<any[] | { data: any[] }>;
  rowKey?: string;
  searchable?: boolean;
  searchFields?: string[];          // 限定搜索列，未传则搜所有列
  selectable?: boolean;
  pagination?: boolean;
  exportFilename?: string;          // 传了才显示导出按钮
  actionWidth?: number;
  actions?: boolean;
  columnPersistKey?: string;        // 列显隐持久化到 localStorage 的 key
  rowClassName?: (row: any) => string;
  density?: 'default' | 'compact';
}

const props = defineProps<{ config: AdvancedTableConfig }>();
const emit = defineEmits<{ 'selection-change': [rows: any[]] }>();

const rows = ref<any[]>([]);
const loading = ref(false);
const keyword = ref('');
const page = ref(1);
const pageSize = ref(10);
const sortState = ref<{ prop: string; order: 'ascending' | 'descending' } | null>(null);
const density = ref<'default' | 'compact'>(props.config.density || 'default');
const tableRef = ref<any>();

const columnOptions = computed(() => props.config.columns);
const visibleCols = ref<string[]>(props.config.columns.map((c) => c.prop));
const shownColumns = computed(() => props.config.columns.filter((c) => visibleCols.value.includes(c.prop)));
const defaultSort = computed(() => {
  const first = props.config.columns.find((c) => c.sortable !== false);
  return first ? { prop: first.prop, order: 'ascending' as const } : undefined;
});
const densityIcon = computed(() => (density.value === 'compact' ? Expand : Fold));

function formatCell(v: any, col: AdvancedColumn, row: any) {
  const key = col.valueKey || col.prop;
  const raw = key.split('.').reduce((o: any, k) => (o == null ? o : o[k]), row);
  return col.formatter ? col.formatter(raw, row) : (raw ?? '');
}

const filteredRows = computed(() => {
  let out = rows.value.slice();
  const kw = keyword.value.trim().toLowerCase();
  if (kw) {
    const fields = props.config.searchFields || props.config.columns.map((c) => c.prop);
    out = out.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(kw)));
  }
  if (sortState.value) {
    const { prop: p, order } = sortState.value;
    out = out.slice().sort((a, b) => {
      const av = a[p], bv = b[p];
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''), 'zh-CN');
      return order === 'ascending' ? cmp : -cmp;
    });
  }
  return out;
});
const pagedRows = computed(() => {
  if (props.config.pagination === false) return filteredRows.value;
  const start = (page.value - 1) * pageSize.value;
  return filteredRows.value.slice(start, start + pageSize.value);
});

function onSearch() { page.value = 1; }
function onSortChange({ prop, order }: { prop: string; order: string | null }) {
  sortState.value = order && prop ? { prop, order: order as any } : null;
}
function rowClassName({ row }: { row: any }) {
  return props.config.rowClassName ? props.config.rowClassName(row) : '';
}
function toggleDensity() { density.value = density.value === 'compact' ? 'default' : 'compact'; }

function persistCols() {
  if (props.config.columnPersistKey) {
    try { localStorage.setItem(props.config.columnPersistKey, JSON.stringify(visibleCols.value)); } catch { /* ignore */ }
  }
}
function restoreCols() {
  if (!props.config.columnPersistKey) return;
  try {
    const saved = JSON.parse(localStorage.getItem(props.config.columnPersistKey) || 'null');
    if (Array.isArray(saved) && saved.length) visibleCols.value = saved;
  } catch { /* ignore */ }
}

function exportCsv() {
  const cols = shownColumns.value;
  const header = cols.map((c) => c.label).join(',');
  const body = filteredRows.value.map((r) => cols.map((c) => {
    const v = formatCell(r[c.prop], c, r);
    return '"' + String(v).replace(/"/g, '""') + '"';
  }).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + header + '\n' + body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (props.config.exportFilename || 'export') + '.csv'; a.click();
  URL.revokeObjectURL(url);
  ElMessage.success('导出成功');
}

async function load() {
  loading.value = true;
  try {
    const res = await props.config.list();
    rows.value = Array.isArray(res) ? res : (res?.data || []);
  } finally { loading.value = false; }
}
watch(() => props.config, load, { deep: false });
onMounted(() => { restoreCols(); load(); });

defineExpose({ load, rows, getSelection: () => tableRef.value?.getSelectionRows?.() || [] });
</script>

<style scoped>
.ak-at__toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
.ak-at__search { width: 220px; }
.ak-at__cols { width: 180px; }
.ak-at__tools { display: flex; gap: 8px; margin-left: auto; }
.ak-at__pager { margin-top: 14px; justify-content: flex-end; }
</style>
