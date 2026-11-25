<template>
  <div class="page">
    <el-alert type="info" :closable="false" show-icon style="margin-bottom:12px" title="低代码页面搭建：左侧配置字段，右侧实时预览；保存后写入 form_schemas，可被工作流复用" />
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card size="small">
          <template #header><div class="card-header"><span>字段配置</span><el-button size="small" type="primary" @click="addField">+ 字段</el-button></div></template>
          <el-form label-width="72px" size="small">
            <div v-for="(f, i) in fields" :key="i" class="field-row">
              <el-form-item label="标题"><el-input v-model="f.label" /></el-form-item>
              <el-form-item label="标识"><el-input v-model="f.prop" /></el-form-item>
              <el-form-item label="类型">
                <el-select v-model="f.type" style="width:100%">
                  <el-option label="文本框" value="text" /><el-option label="数字" value="number" />
                  <el-option label="下拉框" value="select" /><el-option label="开关" value="switch" />
                  <el-option label="多行文本" value="textarea" /><el-option label="日期" value="date" />
                </el-select>
              </el-form-item>
              <el-form-item v-if="f.type === 'select'" label="选项">
                <el-input v-model="f.optionsStr" placeholder="逗号分隔，如 A,B,C" />
              </el-form-item>
              <el-form-item label="必填"><el-switch v-model="f.required" /></el-form-item>
              <el-button size="small" type="danger" link @click="fields.splice(i, 1)">删除</el-button>
              <el-divider />
            </div>
          </el-form>
          <div class="save-row">
            <el-input v-model="schemaCode" placeholder="编码" style="width:140px" />
            <el-input v-model="schemaName" placeholder="名称" style="width:160px" />
            <el-button size="small" type="primary" @click="save">保存到表单库</el-button>
          </div>
        </el-card>
      </el-col>
      <el-col :span="14">
        <el-card size="small">
          <template #header><span>实时预览</span></template>
          <el-form :model="previewModel" label-width="100px" size="small">
            <el-form-item v-for="(f, i) in fields" :key="i" :label="f.label || f.prop" :required="f.required">
              <el-input v-if="f.type === 'text'" v-model="previewModel[f.prop]" :placeholder="f.label" />
              <el-input-number v-else-if="f.type === 'number'" v-model="previewModel[f.prop]" />
              <el-select v-else-if="f.type === 'select'" v-model="previewModel[f.prop]" clearable placeholder="请选择" style="width:100%">
                <el-option v-for="o in (f.optionsStr || '').split(',').filter(Boolean)" :key="o" :label="o" :value="o" />
              </el-select>
              <el-switch v-else-if="f.type === 'switch'" v-model="previewModel[f.prop]" />
              <el-input v-else-if="f.type === 'textarea'" v-model="previewModel[f.prop]" type="textarea" :rows="3" />
              <el-date-picker v-else-if="f.type === 'date'" v-model="previewModel[f.prop]" type="date" style="width:100%" />
            </el-form-item>
            <el-form-item><el-button type="primary" @click="submitPreview">提交（演示）</el-button></el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { platformApi } from '../services/api';

interface Field { label: string; prop: string; type: string; required: boolean; optionsStr: string }
const fields = ref<Field[]>([
  { label: '标题', prop: 'title', type: 'text', required: true, optionsStr: '' },
  { label: '数量', prop: 'count', type: 'number', required: false, optionsStr: '' },
]);
const previewModel = reactive<Record<string, any>>({});
const schemaCode = ref('lowcode_demo');
const schemaName = ref('低代码演示表单');
watch(fields, (list) => {
  for (const f of list) if (f.prop && !(f.prop in previewModel)) previewModel[f.prop] = f.type === 'switch' ? false : undefined;
}, { deep: true, immediate: true });

function addField() { fields.value.push({ label: '', prop: `field${fields.value.length + 1}`, type: 'text', required: false, optionsStr: '' }); }
function toSchema() {
  return fields.value.filter((f) => f.prop).map((f) => {
    const { optionsStr, ...rest } = f;
    return { ...rest, ...(f.type === 'select' ? { options: optionsStr.split(',').filter(Boolean) } : {}) };
  });
}
async function save() {
  if (!schemaCode.value || !schemaName.value) return ElMessage.warning('请填写编码和名称');
  try { await platformApi.saveFormSchema({ code: schemaCode.value, name: schemaName.value, schemaData: toSchema() }); ElMessage.success('已保存到表单库'); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
function submitPreview() { ElMessage.success('演示提交：' + JSON.stringify(previewModel)); }
</script>

<style scoped>
.page { padding: 4px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.field-row { border-bottom: 1px dashed var(--el-border-color-lighter); padding-bottom: 4px; }
.save-row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
</style>
