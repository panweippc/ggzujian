<template>
  <div class="config-view">
    <PageHeaderBar title="配置中心">
      <template #actions>
        <el-select v-model="env" size="small" style="width:110px" @change="load">
          <el-option label="dev 开发" value="dev" />
          <el-option label="test 测试" value="test" />
          <el-option label="prod 生产" value="prod" />
        </el-select>
        <el-button size="small" @click="load">刷新</el-button>
        <el-button type="primary" size="small" @click="openCreate">新增配置</el-button>
      </template>
    </PageHeaderBar>

    <div class="cv-body">
      <div class="tip-bar">配置随代码与数据库走；修改后立即对后端逻辑生效（如 IP 白名单开关）。每次变更自动存版本快照，可一键回滚。当前环境：<b>{{ env }}</b></div>
      <el-table :data="configs" v-loading="loading" size="small" border style="width:100%">
        <el-table-column prop="configKey" label="配置键" width="230" />
        <el-table-column prop="configValue" label="配置值" min-width="180" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="110">
          <template #default="{ row }"><el-tag size="small" :type="row.category === 'security' ? 'danger' : 'primary'">{{ row.category }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="version" label="版本" width="80">
          <template #default="{ row }"><el-tag size="small" effect="plain">v{{ row.version || 1 }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="160" show-overflow-tooltip />
        <el-table-column prop="updatedBy" label="修改人" width="100" />
        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
            <el-button link type="primary" size="small" @click="showHistory(row)">历史/回滚</el-button>
            <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="dialogVisible" :title="editing ? '编辑配置' : '新增配置'" width="500px" destroy-on-close>
      <el-form label-width="100px">
        <el-form-item label="配置键"><el-input v-model="form.configKey" :disabled="editing" placeholder="如 site.name" /></el-form-item>
        <el-form-item label="配置值"><el-input v-model="form.configValue" placeholder="字符串或 JSON" /></el-form-item>
        <el-form-item label="分类"><el-input v-model="form.category" placeholder="system / security ..." /></el-form-item>
        <el-form-item label="说明"><el-input v-model="form.description" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button size="small" @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" size="small" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 版本历史 / 回滚 -->
    <el-dialog v-model="historyVisible" :title="`配置变更历史 — ${historyKey}`" width="680px" destroy-on-close>
      <el-table :data="history" v-loading="historyLoading" size="small" border max-height="400">
        <el-table-column prop="version" label="版本" width="80">
          <template #default="{ row }">v{{ row.version }}</template>
        </el-table-column>
        <el-table-column prop="operation" label="操作" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="String(row.operation).startsWith('rollback') ? 'warning' : row.operation === 'delete' ? 'danger' : 'success'">{{ row.operation }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="configValue" label="配置值" min-width="200" show-overflow-tooltip />
        <el-table-column prop="operator" label="操作人" width="100" />
        <el-table-column prop="createdAt" label="时间" width="160">
          <template #default="{ row }">{{ row.createdAt?.replace('T', ' ').slice(0, 19) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" :disabled="row.version === currentVersion" @click="doRollback(row)">回滚</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import { getConfigs, saveConfig, createConfig, deleteConfig, getConfigHistory, rollbackConfig } from '../services/api';

const loading = ref(false);
const configs = ref<any[]>([]);
const env = ref(localStorage.getItem('configEnv') || 'dev');
const dialogVisible = ref(false);
const editing = ref(false);
const form = reactive({ configKey: '', configValue: '', category: 'system', description: '' });

const historyVisible = ref(false);
const historyLoading = ref(false);
const history = ref<any[]>([]);
const historyKey = ref('');
const currentVersion = ref(0);

async function load() {
  localStorage.setItem('configEnv', env.value);
  loading.value = true;
  try { configs.value = (await getConfigs(undefined, env.value)).data || []; }
  finally { loading.value = false; }
}
function openCreate() { editing.value = false; Object.assign(form, { configKey: '', configValue: '', category: 'system', description: '' }); dialogVisible.value = true; }
function edit(row: any) { editing.value = true; Object.assign(form, { configKey: row.configKey, configValue: row.configValue, category: row.category, description: row.description || '' }); dialogVisible.value = true; }
async function save() {
  if (!form.configKey) return ElMessage.error('配置键必填');
  try {
    if (editing.value) await saveConfig(form.configKey, { configValue: form.configValue, description: form.description }, env.value);
    else await createConfig({ configKey: form.configKey, configValue: form.configValue, category: form.category, description: form.description, env: env.value });
    ElMessage.success('保存成功'); dialogVisible.value = false; load();
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
async function remove(row: any) {
  try { await ElMessageBox.confirm(`删除配置 ${row.configKey}（${env.value}）？`, '提示', { type: 'warning' }); await deleteConfig(row.configKey, env.value); ElMessage.success('已删除'); load(); } catch {}
}
async function showHistory(row: any) {
  historyKey.value = row.configKey;
  currentVersion.value = row.version || 1;
  historyVisible.value = true;
  historyLoading.value = true;
  try { history.value = (await getConfigHistory(row.configKey, env.value)).data || []; }
  catch { history.value = []; }
  finally { historyLoading.value = false; }
}
async function doRollback(row: any) {
  try {
    await ElMessageBox.confirm(`回滚配置「${historyKey.value}」到 v${row.version}？当前值将被覆盖，并生成一个新版本。`, '回滚确认', { type: 'warning' });
    const r = await rollbackConfig(historyKey.value, row.version, env.value);
    ElMessage.success(`已回滚到 v${row.version}，当前版本 v${r.data?.version}`);
    historyVisible.value = false;
    load();
  } catch (e: any) { if (e !== 'cancel' && e?.message !== 'cancel') ElMessage.error(e?.response?.data?.message || '回滚失败'); }
}
onMounted(load);
</script>

<style scoped>
.config-view { min-height: 100%; display: flex; flex-direction: column; }
.cv-body { padding: 20px 24px; flex: 1; }
.tip-bar { background: rgba(102,126,234,.06); border: 1px solid rgba(102,126,234,.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: var(--primary-color); margin-bottom: 16px; }
</style>
