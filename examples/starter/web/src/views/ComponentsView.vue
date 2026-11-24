<template>
  <div class="components-view">
    <PageHeaderBar title="公共组件" />

    <div class="cv-body">
      <el-tabs v-model="activeTab" type="border-card">
        <!-- 1. 通用 CRUD 表格（admin-ui 的 CrudPanel）+ 数据字典 -->
        <el-tab-pane label="数据字典 / CRUD" name="dict">
          <div class="pane-head">
            <div>
              <h3>数据字典（通用 CRUD 表格演示）</h3>
              <p class="sub">由 admin-ui 的 <code>CrudPanel</code> 驱动，配置列 + 表单字段即可生成完整增删改查。</p>
            </div>
            <div class="head-actions">
              <el-button size="small" @click="exportDictExcel">导出 Excel</el-button>
              <el-button size="small" @click="dictPanel?.load()">刷新</el-button>
            </div>
          </div>
          <CrudPanel ref="dictPanel" :config="dictConfig">
            <template #cell-status="{ value }">
              <el-tag :type="value ? 'success' : 'info'" size="small">{{ value ? '启用' : '停用' }}</el-tag>
            </template>
          </CrudPanel>
        </el-tab-pane>

        <!-- 2. 枚举选择器 + 富文本 -->
        <el-tab-pane label="枚举选择 / 富文本" name="form">
          <el-row :gutter="20">
            <el-col :span="10">
              <div class="demo-card">
                <h3>数据字典选择器</h3>
                <p class="sub">传 category 自动加载字典项，支持 v-model。</p>
                <el-form label-width="90px">
                  <el-form-item label="性别"><DictSelect v-model="demo.gender" category="gender" width="220px" /></el-form-item>
                  <el-form-item label="订单状态"><DictSelect v-model="demo.status" category="order_status" width="220px" /></el-form-item>
                </el-form>
                <div class="result">当前值：gender=<b>{{ demo.gender }}</b>，status=<b>{{ demo.status }}</b></div>
              </div>
            </el-col>
            <el-col :span="14">
              <div class="demo-card">
                <h3>富文本编辑器</h3>
                <p class="sub">Quill 编辑器 + DOMPurify 净化，输出安全 HTML。</p>
                <RichTextEditor v-model="demo.richText" min-height="180px" />
                <div class="result">HTML 长度：{{ demo.richText.length }} 字符</div>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>

        <!-- 3. 图片裁剪上传 -->
        <el-tab-pane label="图片裁剪" name="crop">
          <div class="demo-card">
            <h3>图片裁剪上传</h3>
            <p class="sub">原生 canvas 实现居中正方形裁剪，可配尺寸；上传到 <code>/api/user/avatar</code>。</p>
            <div class="crop-demo">
              <ImageCropper :crop-size="256" @uploaded="onAvatarUploaded" />
              <div v-if="avatarUrl" class="avatar-preview">
                <span>上传结果：</span>
                <el-avatar :size="80" :src="avatarUrl" shape="square" />
              </div>
            </div>
          </div>
        </el-tab-pane>

        <!-- 4. Excel 导入导出 -->
        <el-tab-pane label="Excel 导入导出" name="excel">
          <div class="demo-card">
            <h3>Excel 导入导出</h3>
            <p class="sub">基于 xlsx：导出当前字典数据、下载导入模板、上传 Excel 预览。</p>
            <div class="excel-actions">
              <el-button type="primary" size="small" @click="exportDictExcel">导出字典 Excel</el-button>
              <el-button size="small" @click="downloadTemplate">下载导入模板</el-button>
              <el-button size="small" @click="excelInput?.click()">导入 Excel 预览</el-button>
              <input ref="excelInput" type="file" accept=".xlsx,.xls" hidden @change="onExcelFile" />
            </div>
            <el-table v-if="excelRows.length" :data="excelRows.slice(0, 10)" size="small" border style="width:100%;margin-top:16px">
              <el-table-column v-for="col in Object.keys(excelRows[0])" :key="col" :prop="col" :label="col" />
            </el-table>
            <div v-else class="empty-hint">尚未导入数据</div>
          </div>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { CrudPanel } from '@panweippc/admin-ui/components';
