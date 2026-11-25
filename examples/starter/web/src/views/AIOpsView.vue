<template>
  <div class="page">
    <el-tabs v-model="tab">
      <!-- 适配器状态 -->
      <el-tab-pane label="适配器状态" name="status">
        <el-alert v-if="status?.placeholders?.length" type="warning" :closable="false" show-icon style="margin-bottom:12px" :title="status.placeholders.join('；')" />
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="缓存">{{ status?.cache || '-' }}</el-descriptions-item>
          <el-descriptions-item label="事件总线">{{ status?.eventBus || '-' }}</el-descriptions-item>
          <el-descriptions-item label="AI 引擎">{{ status?.llm || '-' }}</el-descriptions-item>
          <el-descriptions-item label="链路追踪">{{ status?.tracer || '-' }}</el-descriptions-item>
          <el-descriptions-item label="熔断器数">{{ status?.circuitCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="缓存键数">{{ cacheStats?.size ?? 0 }}</el-descriptions-item>
        </el-descriptions>
        <div class="section-title">熔断器</div>
        <el-table :data="circuit" size="small" border>
          <el-table-column prop="key" label="服务" min-width="160" />
          <el-table-column prop="failures" label="失败数" width="100" />
          <el-table-column prop="state" label="状态" width="110"><template #default="{ row }"><el-tag size="small" :type="row.state === 'open' ? 'danger' : row.state === 'half-open' ? 'warning' : 'success'">{{ row.state }}</el-tag></template></el-table-column>
          <el-table-column prop="openedUntil" label="冷却至" width="170" />
        </el-table>
        <el-empty v-if="!circuit.length" description="暂无熔断记录" :image-size="50" />
        <div class="section-title">特性开关</div>
        <el-table :data="flags" size="small" border>
          <el-table-column prop="key" label="开关" min-width="200" />
          <el-table-column prop="enabled" label="状态" width="100"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '开' : '关' }}</el-tag></template></el-table-column>
        </el-table>
        <el-empty v-if="!flags.length" description="暂无特性开关（在配置中心 category=feature 添加）" :image-size="50" />
      </el-tab-pane>

      <!-- 可观测 -->
      <el-tab-pane label="可观测" name="observe">
        <div class="section-title">链路 Span</div>
        <el-table :data="traces" size="small" border max-height="260">
          <el-table-column prop="name" label="名称" width="130" />
          <el-table-column prop="traceId" label="TraceID" min-width="200" />
          <el-table-column prop="durationMs" label="耗时ms" width="100" />
          <el-table-column prop="startAt" label="开始" width="170" />
        </el-table>
        <div class="section-title">结构化日志（安全告警）</div>
        <el-table :data="logs" size="small" border max-height="300">
          <el-table-column prop="time" label="时间" width="170" />
          <el-table-column prop="level" label="级别" width="90"><template #default="{ row }"><el-tag size="small" :type="row.level === 'HIGH' ? 'danger' : 'warning'">{{ row.level }}</el-tag></template></el-table-column>
          <el-table-column prop="type" label="类型" width="150" />
          <el-table-column prop="username" label="用户" width="110" />
          <el-table-column prop="detail" label="详情" min-width="220" />
        </el-table>
        <div class="section-title">UEBA 风控告警</div>
        <el-table :data="ueba" size="small" border>
          <el-table-column prop="username" label="用户" width="120" />
          <el-table-column prop="action" label="行为" width="130" />
          <el-table-column prop="count" label="次数" width="90" />
          <el-table-column prop="level" label="级别" width="90"><template #default="{ row }"><el-tag size="small" :type="row.level === 'HIGH' ? 'danger' : row.level === 'MEDIUM' ? 'warning' : 'info'">{{ row.level }}</el-tag></template></el-table-column>
          <el-table-column prop="suggestion" label="建议" min-width="240" />
        </el-table>
        <el-empty v-if="!ueba.length" description="近 1 小时无异常" :image-size="50" />
      </el-tab-pane>

      <!-- AI 助手 -->
      <el-tab-pane label="AI 助手" name="ai">
        <el-alert v-if="status?.llm === 'demo'" type="info" :closable="false" show-icon style="margin-bottom:12px" title="当前为演示模式，配置 LLM_API_URL / LLM_API_KEY 后自动接入真实大模型" />
        <div class="chat-box">
          <div v-for="(m, i) in messages" :key="i" class="chat-msg" :class="m.role === 'user' ? 'mine' : 'ai'">
            <div class="chat-role">{{ m.role === 'user' ? '我' : 'AI' }}</div>
            <div class="chat-content">{{ m.content }}</div>
          </div>
        </div>
        <div class="chat-input">
          <el-input v-model="question" placeholder="输入问题，回车发送" @keyup.enter="send" />
          <el-button type="primary" @click="send" :loading="sending">发送</el-button>
        </div>
        <div class="section-title">工具（无需大模型即可用）</div>
        <el-space wrap>
          <el-button size="small" @click="ragSearch">RAG 知识检索：请假</el-button>
          <el-button size="small" @click="nlQuery">自然语言查数：登录次数</el-button>
          <el-button size="small" @click="runInspect">智能日志巡检</el-button>
        </el-space>
        <div v-if="toolResult" class="result-box"><pre>{{ JSON.stringify(toolResult, null, 2) }}</pre></div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { opsApi } from '../services/api';

