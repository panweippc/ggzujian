<template>
  <div class="fs-view">
    <PageHeaderBar title="文件服务">
      <template #actions>
        <el-button size="small" @click="load">刷新</el-button>
      </template>
    </PageHeaderBar>

    <div class="fs-body">
      <div class="fs-tip">
        统一文件服务：业务只调 <code>/api/files/*</code>，底层存储可热切换（配置入库，立即生效，无需重启）。
        <div class="driver-switch" style="margin-top:10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>当前驱动：</span>
          <el-select v-model="driver" size="small" style="width:220px" @change="onDriverChange">
            <el-option v-for="d in driverOptions" :key="d.key" :label="d.label" :value="d.key" :disabled="!d.ready" />
          </el-select>
          <el-tag v-if="driverReady" size="small" type="success" effect="plain">可用</el-tag>
          <el-tag v-else size="small" type="warning" effect="plain">预留适配位，需接 SDK</el-tag>
        </div>
      </div>

      <!-- 上传区 -->
      <div class="upload-card">
        <el-upload
          class="fs-uploader"
          :action="uploadUrl"
          :headers="uploadHeaders"
          :show-file-list="false"
          :before-upload="beforeUpload"
          :on-success="onUploaded"
          :on-error="onUploadError"
        >
          <el-button type="primary" size="small">📤 上传文件</el-button>
        </el-upload>
        <span class="upload-hint">支持图片 / PDF / Office / 压缩包，单文件最大 {{ maxSizeText }}</span>
      </div>

      <!-- 文件列表 -->
      <div class="file-card">
        <el-table :data="rows" v-loading="loading" size="small" style="width:100%" empty-text="暂无文件，先上传一个试试">
          <el-table-column label="原文件名" prop="originalName" min-width="200" show-overflow-tooltip />
          <el-table-column label="大小" width="110">
            <template #default="{ row }">{{ formatSize(row.size) }}</template>
          </el-table-column>
          <el-table-column label="类型" prop="mimeType" min-width="140" show-overflow-tooltip />
          <el-table-column label="存储驱动" prop="driver" width="100">
            <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.driver }}</el-tag></template>
          </el-table-column>
          <el-table-column label="上传人" prop="uploadedBy" width="120" show-overflow-tooltip />
          <el-table-column label="上传时间" width="170">
            <template #default="{ row }">{{ fmt(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <el-button link type="primary" size="small" @click="preview(row)">预览</el-button>
              <el-button link type="primary" size="small" @click="download(row)">下载</el-button>
              <el-button link type="danger" size="small" @click="remove(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div class="pagination-bar" v-if="total > 0">
          <el-pagination layout="total, prev, pager, next" :total="total" :page-size="pageSize"
            v-model:current-page="page" background small @current-change="load" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import {
  getFiles, deleteFile, previewFile, downloadFile, getFileDriver, switchFileDriver,
} from '../services/api';

const loading = ref(false);
const rows = ref<any[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 30;
const driver = ref('local');
const driverOptions = ref<{ key: string; label: string; ready: boolean }[]>([]);
const driverReady = computed(() => driverOptions.value.find((d) => d.key === driver.value)?.ready ?? true);

const uploadUrl = '/api/files/upload';
const uploadHeaders = computed(() => ({ Authorization: `Bearer ${localStorage.getItem('token') || ''}` }));
const maxSizeText = '20 MB';

const fmt = (v: any) => (v ? String(v).replace('T', ' ').slice(0, 19) : '—');
const formatSize = (b: number) => {
  if (!b) return '—';
  return b >= 1024 * 1024 ? (b / 1024 / 1024).toFixed(2) + ' MB' : (b / 1024).toFixed(1) + ' KB';
};

async function loadDriver() {
  try {
    const r: any = await getFileDriver();
    driver.value = r.data?.current || 'local';
    driverOptions.value = r.data?.available || [];
  } catch { /* 忽略，保持默认 local */ }
}

async function onDriverChange(val: string) {
  try {
    const r: any = await switchFileDriver(val);
    if (r.success) ElMessage.success(`已切换到 ${val}，立即生效`);
    else ElMessage.error(r.message || '切换失败');
  } catch { ElMessage.error('切换失败'); }
  await loadDriver();
}

async function load() {
  loading.value = true;
  try {
    const r = await getFiles({ page: page.value, pageSize });
    if (r.success) { rows.value = r.data; total.value = r.total; }
  } catch { ElMessage.error('文件列表加载失败'); }
  finally { loading.value = false; }
}

function beforeUpload(file: File) {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const ok = ['png','jpg','jpeg','gif','webp','bmp','svg','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv','md','json','zip','rar','7z'].includes(ext);
  if (!ok) { ElMessage.error('不支持的文件类型'); return false; }
  if (file.size > 20 * 1024 * 1024) { ElMessage.error('文件不能超过 20MB'); return false; }
  return true;
}
function onUploaded(r: any) {
  if (r.success) { ElMessage.success('上传成功'); load(); }
  else ElMessage.error(r.message || '上传失败');
}
function onUploadError() { ElMessage.error('上传失败'); }
async function preview(row: any) {
  try { window.open(await previewFile(row.objectKey), '_blank'); }
  catch { ElMessage.error('预览失败'); }
}
async function download(row: any) {
  try { await downloadFile(row.objectKey, row.originalName); }
  catch { ElMessage.error('下载失败'); }
}
async function remove(row: any) {
  try {
    await ElMessageBox.confirm(`确认删除「${row.originalName}」？`, '提示', { type: 'warning' });
    const r = await deleteFile(row.objectKey);
    if (r.success) { ElMessage.success('已删除'); load(); }
    else ElMessage.error(r.message || '删除失败');
  } catch { /* 取消 */ }
}

onMounted(() => { load(); loadDriver(); });
</script>

<style scoped>
.fs-view { padding: 20px 22px; }
.fs-body { margin-top: 16px; }
.fs-tip { background: #eef3ff; border: 1px solid #dbe6ff; color: #4a5a78; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin-bottom: 16px; }
.fs-tip code { background: #fff; color: #667eea; padding: 1px 5px; border-radius: 3px; }
.upload-card { display: flex; align-items: center; gap: 14px; background: #fff; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; box-shadow: 0 1px 4px rgba(16,42,82,.07); }
.upload-hint { font-size: 12px; color: #909399; }
.file-card { background: #fff; border-radius: 12px; padding: 8px; box-shadow: 0 1px 4px rgba(16,42,82,.07); }
.pagination-bar { display: flex; justify-content: center; padding: 16px; }
</style>