import type { CrudConfig } from '@panweippc/admin-ui/components';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import DictSelect from '../components/DictSelect.vue';
import RichTextEditor from '../components/RichTextEditor.vue';
import ImageCropper from '../components/ImageCropper.vue';
import { getDictItems, createDictItem, updateDictItem, deleteDictItem } from '../services/api';
import { exportExcel, importExcel, exportTemplate, type ExcelColumn } from '../utils/excel';

const activeTab = ref('dict');
const dictPanel = ref<any>();
const excelInput = ref<HTMLInputElement>();
const excelRows = ref<Record<string, any>[]>([]);
const avatarUrl = ref('');
const demo = reactive({ gender: '', status: '', richText: '' });

const dictConfig: CrudConfig = {
  columns: [
    { prop: 'id', label: 'ID', width: 70 },
    { prop: 'category', label: '分类', width: 140 },
    { prop: 'label', label: '名称', width: 140 },
    { prop: 'value', label: '值', width: 140 },
    { prop: 'sort', label: '排序', width: 80 },
    { prop: 'status', label: '状态', width: 90 },
    { prop: 'remark', label: '备注' },
  ],
  formFields: [
    { prop: 'category', label: '分类', placeholder: '如 gender' },
    { prop: 'label', label: '名称' },
    { prop: 'value', label: '值' },
    { prop: 'sort', label: '排序' },
    { prop: 'status', label: '状态', type: 'select', options: [{ label: '启用', value: 1 }, { label: '停用', value: 0 }] },
    { prop: 'remark', label: '备注' },
  ],
  list: async () => {
    const r = await getDictItems(undefined, true);
    return { data: r.data || [], total: (r.data || []).length };
  },
  create: async (form) => { await createDictItem(form); },
  update: async (id, form) => { await updateDictItem(id, form); },
  remove: async (id) => { await deleteDictItem(id); },
  actionWidth: 130,
};

const dictColumns: ExcelColumn[] = [
  { key: 'id', label: 'ID', width: 8 }, { key: 'category', label: '分类', width: 16 },
  { key: 'label', label: '名称', width: 16 }, { key: 'value', label: '值', width: 16 },
  { key: 'sort', label: '排序', width: 8 }, { key: 'remark', label: '备注', width: 24 },
];
async function exportDictExcel() {
  try {
    const r = await getDictItems(undefined, true);
    exportExcel(r.data || [], dictColumns, '数据字典', '字典');
    ElMessage.success('导出成功');
  } catch { ElMessage.error('导出失败'); }
}
function downloadTemplate() { exportTemplate(dictColumns.slice(1), '字典导入模板'); }
async function onExcelFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  try { excelRows.value = await importExcel(file); ElMessage.success(`导入 ${excelRows.value.length} 行`); }
  catch { ElMessage.error('导入失败'); }
  if (excelInput.value) excelInput.value.value = '';
}
function onAvatarUploaded(url: string) { avatarUrl.value = url || URL.createObjectURL(new Blob()); }
</script>

<style scoped>
.components-view { min-height: 100%; display: flex; flex-direction: column; }
.cv-body { padding: 20px 24px; flex: 1; }
.pane-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16px; gap: 16px; }
.pane-head h3, .demo-card h3 { margin: 0 0 6px; font-size: 16px; color: #1f2d3d; }
.sub { margin: 0; font-size: 13px; color: #909399; }
.head-actions { display: flex; gap: 8px; align-items: center; }
.demo-card { background: #fff; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
.result { margin-top: 14px; padding: 10px 14px; background: #f5f7fa; border-radius: 6px; font-size: 13px; color: #606266; }
.result b { color: #667eea; }
.crop-demo { display: flex; gap: 30px; align-items: flex-start; margin-top: 16px; }
.avatar-preview { display: flex; flex-direction: column; gap: 10px; align-items: center; color: #606266; font-size: 13px; }
.excel-actions { display: flex; gap: 10px; margin-top: 16px; }
.empty-hint { color: #c0c4cc; text-align: center; padding: 40px; font-size: 14px; }
code { background: #f0f4ff; color: #667eea; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
