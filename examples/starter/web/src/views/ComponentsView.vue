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

        <!-- 1b. 字典分类管理 -->
        <el-tab-pane label="字典分类" name="dictCategory">
          <div class="pane-head">
            <div>
              <h3>字典分类</h3>
              <p class="sub">统一管理 category 编码与名称；删除前需清空该分类下的字典项。</p>
            </div>
            <div class="head-actions">
              <el-button size="small" @click="dictCategoryPanel?.load()">刷新</el-button>
            </div>
          </div>
          <CrudPanel ref="dictCategoryPanel" :config="dictCategoryConfig" />
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

        <!-- 5. 高级表格 + 复杂表单 -->
        <el-tab-pane label="高级表格 / 表单" name="advanced">
          <el-row :gutter="20">
            <el-col :xs="24" :md="14">
              <div class="demo-card">
                <h3>高级表格 AdvancedTable</h3>
                <p class="sub">可配置列显隐（本地持久化）、列排序、关键字搜索、密度切换、CSV 导出。</p>
                <AdvancedTable :config="advancedTableConfig">
                  <template #cell-status="{ value }">
                    <el-tag size="small" :type="value === '已完成' ? 'success' : 'warning'">{{ value }}</el-tag>
                  </template>
                  <template #actions="{ row }">
                    <el-button link type="primary" size="small" @click="ElMessage.info(`查看 ${row.name}`)">查看</el-button>
                  </template>
                </AdvancedTable>
              </div>
            </el-col>
            <el-col :xs="24" :md="10">
              <div class="demo-card">
                <h3>复杂表单 SmartForm</h3>
                <p class="sub">配置驱动字段（含字典联动、条件显隐/禁用），内置校验。</p>
                <SmartForm ref="smartFormRef" :config="smartFormConfig" v-model="smartFormModel" />
                <div class="head-actions" style="margin-top:14px;justify-content:flex-end">
                  <el-button size="small" @click="smartFormRef?.reset()">重置</el-button>
                  <el-button type="primary" size="small" @click="submitSmartForm">校验并提交</el-button>
                </div>
                <div v-if="smartFormResult" class="result">提交值：<b>{{ smartFormResult }}</b></div>
              </div>
            </el-col>
          </el-row>
        </el-tab-pane>
      </el-tabs>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import { ElMessage } from 'element-plus';
import { CrudPanel, AdvancedTable, SmartForm } from '@panweippc/admin-ui/components';
import type { CrudConfig, AdvancedTableConfig, SmartFormConfig } from '@panweippc/admin-ui/components';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import DictSelect from '../components/DictSelect.vue';
import RichTextEditor from '../components/RichTextEditor.vue';
import ImageCropper from '../components/ImageCropper.vue';
import {
  getDictItems, batchGetDictItems, createDictItem, updateDictItem, deleteDictItem,
  getDictCategories, createDictCategory, updateDictCategory, deleteDictCategory
} from '../services/api';
import { exportExcel, importExcel, exportTemplate, type ExcelColumn } from '../utils/excel';

const activeTab = ref('dict');
const dictPanel = ref<any>();
const dictCategoryPanel = ref<any>();
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

const dictCategoryConfig: CrudConfig = {
  columns: [
    { prop: 'id', label: 'ID', width: 70 },
    { prop: 'code', label: '编码', width: 160 },
    { prop: 'name', label: '名称', width: 160 },
    { prop: 'description', label: '说明' },
    { prop: 'sort', label: '排序', width: 80 },
    { prop: 'status', label: '状态', width: 90 },
  ],
  formFields: [
    { prop: 'code', label: '编码', placeholder: '如 gender' },
    { prop: 'name', label: '名称' },
    { prop: 'description', label: '说明' },
    { prop: 'sort', label: '排序' },
    { prop: 'status', label: '状态', type: 'select', options: [{ label: '启用', value: 1 }, { label: '停用', value: 0 }] },
  ],
  list: async () => {
    const r = await getDictCategories();
    return { data: r.data || [], total: (r.data || []).length };
  },
  create: async (form) => { await createDictCategory(form); },
  update: async (id, form) => { await updateDictCategory(id, form); },
  remove: async (id) => { await deleteDictCategory(id); },
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

// ===== 高级表格 / 复杂表单演示配置 =====
const advancedTableConfig: AdvancedTableConfig = {
  columns: [
    { prop: 'id', label: 'ID', width: 70, sortable: true },
    { prop: 'name', label: '名称', minWidth: 140, sortable: true },
    { prop: 'dept', label: '部门', width: 130 },
    { prop: 'amount', label: '金额', width: 110, sortable: true, formatter: (v) => `¥${Number(v || 0).toFixed(2)}` },
    { prop: 'status', label: '状态', width: 110 },
  ],
  list: async () => [
    { id: 1, name: '采购申请A', dept: '信息技术部', amount: 12800, status: '已完成' },
    { id: 2, name: '差旅报销B', dept: '人力资源部', amount: 3200, status: '处理中' },
    { id: 3, name: '设备采购C', dept: '信息技术部', amount: 56000, status: '待处理' },
    { id: 4, name: '办公用品D', dept: '财务部', amount: 860, status: '已完成' },
    { id: 5, name: '培训费用E', dept: '人力资源部', amount: 4500, status: '处理中' },
  ],
  selectable: true,
  exportFilename: '高级表格示例',
  columnPersistKey: 'components.advancedTable.cols',
};

const smartFormRef = ref<any>();
const smartFormModel = ref<Record<string, any>>({});
const smartFormResult = ref('');
const smartFormConfig: SmartFormConfig = {
  labelWidth: '100px',
  dictLoader: async (cats) => (await batchGetDictItems(cats)).data || {},
  groups: [
    { title: '基本信息', fields: [
      { prop: 'name', label: '姓名', required: true, placeholder: '请输入姓名' },
      { prop: 'gender', label: '性别', type: 'dict', category: 'gender', span: 12 },
      { prop: 'age', label: '年龄', type: 'number', min: 0, max: 120, span: 12 },
      { prop: 'dept', label: '部门', type: 'select', options: [
        { label: '信息技术部', value: 'it' }, { label: '人力资源部', value: 'hr' }, { label: '财务部', value: 'fin' }
      ] },
    ]},
    { title: '联系与偏好', fields: [
      { prop: 'email', label: '邮箱', required: true, rules: [
        { required: true, message: '请填写邮箱', trigger: 'blur' },
        { type: 'email', message: '邮箱格式不正确', trigger: 'blur' }
      ] },
      { prop: 'notify', label: '接收通知', type: 'switch' },
      { prop: 'notifyChannel', label: '通知渠道', type: 'checkbox', span: 24,
        options: [{ label: '站内信', value: 'inbox' }, { label: '邮件', value: 'email' }],
        visibleWhen: (m) => !!m.notify },
      { prop: 'remark', label: '备注', type: 'textarea', disabledWhen: (m) => !m.notify, help: '关闭通知后备注不可编辑' },
    ]},
  ],
};
async function submitSmartForm() {
  const ok = await smartFormRef.value?.validate();
  if (!ok) return ElMessage.warning('请先修正表单错误');
  smartFormResult.value = JSON.stringify(smartFormRef.value.values());
  ElMessage.success('校验通过');
}
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
