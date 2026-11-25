<template>
  <div class="mc-view">
    <PageHeaderBar title="消息通道">
      <template #actions><el-button size="small" @click="load">刷新</el-button></template>
    </PageHeaderBar>

    <div class="mc-body">
      <div class="mc-tip">
        统一消息中心：业务只需调一个接口即可多渠道触达。已配置的通道走真实服务，未配置的走<strong>控制台适配器</strong>（消息写入日志，填好 .env 即可无缝切换真实通道）。
      </div>

      <!-- 通道状态卡片 -->
      <div class="channel-cards">
        <div v-for="c in channels" :key="c.key" class="channel-card" :class="{ ready: c.ready }">
          <div class="cc-icon">{{ ICONS[c.key] }}</div>
          <div class="cc-info">
            <div class="cc-name">{{ c.label }} <el-tag size="small" :type="c.ready ? 'success' : 'info'" effect="plain">{{ c.ready ? '已就绪' : '控制台适配器' }}</el-tag></div>
            <div class="cc-note">{{ c.note }}</div>
          </div>
        </div>
      </div>

      <el-row :gutter="16">
        <!-- 发送测试 -->
        <el-col :span="12">
          <div class="mc-card">
            <h3>发送测试消息</h3>
            <el-form label-width="90px" size="small">
              <el-form-item label="通道">
                <el-select v-model="form.channel" style="width:100%">
                  <el-option v-for="c in channels" :key="c.key" :label="c.label" :value="c.key" />
                </el-select>
              </el-form-item>
              <el-form-item label="接收方" v-if="form.channel !== 'inapp'">
                <el-input v-model="form.to" placeholder="邮箱 / 手机号 / 企业微信用户ID" />
              </el-form-item>
              <el-form-item label="接收人" v-else>
                <el-input v-model="form.to" placeholder="用户名，* 表示全员广播" />
              </el-form-item>
              <el-form-item label="标题"><el-input v-model="form.title" placeholder="消息标题" /></el-form-item>
              <el-form-item label="内容"><el-input v-model="form.content" type="textarea" :rows="3" placeholder="消息内容" /></el-form-item>
              <el-form-item>
                <el-button type="primary" size="small" :loading="sending" @click="send">发送</el-button>
              </el-form-item>
            </el-form>
          </div>
        </el-col>

        <!-- 发送日志 -->
        <el-col :span="12">
          <div class="mc-card">
            <h3>最近发送日志</h3>
            <el-table :data="logs" size="small" style="width:100%" empty-text="暂无记录" max-height="360">
              <el-table-column prop="channel" label="通道" width="80" />
              <el-table-column prop="to" label="接收方" min-width="100" show-overflow-tooltip />
              <el-table-column prop="title" label="标题" min-width="120" show-overflow-tooltip />
              <el-table-column prop="mode" label="模式" width="90">
                <template #default="{ row }"><el-tag size="small" effect="plain">{{ row.mode }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="at" label="时间" width="150">
                <template #default="{ row }">{{ fmt(row.at) }}</template>
              </el-table-column>
            </el-table>
          </div>
        </el-col>
      </el-row>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import PageHeaderBar from '../components/PageHeaderBar.vue';
import { sendMessage, getMessageChannels, getMessageLogs } from '../services/api';

const ICONS: Record<string, string> = { inapp: '📬', email: '📧', sms: '📱', wechat: '💬' };
const LABELS: Record<string, string> = { inapp: '站内信', email: '邮件', sms: '短信', wechat: '微信' };
const channels = ref<any[]>([]);
const logs = ref<any[]>([]);
const sending = ref(false);
const form = reactive({ channel: 'inapp', to: '', title: '', content: '' });

const fmt = (v: any) => (v ? String(v).replace('T', ' ').slice(0, 19) : '—');

async function load() {
  try {
    const r = await getMessageChannels();
    if (r.success) {
      channels.value = Object.entries(r.data).map(([key, val]: [string, any]) => ({ key, label: LABELS[key] || key, ...val }));
    }
    const l = await getMessageLogs(50);
    if (l.success) logs.value = l.data;
  } catch { ElMessage.error('加载失败'); }
}

async function send() {
  if (!form.title) return ElMessage.warning('请填写标题');
  sending.value = true;
  try {
    const r = await sendMessage({ ...form });
    if (r.success) {
      ElMessage.success(`已通过 ${r.data.channel} 发送（${r.data.mode}模式）`);
      form.title = ''; form.content = '';
      load();
    } else ElMessage.error(r.message || '发送失败');
  } catch { ElMessage.error('发送失败'); }
  finally { sending.value = false; }
}

onMounted(load);
</script>

<style scoped>
.mc-view { padding: 20px 22px; }
.mc-body { margin-top: 16px; }
.mc-tip { background: #eef3ff; border: 1px solid #dbe6ff; color: #4a5a78; border-radius: 8px; padding: 12px 16px; font-size: 13px; margin-bottom: 16px; }
.channel-cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 16px; }
.channel-card { display: flex; gap: 12px; align-items: center; background: #fff; border-radius: 12px; padding: 16px; box-shadow: 0 1px 4px rgba(16,42,82,.07); border-left: 3px solid #c0c4cc; }
.channel-card.ready { border-left-color: #67c23a; }
.cc-icon { font-size: 28px; }
.cc-name { font-size: 14px; font-weight: 600; color: #1f2d3d; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.cc-note { font-size: 12px; color: #909399; }
.mc-card { background: #fff; border-radius: 12px; padding: 18px; box-shadow: 0 1px 4px rgba(16,42,82,.07); }
.mc-card h3 { margin: 0 0 14px; font-size: 15px; color: #1f2d3d; }
@media (max-width: 1100px) { .channel-cards { grid-template-columns: repeat(2, 1fr); } }
</style>
