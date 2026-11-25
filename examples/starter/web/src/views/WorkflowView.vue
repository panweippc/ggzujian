<template>
  <div class="page">
    <el-tabs v-model="tab">
      <!-- 待办 -->
      <el-tab-pane label="我的待办" name="todo">
        <div class="bar">
          <el-button type="primary" size="small" @click="loadTasks">刷新</el-button>
          <el-tag size="small" type="info">共 {{ tasks.length }} 条待办</el-tag>
        </div>
        <el-table :data="tasks" size="small" border v-loading="loading">
          <el-table-column prop="title" label="流程标题" min-width="160" />
          <el-table-column prop="defCode" label="流程" width="110" />
          <el-table-column prop="initiator" label="发起人" width="110" />
          <el-table-column prop="nodeId" label="当前节点" width="110" />
          <el-table-column label="表单数据" min-width="180">
            <template #default="{ row }"><code class="mini">{{ JSON.stringify(row.formData) }}</code></template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button type="success" size="small" link @click="handle(row, 'approve')">通过</el-button>
              <el-button type="danger" size="small" link @click="handle(row, 'reject')">驳回</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-if="!loading && !tasks.length" description="暂无待办" :image-size="70" />
      </el-tab-pane>

      <!-- 发起 -->
      <el-tab-pane label="发起流程" name="start">
        <el-form :model="startForm" label-width="90px" style="max-width:560px">
          <el-form-item label="流程">
            <el-select v-model="startForm.code" placeholder="选择流程" style="width:100%">
              <el-option v-for="w in workflows" :key="w.id" :label="w.name" :value="w.code" />
            </el-select>
          </el-form-item>
          <el-form-item label="标题"><el-input v-model="startForm.title" placeholder="流程标题" /></el-form-item>
          <el-form-item label="表单数据">
            <el-input v-model="startForm.formJson" type="textarea" :rows="4" placeholder='JSON，如 {"days":2,"reason":"事假"}' />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" @click="startFlow">发起</el-button>
          </el-form-item>
        </el-form>
      </el-tab-pane>

      <!-- 我发起的 -->
      <el-tab-pane label="我发起的" name="mine">
        <el-table :data="instances" size="small" border>
          <el-table-column prop="id" label="ID" width="70" />
          <el-table-column prop="title" label="标题" min-width="160" />
          <el-table-column prop="defCode" label="流程" width="110" />
          <el-table-column prop="status" label="状态" width="110">
            <template #default="{ row }"><el-tag size="small" :type="statusType(row.status)">{{ statusLabel(row.status) }}</el-tag></template>
          </el-table-column>
          <el-table-column prop="currentNode" label="当前节点" width="110" />
          <el-table-column prop="startedAt" label="发起时间" width="170" />
        </el-table>
        <el-empty v-if="!instances.length" description="暂无发起记录" :image-size="70" />
      </el-tab-pane>

      <!-- 流程定义 -->
      <el-tab-pane label="流程定义" name="defs">
        <div class="bar"><el-button type="primary" size="small" @click="openDefDialog">新增流程</el-button></div>
        <el-table :data="workflows" size="small" border>
          <el-table-column prop="code" label="编码" width="120" />
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column label="节点" min-width="200">
            <template #default="{ row }"><code class="mini">{{ (row.nodes || []).map((n:any)=>n.name||n.id).join(' → ') }}</code></template>
          </el-table-column>
          <el-table-column prop="version" label="版本" width="80" />
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><el-tag size="small" :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 表单设计 -->
      <el-tab-pane label="表单设计" name="forms">
        <div class="bar"><el-button type="primary" size="small" @click="openFormDialog">新增表单</el-button></div>
        <el-table :data="schemas" size="small" border>
          <el-table-column prop="code" label="编码" width="130" />
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column label="字段" min-width="220">
            <template #default="{ row }"><code class="mini">{{ (row.schemaData || []).map((f:any)=>f.label||f.prop).join('、') }}</code></template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="90">
            <template #default="{ row }"><el-tag size="small" :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 流程定义弹窗 -->
    <el-dialog v-model="defDialog" title="新增流程" width="560px">
      <el-form :model="defForm" label-width="80px">
        <el-form-item label="编码"><el-input v-model="defForm.code" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="defForm.name" /></el-form-item>
        <el-form-item label="节点JSON">
          <el-input v-model="defForm.nodesJson" type="textarea" :rows="5" placeholder='[{"id":"start","type":"start"},{"id":"mgr","name":"经理审批","type":"approve","approvers":["admin"]},{"id":"end","type":"end"}]' />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="defDialog = false">取消</el-button><el-button type="primary" @click="saveDef">保存</el-button></template>
    </el-dialog>

    <!-- 表单设计弹窗 -->
    <el-dialog v-model="formDialog" title="新增表单" width="560px">
      <el-form :model="formForm" label-width="80px">
        <el-form-item label="编码"><el-input v-model="formForm.code" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="formForm.name" /></el-form-item>
        <el-form-item label="字段JSON">
          <el-input v-model="formForm.schemaJson" type="textarea" :rows="5" placeholder='[{"prop":"days","label":"天数","type":"number","required":true}]' />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="formDialog = false">取消</el-button><el-button type="primary" @click="saveForm">保存</el-button></template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { platformApi } from '../services/api';

