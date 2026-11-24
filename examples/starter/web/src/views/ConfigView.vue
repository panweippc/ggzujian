<template>
  <div class="config-view">
    <PageHeaderBar title="配置中心">
      <template #actions>
        <el-button size="small" @click="load">刷新</el-button>
        <el-button type="primary" size="small" @click="openCreate">新增配置</el-button>
      </template>
    </PageHeaderBar>

    <div class="cv-body">
      <div class="tip-bar">配置项随代码与数据库走，新项目拉取后自动带上。修改后立即对后端逻辑生效（如 IP 白名单开关）。</div>
      <el-table :data="configs" v-loading="loading" size="small" border style="width:100%">
        <el-table-column prop="configKey" label="配置键" width="260" />
        <el-table-column prop="configValue" label="配置值" min-width="200" show-overflow-tooltip />
        <el-table-column prop="category" label="分类" width="120">
          <template #default="{ row }"><el-tag size="small" :type="row.category === 'security' ? 'danger' : 'primary'">{{ row.category }}</el-tag></template>
        </el-table-column>
        <el-table-column prop="description" label="说明" min-width="180" show-overflow-tooltip />
        <el-table-column prop="updatedBy" label="修改人" width="110" />
        <el-table-column label="操作" width="140" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="edit(row)">编辑</el-button>
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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import { getConfigs, saveConfig, createConfig, deleteConfig } from '../services/api';

const loading = ref(false);
const configs = ref<any[]>([]);
const dialogVisible = ref(false);
const editing = ref(false);
const form = reactive({ configKey: '', configValue: '', category: 'system', description: '' });

async function load() { loading.value = true; try { configs.value = (await getConfigs()).data || []; } finally { loading.value = false; } }
function openCreate() { editing.value = false; Object.assign(form, { configKey: '', configValue: '', category: 'system', description: '' }); dialogVisible.value = true; }
function edit(row: any) { editing.value = true; Object.assign(form, { configKey: row.configKey, configValue: row.configValue, category: row.category, description: row.description || '' }); dialogVisible.value = true; }
async function save() {
  if (!form.configKey) return ElMessage.error('配置键必填');
  try {
    if (editing.value) await saveConfig(form.configKey, { configValue: form.configValue, description: form.description });
    else await createConfig({ ...form });
    ElMessage.success('保存成功'); dialogVisible.value = false; load();
  } catch (e: any) { ElMessage.error(e?.response?.data?.message || '保存失败'); }
}
async function remove(row: any) {
  try { await ElMessageBox.confirm(`删除配置 ${row.configKey}？`, '提示', { type: 'warning' }); await deleteConfig(row.configKey); ElMessage.success('已删除'); load(); } catch {}
}
onMounted(load);
</script>

<style scoped>
.config-view { min-height: 100%; display: flex; flex-direction: column; }
.cv-body { padding: 20px 24px; flex: 1; }
.tip-bar { background: rgba(102,126,234,.06); border: 1px solid rgba(102,126,234,.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: var(--primary-color); margin-bottom: 16px; }
</style>
