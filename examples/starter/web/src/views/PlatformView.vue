<template>
  <div class="page">
    <el-tabs v-model="tab">
      <!-- 报表 BI -->
      <el-tab-pane label="报表 BI" name="report">
        <el-table :data="reports" size="small" border>
          <el-table-column prop="name" label="报表" min-width="140" />
          <el-table-column prop="chartType" label="图表" width="90" />
          <el-table-column label="SQL" min-width="260"><template #default="{ row }"><code class="mini">{{ row.sqlTemplate }}</code></template></el-table-column>
          <el-table-column label="操作" width="100" fixed="right"><template #default="{ row }"><el-button size="small" link type="primary" @click="runReport(row)">查看</el-button></template></el-table-column>
        </el-table>
        <el-dialog v-model="reportDialog" :title="currentReport?.name || '报表'" width="720px">
          <div v-if="reportData" class="chart-box">
            <div v-for="(row, i) in reportData.rows" :key="i" class="chart-row">
              <span class="chart-label">{{ row[reportData.columns[0]] }}</span>
              <div class="chart-track"><div class="chart-bar" :style="{ width: barWidth(row[reportData.columns[1]]) + '%' }" /></div>
              <span class="chart-value">{{ row[reportData.columns[1]] }}</span>
            </div>
          </div>
          <el-empty v-else description="暂无数据" :image-size="60" />
        </el-dialog>
      </el-tab-pane>

      <!-- 多租户 -->
      <el-tab-pane label="多租户" name="tenant">
        <div class="bar"><el-tag size="small" type="info">字段级隔离基础已就绪，业务表接入 tenantId 后生效</el-tag></div>
        <el-table :data="tenants" size="small" border>
          <el-table-column prop="code" label="编码" width="120" />
          <el-table-column prop="name" label="名称" min-width="140" />
          <el-table-column prop="planName" label="套餐" width="120" />
          <el-table-column prop="status" label="状态" width="90"><template #default="{ row }"><el-tag size="small" :type="row.status ? 'success' : 'info'">{{ row.status ? '启用' : '停用' }}</el-tag></template></el-table-column>
          <el-table-column label="配置" min-width="180"><template #default="{ row }"><code class="mini">{{ JSON.stringify(row.config) }}</code></template></el-table-column>
        </el-table>
        <div class="section-title">套餐</div>
        <el-table :data="plans" size="small" border>
          <el-table-column prop="name" label="套餐" min-width="120" />
          <el-table-column prop="price" label="价格" width="100" />
          <el-table-column label="配额" min-width="260"><template #default="{ row }"><code class="mini">{{ JSON.stringify(row.limits) }}</code></template></el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 合规 -->
      <el-tab-pane label="数据合规" name="compliance">
        <div class="bar">
          <el-button size="small" @click="checkEncrypt">字段加密演示</el-button>
          <el-tag size="small" type="warning">本地 AES-256-GCM；配 KMS_URL 切真实 KMS</el-tag>
        </div>
        <el-table :data="classifications" size="small" border>
          <el-table-column prop="tableName" label="表" width="130" />
          <el-table-column prop="columnName" label="字段" width="130" />
          <el-table-column prop="level" label="分级" width="110"><template #default="{ row }"><el-tag size="small" :type="levelType(row.level)">{{ row.level }}</el-tag></template></el-table-column>
          <el-table-column prop="maskRule" label="脱敏规则" width="110" />
          <el-table-column prop="encrypt" label="加密" width="80"><template #default="{ row }">{{ row.encrypt ? '是' : '否' }}</template></el-table-column>
        </el-table>
        <div v-if="encryptResult" class="result-box">
          <div><b>密文：</b><code>{{ encryptResult.cipher }}</code></div>
          <div><b>解密：</b><code>{{ encryptResult.plain }}</code></div>
          <div><b>适配器：</b>{{ encryptResult.kind }}</div>
        </div>
        <div class="section-title">委托授权</div>
        <el-table :data="delegations" size="small" border>
          <el-table-column prop="fromUser" label="委托人" width="120" />
          <el-table-column prop="toUser" label="受托人" width="120" />
          <el-table-column prop="reason" label="原因" min-width="160" />
          <el-table-column prop="startTime" label="开始" width="170" />
          <el-table-column prop="endTime" label="结束" width="170" />
        </el-table>
        <el-empty v-if="!delegations.length" description="暂无委托" :image-size="50" />
      </el-tab-pane>

      <!-- 集成 -->
      <el-tab-pane label="数据集成" name="integration">
        <div class="section-title">事件订阅 / Webhook</div>
        <el-table :data="subscriptions" size="small" border>
          <el-table-column prop="eventKey" label="事件" width="150" />
          <el-table-column prop="targetUrl" label="回调地址" min-width="240" />
          <el-table-column prop="enabled" label="状态" width="90"><template #default="{ row }"><el-tag size="small" :type="row.enabled ? 'success' : 'info'">{{ row.enabled ? '启用' : '停用' }}</el-tag></template></el-table-column>
        </el-table>
        <el-empty v-if="!subscriptions.length" description="暂无订阅" :image-size="50" />
        <div class="section-title">ETL 管线</div>
        <el-table :data="etl" size="small" border>
          <el-table-column prop="name" label="管线" min-width="140" />
          <el-table-column prop="sourceType" label="来源" width="110" />
          <el-table-column prop="targetTable" label="目标表" width="150" />
          <el-table-column prop="lastRunAt" label="上次运行" width="170" />
        </el-table>
        <el-empty v-if="!etl.length" description="暂无管线" :image-size="50" />
        <div class="section-title">开放平台 API 密钥</div>
        <el-table :data="apiKeys" size="small" border>
          <el-table-column prop="appName" label="应用" min-width="140" />
          <el-table-column prop="accessKey" label="AccessKey" min-width="200" />
          <el-table-column label="授权范围" min-width="180"><template #default="{ row }"><code class="mini">{{ JSON.stringify(row.scopeList) }}</code></template></el-table-column>
        </el-table>
        <el-empty v-if="!apiKeys.length" description="暂无密钥" :image-size="50" />
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { platformApi } from '../services/api';