const tab = ref('status');
const status = ref<any>(null);
const cacheStats = ref<any>(null);
const circuit = ref<any[]>([]);
const flags = ref<any[]>([]);
const traces = ref<any[]>([]);
const logs = ref<any[]>([]);
const ueba = ref<any[]>([]);
const messages = ref<any[]>([{ role: 'ai', content: '你好，我是底座 AI 助手。配置大模型后可以帮你分析数据、解释接口、巡检日志。' }]);
const question = ref('');
const sending = ref(false);
const toolResult = ref<any>(null);

async function load() {
  try {
    const [s, cs, ci, f, tr, lg, u] = await Promise.all([
      opsApi.status(), opsApi.cacheStats(), opsApi.circuit(), opsApi.featureFlags(),
      opsApi.traces(), opsApi.logs('security-alert.log', 30), opsApi.ueba(),
    ]);
    status.value = s.data; cacheStats.value = cs.data; circuit.value = ci.data || [];
    flags.value = f.data || []; traces.value = tr.data || []; logs.value = lg.data || []; ueba.value = u.data || [];
  } catch { ElMessage.error('加载失败'); }
}
async function send() {
  const q = question.value.trim();
  if (!q || sending.value) return;
  messages.value.push({ role: 'user', content: q }); question.value = ''; sending.value = true;
  try { const r = await opsApi.chat(messages.value.slice(-10)); messages.value.push({ role: 'ai', content: r.data.content }); }
  catch (e: any) { messages.value.push({ role: 'ai', content: '服务不可用：' + (e?.response?.data?.message || e.message) }); }
  finally { sending.value = false; }
}
async function ragSearch() { try { toolResult.value = (await opsApi.rag('请假')).data; } catch (e: any) { ElMessage.error(e?.message || '失败'); } }
async function nlQuery() { try { toolResult.value = (await opsApi.nl2sql('登录次数')).data; } catch (e: any) { ElMessage.error(e?.message || '失败'); } }
async function runInspect() { try { toolResult.value = (await opsApi.inspect()).data; } catch (e: any) { ElMessage.error(e?.message || '失败'); } }
onMounted(load);
</script>

<style scoped>
.page { padding: 4px; }
.section-title { font-weight: 600; margin: 18px 0 8px; color: var(--el-text-color-primary); }
.result-box { margin-top: 12px; padding: 12px; background: var(--el-fill-color-light); border-radius: 6px; font-size: 12px; max-height: 320px; overflow: auto; }
.chat-box { height: 340px; overflow-y: auto; padding: 12px; background: var(--el-fill-color-lighter); border-radius: 8px; margin-bottom: 12px; }
.chat-msg { display: flex; gap: 10px; margin-bottom: 12px; }
.chat-msg.mine { flex-direction: row-reverse; }
.chat-role { width: 32px; height: 32px; border-radius: 50%; background: #667eea; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 12px; flex-shrink: 0; }
.chat-msg.mine .chat-role { background: #764ba2; }
.chat-content { max-width: 72%; padding: 8px 12px; background: #fff; border-radius: 8px; font-size: 13px; line-height: 1.6; color: #303133; }
.chat-input { display: flex; gap: 10px; }
</style>
