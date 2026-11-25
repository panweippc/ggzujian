<template>
  <div class="mgmt-section">
    <div class="sec-head">
      <h3>菜单管理</h3>
      <el-button type="primary" size="small" v-perm="'system:menu:create'" @click="openCreate">新增菜单</el-button>
    </div>
    <div class="tip">菜单的 id 与前端 <code>config.ts</code> 的 SIDE_MENUS 对应；角色分配菜单后，用户登录只看到有权限的菜单。</div>
    <el-table :data="menus" v-loading="loading" size="small" border row-key="id" style="width:100%">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="name" label="菜单名称" width="160" />
      <el-table-column prop="path" label="路由路径" width="160">
        <template #default="{ row }"><code>{{ row.path }}</code></template>
      </el-table-column>
      <el-table-column prop="component" label="组件" width="180" show-overflow-tooltip />
      <el-table-column prop="icon" label="图标" width="100" />
      <el-table-column prop="sort" label="排序" width="80" />
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><el-tag size="small" :type="row.status === '启用' ? 'success' : 'info'">{{ row.status }}</el-tag></template>
      </el-table-column>
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" v-perm="'system:menu:update'" @click="edit(row)">编辑</el-button>
          <el-button link type="danger" size="small" v-perm="'system:menu:delete'" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑菜单' : '新增菜单'" width="520px" destroy-on-close>
      <el-form label-width="90px">
        <el-form-item label="菜单名称"><el-input v-model="form.name" placeholder="如 工作台" /></el-form-item>
        <el-form-item label="路由路径"><el-input v-model="form.path" placeholder="如 /system" /></el-form-item>
        <el-form-item label="组件"><el-input v-model="form.component" placeholder="如 HomeView" /></el-form-item>
        <el-form-item label="图标"><el-input v-model="form.icon" placeholder="如 setting" /></el-form-item>
        <el-form-item label="父级ID"><el-input-number v-model="form.parentId" :min="0" /></el-form-item>
        <el-form-item label="排序"><el-input-number v-model="form.sort" :min="0" /></el-form-item>
        <el-form-item label="状态">
          <el-radio-group v-model="form.status"><el-radio label="启用">启用</el-radio><el-radio label="禁用">禁用</el-radio></el-radio-group>
        </el-form-item>
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

const API = '/api';
const loading = ref(false);
const menus = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref(false);
const editId = ref(0);
const form = reactive({ name: '', path: '', component: '', icon: '', parentId: 0, sort: 0, status: '启用' });

const fetchApi = async (url: string, options?: RequestInit) => {
  const res = await fetch(API + url, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    ...options
  });
  return res.json();
};
async function load() {
  loading.value = true;
  try { const r = await fetchApi('/menus'); if (r.success) menus.value = r.data; }
  finally { loading.value = false; }
}
function openCreate() {
  editing.value = false;
  Object.assign(form, { name: '', path: '', component: '', icon: '', parentId: 0, sort: 0, status: '启用' });
  dialogVisible.value = true;
}
function edit(row: any) {
  editing.value = true; editId.value = row.id;
  Object.assign(form, {
    name: row.name, path: row.path, component: row.component || '', icon: row.icon || '',
    parentId: row.parentId || 0, sort: row.sort || 0, status: row.status || '启用'
  });
  dialogVisible.value = true;
}
async function save() {
  if (!form.name || !form.path) return ElMessage.error('菜单名称和路径必填');
  const method = editing.value ? 'PUT' : 'POST';
  const url = editing.value ? `/menus/${editId.value}` : '/menus';
  const r = await fetchApi(url, { method, body: JSON.stringify({ ...form }) });
  if (r.success) { ElMessage.success('保存成功'); dialogVisible.value = false; load(); }
  else ElMessage.error(r.message || '保存失败');
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`删除菜单「${row.name}」？`, '提示', { type: 'warning' });
    const r = await fetchApi(`/menus/${row.id}`, { method: 'DELETE', body: JSON.stringify({ adminPassword: await askPwd() }) });
    if (r.success) { ElMessage.success('已删除'); load(); } else ElMessage.error(r.message || '删除失败');
  } catch {}
}
// 高危操作二次密码验证
function askPwd(): Promise<string> {
  return new Promise((resolve) => {
    ElMessageBox.prompt('请输入当前登录密码以确认删除', '二次验证', {
      inputType: 'password', inputPattern: /\S+/, inputErrorMessage: '密码不能为空'
    }).then(({ value }) => resolve(value)).catch(() => resolve(''));
  });
}
onMounted(load);
defineExpose({ load });
</script>

<style scoped>
.mgmt-section { background: #fff; border: 1px solid #e8ecf4; border-radius: 10px; padding: 16px; }
.sec-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
.sec-head h3 { margin: 0; font-size: 16px; }
.tip { font-size: 12px; color: #909399; margin-bottom: 12px; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 2px 5px; border-radius: 4px; }
</style>
