<template>
  <div class="ak-oplog">
    <div class="ak-oplog__filters">
      <el-select v-if="config.modules" v-model="module" placeholder="模块" clearable size="small" style="width:150px">
        <el-option v-for="m in config.modules" :key="m.value" :label="m.label" :value="m.value" />
      </el-select>
      <el-select v-if="config.actions" v-model="action" placeholder="操作" clearable size="small" style="width:150px">
        <el-option v-for="a in config.actions" :key="a.value" :label="a.label" :value="a.value" />
      </el-select>
      <el-date-picker v-if="config.dateRange !== false" v-model="dateRange" type="daterange" size="small"
                      start-placeholder="开始" end-placeholder="结束" value-format="YYYY-MM-DD" />
      <el-button size="small" type="primary" @click="load">查询</el-button>
      <el-button size="small" @click="reset">重置</el-button>
      <slot name="toolbar" />
    </div>

    <el-table :data="rows" v-loading="loading" size="small" border style="width:100%">
      <el-table-column v-for="col in config.columns" :key="col.prop" :prop="col.prop" :label="col.label"
                       :width="col.width" :min-width="col.minWidth">
        <template #default="scope">
          <slot :name="'cell-' + col.prop" :row="scope.row" :value="scope.row[col.prop]">
            {{ scope.row[col.prop] ?? '—' }}
          </slot>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination class="ak-oplog__pager" background layout="total,prev,pager,next"
                   :total="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[30,50,100]" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { ElMessage } from 'element-plus';

export interface LogColumn { prop: string; label: string; width?: number; minWidth?: number }
export interface LogConfig {
  columns: LogColumn[];
  /** 分页查询：返回 { data: any[], total: number } */
  list: (params: { page: number; pageSize: number; module: string; action: string; dateFrom: string; dateTo: string }) => Promise<{ data: any[]; total: number }>;
  modules?: { label: string; value: string }[];
  actions?: { label: string; value: string }[];
  dateRange?: boolean;
}

const props = defineProps<{ config: LogConfig }>();
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(30);
const module = ref('');
const action = ref('');
const dateRange = ref<[string, string] | null>(null);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const r = await props.config.list({
      page: page.value, pageSize: pageSize.value,
      module: module.value, action: action.value,
      dateFrom: dateRange.value?.[0] || '', dateTo: dateRange.value?.[1] || ''
    });
    rows.value = r.data || [];
    total.value = r.total || 0;
  } catch (e: any) { ElMessage.error(e?.message || '加载日志失败'); }
  finally { loading.value = false; }
}
function reset() { module.value = ''; action.value = ''; dateRange.value = null; page.value = 1; load(); }
watch([page, pageSize], load);
onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.ak-oplog__filters { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 14px; align-items: center; }
.ak-oplog__pager { margin-top: 16px; justify-content: flex-end; }
</style>
