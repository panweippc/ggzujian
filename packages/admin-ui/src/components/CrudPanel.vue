<template>
  <div class="ak-crud">
    <div class="ak-crud__toolbar">
      <slot name="toolbar" />
      <el-button v-if="config.canCreate !== false" type="primary" size="small" @click="openCreate">新增</el-button>
    </div>

    <el-table :data="rows" v-loading="loading" size="small" border style="width: 100%">
      <el-table-column v-for="col in config.columns" :key="col.prop" :prop="col.prop" :label="col.label"
                       :width="col.width" :min-width="col.minWidth" :align="col.align || 'left'">
        <template #default="scope">
          <slot :name="'cell-' + col.prop" :row="scope.row" :value="scope.row[col.prop]">
            {{ formatCell(scope.row[col.prop], col) }}
          </slot>
        </template>
      </el-table-column>
      <el-table-column v-if="config.actions !== false" label="操作" :width="actionWidth" fixed="right">
        <template #default="scope">
          <slot name="actions" :row="scope.row">
            <el-button v-if="config.canEdit !== false" link type="primary" size="small" @click="openEdit(scope.row)">编辑</el-button>
            <el-button v-if="config.canDelete !== false" link type="danger" size="small" @click="remove(scope.row)">删除</el-button>
          </slot>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination v-if="config.pagination !== false" class="ak-crud__pager" background layout="total,sizes,prev,pager,next"
                   :total="total" v-model:current-page="page" v-model:page-size="pageSize" :page-sizes="[10,20,50,100]" />

    <!-- 编辑弹窗：字段由 config.formFields 描述 -->
    <el-dialog v-model="dialogVisible" :title="editing ? '编辑' : '新增'" width="500px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item v-for="f in config.formFields" :key="f.prop" :label="f.label">
          <el-input v-if="!f.type || f.type === 'text'" v-model="form[f.prop]" :placeholder="f.placeholder" :disabled="f.disabled" />
          <el-input v-else-if="f.type === 'password'" v-model="form[f.prop]" type="password" show-password :placeholder="f.placeholder" />
          <el-select v-else-if="f.type === 'select'" v-model="form[f.prop]" :placeholder="f.placeholder" style="width:100%">
            <el-option v-for="o in f.options" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <slot name="extra-form" :form="form" :editing="editing" />
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogVisible = false">取消</el-button>
        <el-button size="small" type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

export interface CrudColumn { prop: string; label: string; width?: number; minWidth?: number; align?: 'left'|'center'|'right'; formatter?: (v: any, row: any) => string }
export interface CrudField { prop: string; label: string; type?: 'text'|'password'|'select'; placeholder?: string; disabled?: boolean; options?: { label: string; value: any }[] }
export interface CrudConfig {
  columns: CrudColumn[];
  formFields: CrudField[];
  /** 列表：返回 { data: any[], total: number } 或 any[] */
  list: (params: { page: number; pageSize: number }) => Promise<{ data: any[]; total: number } | any[]>;
  create?: (form: any) => Promise<any>;
  update?: (id: any, form: any) => Promise<any>;
  remove?: (id: any, row: any) => Promise<any>;
  idKey?: string;
  canCreate?: boolean; canEdit?: boolean; canDelete?: boolean; actions?: boolean; pagination?: boolean;
  actionWidth?: number;
  emptyText?: string;
}

const props = defineProps<{ config: CrudConfig }>();
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(10);
const loading = ref(false);
const saving = ref(false);
const dialogVisible = ref(false);
const editing = ref(false);
const form = ref<Record<string, any>>({});
const idKey = computed(() => props.config.idKey || 'id');
const actionWidth = computed(() => props.config.actionWidth || 140);

async function load() {
  loading.value = true;
  try {
    const r = await props.config.list({ page: page.value, pageSize: pageSize.value });
    if (Array.isArray(r)) { rows.value = r; total.value = r.length; }
    else { rows.value = r.data || []; total.value = r.total || 0; }
  } catch (e: any) { ElMessage.error(e?.message || '加载失败'); }
  finally { loading.value = false; }
}

function openCreate() {
  editing.value = false;
  form.value = {};
  props.config.formFields.forEach(f => { form.value[f.prop] = f.type === 'select' ? undefined : ''; });
  dialogVisible.value = true;
}
function openEdit(row: any) {
  editing.value = true;
  form.value = { ...row };
  dialogVisible.value = true;
}
async function save() {
  saving.value = true;
  try {
    if (editing.value) {
      if (!props.config.update) throw new Error('未配置 update');
      await props.config.update(form.value[idKey.value], form.value);
    } else {
      if (!props.config.create) throw new Error('未配置 create');
      await props.config.create(form.value);
    }
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    load();
  } catch (e: any) { ElMessage.error(e?.message || '保存失败'); }
  finally { saving.value = false; }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm('确认删除？', '提示', { type: 'warning' });
    if (!props.config.remove) throw new Error('未配置 remove');
    await props.config.remove(row[idKey.value], row);
    ElMessage.success('删除成功');
    load();
  } catch (e: any) { if (e !== 'cancel' && e?.message) ElMessage.error(e.message); }
}
function formatCell(value: any, col: CrudColumn) {
  return col.formatter ? col.formatter(value, value) : (value ?? '—');
}
watch([page, pageSize], load);
onMounted(load);
defineExpose({ load, rows });
</script>

<style scoped>
.ak-crud__toolbar { display: flex; justify-content: flex-end; gap: 8px; margin-bottom: 12px; }
.ak-crud__pager { margin-top: 16px; justify-content: flex-end; }
</style>