const tab = ref('todo');
const loading = ref(false);
const tasks = ref<any[]>([]);
const workflows = ref<any[]>([]);
const instances = ref<any[]>([]);
const schemas = ref<any[]>([]);
const startForm = ref({ code: '', title: '', formJson: '{}' });
const defDialog = ref(false);
const formDialog = ref(false);
const defForm = ref({ code: '', name: '', nodesJson: '[]' });
const formForm = ref({ code: '', name: '', schemaJson: '[]' });

const parseJson = (s: string, fallback: any) => { try { return JSON.parse(s || 'null') ?? fallback; } catch { return fallback; } };
const statusLabel = (s: string) => ({ running: '进行中', approved: '已通过', rejected: '已驳回', cancelled: '已取消' } as Record<string,string>)[s] || s;
const statusType = (s: string) => ({ running: 'primary', approved: 'success', rejected: 'danger' } as Record<string,string>)[s] || 'info';

async function loadTasks() { loading.value = true; try { tasks.value = (await platformApi.myTasks()).data || []; } finally { loading.value = false; } }
async function loadAll() {
  try {
    const [w, i, s] = await Promise.all([platformApi.workflows(), platformApi.myInstances(), platformApi.formSchemas()]);
    workflows.value = w.data || []; instances.value = i.data || []; schemas.value = s.data || [];
    if (!startForm.value.code && workflows.value.length) startForm.value.code = workflows.value.find((x) => x.status)?.code || workflows.value[0].code;
  } catch { ElMessage.error('加载失败'); }
}
async function startFlow() {
  try { await platformApi.startWorkflow(startForm.value.code, { title: startForm.value.title, formData: parseJson(startForm.value.formJson, {}) }); ElMessage.success('已发起'); await Promise.all([loadTasks(), loadAll()]); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '发起失败'); }
}
async function handle(row: any, decision: string) {
  let comment = '';
  if (decision === 'reject') { try { comment = (await ElMessageBox.prompt('驳回原因', '驳回', { inputPattern: /\S+/, inputErrorMessage: '请填写原因' })).value; } catch { return; } }
  try { await platformApi.handleTask(row.id, { decision, comment }); ElMessage.success(decision === 'approve' ? '已通过' : '已驳回'); await Promise.all([loadTasks(), loadAll()]); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '处理失败'); }
}
function openDefDialog() { defForm.value = { code: '', name: '', nodesJson: '[]' }; defDialog.value = true; }
async function saveDef() {
  try { await platformApi.createWorkflow({ ...defForm.value, nodes: parseJson(defForm.value.nodesJson, []), edges: [] }); ElMessage.success('已保存'); defDialog.value = false; await loadAll(); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
function openFormDialog() { formForm.value = { code: '', name: '', schemaJson: '[]' }; formDialog.value = true; }
async function saveForm() {
  try { await platformApi.saveFormSchema({ ...formForm.value, schemaData: parseJson(formForm.value.schemaJson, []) }); ElMessage.success('已保存'); formDialog.value = false; await loadAll(); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
onMounted(() => { loadTasks(); loadAll(); });
</script>

<style scoped>
.page { padding: 4px; }
.bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.mini { font-size: 12px; color: var(--el-text-color-regular); }
</style>
