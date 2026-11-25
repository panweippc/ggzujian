<template>
  <div class="cd-view">
    <PageHeaderBar title="组件与接口文档">
      <template #actions><el-button size="small" @click="load">刷新</el-button></template>
    </PageHeaderBar>
    <div class="cd-body">
      <el-tabs v-model="tab">
        <el-tab-pane label="组件库" name="components">
          <div class="cd-card">
            <p class="cd-lead">来自 <code>@panweippc/admin-ui</code> 的可复用组件，开箱即用。</p>
            <el-table :data="components" size="small" style="width:100%">
              <el-table-column prop="name" label="组件" width="180" />
              <el-table-column prop="desc" label="说明" min-width="280" />
              <el-table-column prop="usage" label="导入路径" min-width="260" show-overflow-tooltip />
            </el-table>
          </div>
        </el-tab-pane>
        <el-tab-pane label="接口清单" name="api">
          <div class="cd-card">
            <p class="cd-lead">由后端 <code>/api/api-docs.json</code> 自动扫描生成，共 {{ apiTotal }} 个接口。</p>
            <el-input v-model="apiFilter" placeholder="搜索路径" clearable size="small" style="width:260px;margin-bottom:12px" />
            <el-table :data="filteredApis" size="small" style="width:100%" max-height="520">
              <el-table-column prop="method" label="方法" width="90">
                <template #default="{ row }"><el-tag size="small" :type="methodTag(row.method)">{{ row.method }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="path" label="路径" min-width="360" show-overflow-tooltip />
            </el-table>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import api from '../services/api';

const tab = ref('components');
const components = [
  { name: 'CrudPanel', desc: '配置驱动的增删改查面板', usage: "@panweippc/admin-ui/components" },
  { name: 'AdvancedTable', desc: '高级表格：列显隐/排序/搜索/密度/CSV导出', usage: '@panweippc/admin-ui/components' },
  { name: 'SmartForm', desc: '配置化复杂表单：字典联动/条件显隐/校验', usage: '@panweippc/admin-ui/components' },
  { name: 'RichTextEditor', desc: '富文本编辑器（Quill + DOMPurify 消毒）', usage: '@panweippc/admin-ui/components' },
  { name: 'ImageCropper', desc: '图片裁剪上传', usage: '@panweippc/admin-ui/components' },
  { name: 'DictSelect', desc: '数据字典下拉选择器', usage: '@panweippc/admin-ui/components' },
  { name: 'ExcelImport/Export', desc: 'Excel 导入导出工具', usage: '@panweippc/admin-ui/components' },
  { name: 'OperationLogPanel', desc: '操作日志面板', usage: '@panweippc/admin-ui/components' },
];

const apis = ref<{ method: string; path: string }[]>([]);
const apiFilter = ref('');
const apiTotal = computed(() => apis.value.length);
const filteredApis = computed(() => {
  const kw = apiFilter.value.toLowerCase();
  return kw ? apis.value.filter((a) => a.path.toLowerCase().includes(kw)) : apis.value;
});
const methodTag = (m: string): any => ({ GET: 'success', POST: 'primary', PUT: 'warning', DELETE: 'danger' }[m] || 'info');

async function load() {
  try {
    const r: any = await api.get('/api-docs.json');
    const paths = r.data?.paths || {};
    const list: { method: string; path: string }[] = [];
    for (const [p, methods] of Object.entries(paths)) {
      for (const m of Object.keys(methods as object)) list.push({ method: m.toUpperCase(), path: p });
    }
    apis.value = list;
  } catch { apis.value = []; }
}

onMounted(() => { if (tab.value === 'components') load(); });
</script>

<style scoped>
.cd-view { padding: 20px 22px; }
.cd-body { margin-top: 16px; }
.cd-card { background: #fff; border-radius: 12px; padding: 16px 20px; box-shadow: 0 1px 4px rgba(16,42,82,.07); }
.cd-lead { font-size: 13px; color: #5a6a85; margin: 0 0 14px; }
.cd-card code { background: #eef3ff; color: #667eea; padding: 1px 5px; border-radius: 3px; }
</style>
