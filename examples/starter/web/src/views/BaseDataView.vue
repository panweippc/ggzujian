<template>
  <div class="base-data-view">
    <PageHeaderBar title="基础数据">
      <template #actions>
        <el-button size="small" @click="load">刷新</el-button>
        <el-button type="primary" size="small" @click="openCreate">新增数据</el-button>
      </template>
    </PageHeaderBar>

    <div class="bd-body">
      <el-radio-group v-model="activeType" @change="load" class="type-switch">
        <el-radio-button value="organization">组织机构</el-radio-button>
        <el-radio-button value="region">行政区划</el-radio-button>
        <el-radio-button value="industry">行业分类</el-radio-button>
      </el-radio-group>

      <div class="tip-bar">全局共享的基础数据，支持树形层级（parentCode）。不同业务系统统一从这里取，避免各自维护。</div>

      <el-table
        :data="tree" v-loading="loading" size="small" border row-key="code"
        :tree-props="{ children: 'children' }" default-expand-all style="width:100%"
      >
        <el-table-column prop="name" label="名称" min-width="220" />
        <el-table-column prop="code" label="编码" width="140" />
        <el-table-column prop="parentCode" label="上级编码" width="140">
          <template #default="{ row }">{{ row.parentCode || '—' }}</template>
        </el-table-column>
        <el-table-column prop="sort" label="排序" width="80" />
        <el-table-column label="状态" width="90">
          <template #default="{ row }"><el-tag size="small" :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openCreate(row)">新增下级</el-button>
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑基础数据' : '新增基础数据'" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="类型">
          <el-select v-model="form.type" :disabled="editing" style="width:100%">
            <el-option label="组织机构" value="organization" />
            <el-option label="行政区划" value="region" />
            <el-option label="行业分类" value="industry" />
          </el-select>
        </el-form-item>
        <el-form-item label="编码"><el-input v-model="form.code" :disabled="editing" placeholder="如 HQ-HR / 110101 / I65" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="form.name" placeholder="显示名称" /></el-form-item>
        <el-form-item label="上级编码"><el-input v-model="form.parentCode" placeholder="留空表示根节点" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="状态"><el-switch v-model="formStatus" /></el-form-item>
        <el-form-item label="备注"><el-input v-model="form.remark" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import {
  getBaseDataTree, createBaseData, updateBaseData, deleteBaseData, type BaseDataItem
} from '../services/api';

const loading = ref(false);
const tree = ref<BaseDataItem[]>([]);
const activeType = ref('organization');
const dialogVisible = ref(false);
const editing = ref(false);
const editId = ref<number | null>(null);
const formStatus = ref(true);
const form = reactive({ type: 'organization', code: '', name: '', parentCode: '', sort: 0, remark: '' });

async function load() {
  loading.value = true;
  try { tree.value = (await getBaseDataTree(activeType.value)).data || []; }
  catch { ElMessage.error('加载基础数据失败'); }
  finally { loading.value = false; }
}

function openCreate(parent?: BaseDataItem) {
  editing.value = false; editId.value = null;
  form.type = activeType.value; form.code = ''; form.name = '';
  form.parentCode = parent?.code || ''; form.sort = 0; form.remark = ''; formStatus.value = true;
  dialogVisible.value = true;
}
function edit(row: BaseDataItem) {
  editing.value = true; editId.value = row.id;
  form.type = row.type; form.code = row.code; form.name = row.name;
  form.parentCode = row.parentCode || ''; form.sort = row.sort; form.remark = row.remark || '';
  formStatus.value = !!row.status;
  dialogVisible.value = true;
}
async function save() {
  if (!form.code || !form.name) return ElMessage.warning('编码/名称必填');
  try {
    const payload = { ...form, parentCode: form.parentCode || null, status: formStatus.value ? 1 : 0 };
    if (editing.value && editId.value) await updateBaseData(editId.value, payload);
    else await createBaseData(payload);
    ElMessage.success('保存成功');
    dialogVisible.value = false;
    await load();
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
async function remove(row: BaseDataItem) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.name}」？`, '提示', { type: 'warning' });
    await deleteBaseData(row.id);
    ElMessage.success('删除成功');
    await load();
  } catch (e: any) {
    if (e !== 'cancel' && e?.response) ElMessage.error(e?.response?.data?.message || '删除失败');
  }
}
onMounted(load);
</script>

<style scoped>
.base-data-view { min-height: 100%; display: flex; flex-direction: column; }
.bd-body { padding: 20px 24px; flex: 1; }
.type-switch { margin-bottom: 16px; }
.tip-bar {
  padding: 10px 14px; margin-bottom: 14px; font-size: 13px; color: #606266;
  background: #f5f7fa; border-left: 3px solid #667eea; border-radius: 4px;
}
code { background: #f0f4ff; color: #667eea; padding: 1px 5px; border-radius: 4px; font-size: 12px; }
</style>
