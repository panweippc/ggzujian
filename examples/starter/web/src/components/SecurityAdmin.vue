<template>
  <div class="security-admin">
    <el-tabs v-model="tab">
      <el-tab-pane label="在线会话" name="sessions">
        <div class="pane-toolbar"><span class="tip">强制下线会提升令牌版本，使该用户所有旧会话立即失效。</span><el-button size="small" @click="loadSessions">刷新</el-button></div>
        <el-table :data="sessions" size="small" border v-loading="loading">
          <el-table-column prop="username" label="用户" width="120" />
          <el-table-column prop="ipAddress" label="IP" width="130" />
          <el-table-column prop="userAgent" label="设备" min-width="180" show-overflow-tooltip />
          <el-table-column prop="loginAt" label="登录时间" width="170" />
          <el-table-column prop="lastActiveAt" label="最后活跃" width="170" />
          <el-table-column label="操作" width="100" fixed="right">
            <template #default="{ row }">
              <el-button link type="danger" size="small" @click="kick(row)">踢下线</el-button>
            </template>
          </el-table-column>
        </el-table>
        <div v-if="!sessions.length && !loading" class="empty">暂无在线会话记录（登录时自动写入）</div>
      </el-tab-pane>

      <el-tab-pane label="IP 白名单" name="ip">
        <div class="pane-toolbar">
          <span class="tip">白名单需在配置中心开启 <code>security.ipWhitelistEnabled</code> 后生效；支持 IP 与 CIDR。</span>
          <el-button size="small" @click="loadIps">刷新</el-button>
        </div>
        <div class="ip-add">
          <el-input v-model="newIp" placeholder="如 192.168.1.100 或 192.168.1.0/24" style="width:280px" />
          <el-input v-model="newRemark" placeholder="备注" style="width:160px" />
          <el-button type="primary" size="small" @click="addIp">添加</el-button>
        </div>
        <el-table :data="ips" size="small" border style="margin-top:12px" v-loading="loading">
          <el-table-column prop="ip" label="IP / CIDR" width="180" />
          <el-table-column prop="remark" label="备注" min-width="160" />
          <el-table-column prop="createdAt" label="添加时间" width="170" />
          <el-table-column label="操作" width="80" fixed="right">
            <template #default="{ row }"><el-button link type="danger" size="small" @click="removeIp(row)">删除</el-button></template>
          </el-table-column>
        </el-table>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { getSessions, kickSession, getIpWhitelist, addIpWhitelist, deleteIpWhitelist } from '../services/api';

const tab = ref('sessions');
const loading = ref(false);
const sessions = ref<any[]>([]);
const ips = ref<any[]>([]);
const newIp = ref('');
const newRemark = ref('');

async function loadSessions() { loading.value = true; try { sessions.value = (await getSessions()).data || []; } catch {} finally { loading.value = false; } }
async function loadIps() { loading.value = true; try { ips.value = (await getIpWhitelist()).data || []; } catch {} finally { loading.value = false; } }
async function kick(row: any) {
  try { await ElMessageBox.confirm(`确定强制下线 ${row.username}？其所有会话将失效。`, '提示', { type: 'warning' }); await kickSession(row.id); ElMessage.success('已强制下线'); loadSessions(); } catch {}
}
async function addIp() {
  if (!newIp.value.trim()) return ElMessage.error('请输入 IP');
  try { await addIpWhitelist({ ip: newIp.value.trim(), remark: newRemark.value }); ElMessage.success('已添加'); newIp.value = ''; newRemark.value = ''; loadIps(); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '添加失败'); }
}
async function removeIp(row: any) {
  try { await ElMessageBox.confirm(`删除白名单 ${row.ip}？`, '提示', { type: 'warning' }); await deleteIpWhitelist(row.id); ElMessage.success('已删除'); loadIps(); } catch {}
}
onMounted(() => { loadSessions(); loadIps(); });
</script>

<style scoped>
.pane-toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; gap: 12px; }
.tip { font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 1px 4px; border-radius: 3px; }
.ip-add { display: flex; gap: 8px; }
.empty { text-align: center; padding: 30px; color: var(--text-secondary); font-size: 13px; }
</style>
