<template>
  <div class="task-view">
    <PageHeaderBar title="定时任务">
      <template #actions>
        <el-button size="small" @click="load">刷新</el-button>
        <el-button type="primary" size="small" @click="openCreate">新增任务</el-button>
      </template>
    </PageHeaderBar>

    <div class="tv-body">
      <div class="tip-bar">任务注册表展示与开关。真实调度由 pm2 cron 兜底；把 taskKey 接到你的调度器即可。cron 表达式：分 时 日 月 周。</div>
      <el-table :data="tasks" v-loading="loading" size="small" border style="width:100%">
        <el-table-column prop="taskName" label="任务名称" width="180" />
        <el-table-column prop="taskKey" label="标识" width="160" />
        <el-table-column prop="cron" label="Cron" width="140">
          <template #default="{ row }"><code>{{ row.cron }}</code></template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="200" show-overflow-tooltip />
        <el-table-column prop="lastRunAt" label="上次执行" width="170">
          <template #default="{ row }">{{ row.lastRunAt ? row.lastRunAt.replace('T', ' ').slice(0, 19) : '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-switch :model-value="!!row.enabled" @change="(v:any)=>toggle(row, v)" style="margin-right:12px;vertical-align:middle" />
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑任务' : '新增任务'" width="520px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="任务名称"><el-input v-model="form.taskName" placeholder="如 每日数据备份" /></el-form-item>
        <el-form-item label="任务标识"><el-input v-model="form.taskKey" :disabled="editing" placeholder="如 daily_backup" /></el-form-item>
        <el-form-item label="Cron">
          <el-input v-model="form.cron" placeholder="0 2 * * *" />
          <div class="cron-tip">分 时 日 月 周。例：<code>0 2 * * *</code> 每天 02:00；<code>0 */6 * * *</code> 每 6 小时</div>
        </el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" type="textarea" :rows="2" placeholder="任务用途说明" /></el-form-item>
        <el-form-item label="启用"><el-switch v-model="form.enabled" /></el-form-item>
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
import { getTasks, toggleTask, createTask, updateTask, deleteTask } from '../services/api';

const loading = ref(false);
const tasks = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref(false);
const editingId = ref<number>(0);
const form = reactive({ taskName: '', taskKey: '', cron: '', description: '', enabled: true });

async function load() { loading.value = true; try { tasks.value = (await getTasks()).data || []; } finally { loading.value = false; } }
async function toggle(row: any, v: boolean) {
  try { await toggleTask(row.id, v); row.enabled = v ? 1 : 0; ElMessage.success(v ? '已启用' : '已停用'); }
  catch { ElMessage.error('操作失败'); }
}
function openCreate() {
  editing.value = false;
  Object.assign(form, { taskName: '', taskKey: '', cron: '', description: '', enabled: true });
  dialogVisible.value = true;
}
function edit(row: any) {
  editing.value = true; editingId.value = row.id;
  Object.assign(form, { taskName: row.taskName, taskKey: row.taskKey, cron: row.cron, description: row.description || '', enabled: !!row.enabled });
  dialogVisible.value = true;
}
async function save() {
  if (!form.taskName || !form.taskKey || !form.cron) return ElMessage.error('任务名称/标识/Cron 必填');
  // 5 段 cron 粗校验
  const parts = form.cron.trim().split(/\s+/);
  if (parts.length !== 5) return ElMessage.error('Cron 必须为 5 段：分 时 日 月 周');
  try {
    const payload = { taskName: form.taskName, taskKey: form.taskKey, cron: form.cron.trim(), description: form.description, enabled: form.enabled };
    if (editing.value) await updateTask(editingId.value, payload);
    else await createTask(payload);
    ElMessage.success('保存成功'); dialogVisible.value = false; load();
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`删除任务「${row.taskName}」？`, '提示', { type: 'warning' });
    await deleteTask(row.id); ElMessage.success('已删除'); load();
  } catch {}
}
onMounted(load);
</script>

<style scoped>
.task-view { min-height: 100%; display: flex; flex-direction: column; }
.tv-body { padding: 20px 24px; flex: 1; }
.tip-bar { background: rgba(102,126,234,.06); border: 1px solid rgba(102,126,234,.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: var(--primary-color); margin-bottom: 16px; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 2px 6px; border-radius: 4px; }
.cron-tip { font-size: 12px; color: #909399; line-height: 1.6; margin-top: 4px; }
</style>