const tab = ref('report');
const reports = ref<any[]>([]);
const tenants = ref<any[]>([]);
const plans = ref<any[]>([]);
const classifications = ref<any[]>([]);
const delegations = ref<any[]>([]);
const subscriptions = ref<any[]>([]);
const etl = ref<any[]>([]);
const apiKeys = ref<any[]>([]);
const reportDialog = ref(false);
const currentReport = ref<any>(null);
const reportData = ref<any>(null);
const encryptResult = ref<any>(null);

const levelType = (l: string) => ({ secret: 'danger', sensitive: 'warning', internal: 'primary' } as Record<string,string>)[l] || 'info';
const barWidth = (v: any) => { const n = Number(v) || 0; return Math.min(100, n * 8); };

async function load() {
  try {
    const [r, t, p, c, d, s, e, k] = await Promise.all([
      platformApi.reports(), platformApi.tenants(), platformApi.plans(), platformApi.classifications(),
      platformApi.delegations(), platformApi.subscriptions(), platformApi.etl(), platformApi.apiKeys(),
    ]);
    reports.value = r.data || []; tenants.value = t.data || []; plans.value = p.data || [];
    classifications.value = c.data || []; delegations.value = d.data || []; subscriptions.value = s.data || [];
    etl.value = e.data || []; apiKeys.value = k.data || [];
  } catch { ElMessage.error('加载失败'); }
}
async function runReport(row: any) {
  try { currentReport.value = row; reportData.value = (await platformApi.reportData(row.code)).data; reportDialog.value = true; }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '查询失败'); }
}
async function checkEncrypt() {
  try {
    const { value } = await ElMessageBox.prompt('输入要加密的敏感值', '字段加密演示', { inputValue: '13800138000' });
    const enc = await platformApi.encrypt(value);
    const dec = await platformApi.decrypt(enc.data.cipher);
    encryptResult.value = { cipher: enc.data.cipher, plain: dec.data.value, kind: enc.data.kind };
  } catch { /* 取消 */ }
}
onMounted(load);
</script>

<style scoped>
.page { padding: 4px; }
.bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.section-title { font-weight: 600; margin: 18px 0 8px; color: var(--el-text-color-primary); }
.mini { font-size: 12px; color: var(--el-text-color-regular); }
.result-box { margin-top: 12px; padding: 12px; background: var(--el-fill-color-light); border-radius: 6px; font-size: 13px; line-height: 1.9; }
.result-box code { word-break: break-all; }
.chart-box { padding: 8px 0; }
.chart-row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.chart-label { width: 120px; text-align: right; font-size: 13px; }
.chart-track { flex: 1; height: 18px; background: var(--el-fill-color-light); border-radius: 4px; overflow: hidden; }
.chart-bar { height: 100%; background: linear-gradient(90deg, #667eea, #764ba2); }
.chart-value { width: 60px; font-size: 13px; font-weight: 600; }
</style>
