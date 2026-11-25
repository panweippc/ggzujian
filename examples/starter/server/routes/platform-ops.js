/**
 * 稳定性 / 可观测 / AI 能力路由
 *  - 熔断降级：基于内存状态，配置从 app_configs 读（读时生效）
 *  - 结构化日志：JSON 行查询（复用 logs/ 目录）
 *  - trace 采样 / 链路 span 查询
 *  - UEBA 风控：按登录失败/危险操作聚合判定异常
 *  - AI 助手：走 platform 的 llm 适配器（demo / 真实大模型）
 *  - 智能巡检：基于规则扫描日志与慢接口
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';
import { createCache, createEventBus, createLLM, createTracer, createFeatureFlags } from '../services/platform.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const operatorOf = (req) => getOperator(req) || 'system';
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const err = (res, code, msg) => res.status(code).json({ success: false, message: msg });
const jsonParse = (v, f) => { if (v == null) return f; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return f; } };

// 应用级单例（挂到 app.locals，避免每请求重建）
function shared(req) {
  const app = req.app;
  app.locals._platform ||= {
    cache: createCache(), bus: createEventBus(), llm: createLLM(), tracer: createTracer(),
    circuit: new Map(), // key -> {failures, openedUntil, state}
  };
  return app.locals._platform;
}

/* ==================== 1. 稳定性：熔断 / 缓存 / 特性开关 ==================== */
// 熔断器：调用方上报成功/失败，超过阈值则打开，冷却后半开。纯内存演示。
router.get('/resilience/circuit', (req, res) => {
  const { circuit } = shared(req);
  ok(res, [...circuit.entries()].map(([key, v]) => ({ key, ...v })));
});
router.post('/resilience/circuit/:key/report', (req, res) => {
  const { circuit } = shared(req);
  const { ok: success = true, threshold = 5, cooldownMs = 30000 } = req.body || {};
  const key = req.params.key;
  const st = circuit.get(key) || { failures: 0, state: 'closed', openedUntil: 0 };
  if (success) {
    st.failures = 0; st.state = 'closed'; st.openedUntil = 0;
  } else {
    st.failures += 1;
    if (st.failures >= threshold) { st.state = 'open'; st.openedUntil = Date.now() + cooldownMs; }
  }
  // 半开判定
  if (st.state === 'open' && Date.now() > st.openedUntil) st.state = 'half-open';
  circuit.set(key, st);
  ok(res, { key, ...st });
});
router.get('/resilience/cache', (req, res) => {
  const c = shared(req).cache;
  if (c.__message) return err(res, 400, c.__message);
  ok(res, { kind: c.kind, keys: 'see /resilience/cache/stats' });
});
router.get('/resilience/cache/stats', async (req, res) => {
  const c = shared(req).cache;
  if (c.__message) return err(res, 400, c.__message);
  try { ok(res, { kind: c.kind, size: await c.size() }); } catch (e) { err(res, 400, e.message); }
});
router.post('/resilience/cache', (req, res) => {
  const c = shared(req).cache;
  const { key, value, ttlMs = 0 } = req.body || {};
  if (c.__message) return err(res, 400, c.__message);
  if (!key) return err(res, 400, 'key 必填');
  c.set(key, value, ttlMs); ok(res, { set: true, kind: c.kind });
});
router.get('/resilience/cache/:key', (req, res) => {
  const c = shared(req).cache;
  if (c.__message) return err(res, 400, c.__message);
  ok(res, { key: req.params.key, value: c.get(req.params.key) ?? null });
});
router.get('/feature-flags', async (req, res) => {
  try { ok(res, await createFeatureFlags(poolOf(req)).all()); }
  catch { ok(res, []); }
});

/* ==================== 2. 可观测：结构化日志 / trace / 采样 ==================== */
// 读 logs/ 目录下的结构化日志（安全告警 / 消息中心）
router.get('/observability/logs', (req, res) => {
  const { file = 'security-alert.log', lines = 100 } = req.query;
  const safe = path.basename(String(file)); // 防目录穿越
  const fp = path.join(process.cwd(), 'logs', safe);
  if (!fs.existsSync(fp)) return ok(res, []);
  try {
    const content = fs.readFileSync(fp, 'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-(+lines || 100));
    ok(res, content.map((line) => { try { return JSON.parse(line); } catch { return { raw: line }; } }));
  } catch { err(res, 500, '读取日志失败'); }
});
// 链路 span 查询（按 traceId）
router.get('/observability/traces', (req, res) => {
  const t = shared(req).tracer;
  const span = t.start('api.query', req.traceId || 'manual');
  t.finish(span.id, { path: req.path });
  ok(res, t.list(req.traceId || null), { note: t.note || null });
});
router.post('/observability/traces', (req, res) => {
  const { name = 'custom', traceId = 'manual', durationMs = 0 } = req.body || {};
  const t = shared(req).tracer;
  const span = t.start(name, traceId);
  t.finish(span.id, { durationMs });
  ok(res, span, { note: t.note || null });
});
router.get('/observability/flush', (req, res) => {
  ok(res, shared(req).tracer.flush());
});
// trace 采样率配置（读时生效）
router.get('/observability/sampling', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute("SELECT configValue FROM app_configs WHERE configKey='observability.traceSampleRate'");
    ok(res, { rate: +(rows[0]?.configValue ?? 1) });
  } catch { ok(res, { rate: 1 }); }
});
router.put('/observability/sampling', async (req, res) => {
  const { rate = 1 } = req.body || {};
  const r = Math.min(1, Math.max(0, +rate));
  try {
    await poolOf(req).execute(
      "INSERT INTO app_configs (configKey,configValue,category,env,description) VALUES ('observability.traceSampleRate',?,'observability','dev','链路采样率 0-1') ON DUPLICATE KEY UPDATE configValue=VALUES(configValue)",
      [String(r)]
    );
    ok(res, { rate: r });
  } catch { err(res, 500, '保存失败'); }
});

/* ==================== 3. UEBA 风控 ==================== */
router.get('/ueba/alerts', async (req, res) => {
  const pool = poolOf(req);
  try {
    const [rows] = await pool.execute(
      `SELECT username, action, COUNT(*) cnt, MAX(createdAt) lastAt
       FROM operation_logs WHERE createdAt > DATE_SUB(NOW(), INTERVAL 1 HOUR)
       AND action IN ('login_fail','login_locked','delete','change_password','assign')
       GROUP BY username, action HAVING cnt >= 3 ORDER BY cnt DESC LIMIT 50`
    );
    const alerts = rows.map((r) => ({
      username: r.username, action: r.action, count: r.cnt, lastAt: r.lastAt,
      level: r.cnt >= 10 ? 'HIGH' : r.cnt >= 5 ? 'MEDIUM' : 'LOW',
      suggestion: r.action === 'login_fail' ? '可能存在暴力破解，建议锁定账号或启用二次验证' : '短时间高频操作，建议核实操作人身份',
    }));
    ok(res, alerts);
  } catch { err(res, 500, '分析失败'); }
});

/* ==================== 4. AI 助手 / RAG / NL2SQL / 智能巡检 ==================== */
// AI 聊天（走适配器：demo 或真实大模型）
router.post('/ai/chat', async (req, res) => {
  const { messages = [] } = req.body || {};
  if (!Array.isArray(messages) || !messages.length) return err(res, 400, 'messages 必填');
  try {
    const answer = await shared(req).llm.chat(messages);
    await writeAudit(poolOf(req), req, { action: 'ai_chat', module: 'ai', detail: `AI 对话（${answer.kind}）` });
    ok(res, answer);
  } catch (e) { err(res, 502, 'AI 服务不可用：' + e.message); }
});
// RAG 知识库检索：基于文件服务的元数据做关键词匹配（本地实现）
router.post('/ai/rag/search', async (req, res) => {
  const { query = '', topK = 5 } = req.body || {};
  if (!query) return err(res, 400, 'query 必填');
  try {
    const [rows] = await poolOf(req).execute('SELECT objectKey,originalName,mimeType,size,createdAt FROM file_objects ORDER BY createdAt DESC LIMIT 200');
    const kw = String(query).toLowerCase();
    const scored = rows.map((r) => ({ ...r, score: String(r.originalName || '').toLowerCase().includes(kw) ? 2 : String(r.objectKey || '').toLowerCase().includes(kw) ? 1 : 0 }))
      .filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, +topK);
    ok(res, { query, hits: scored, note: '骨架演示：基于文件名关键词检索；接入向量库后改为语义检索（配置 VECTOR_DB_URL）' });
  } catch { err(res, 500, '检索失败'); }
});
// 自然语言查数据（NL2SQL 骨架：规则映射，不接大模型时用关键词表）
router.post('/ai/nl2sql', async (req, res) => {
  const { question = '' } = req.body || {};
  if (!question) return err(res, 400, 'question 必填');
  const RULES = [
    { kw: ['登录', '次数'], sql: 'SELECT COUNT(*) c FROM operation_logs WHERE action=\'login\'', desc: '统计登录次数' },
    { kw: ['用户', '数量'], sql: 'SELECT COUNT(*) c FROM users', desc: '统计用户数' },
    { kw: ['失败'], sql: "SELECT COUNT(*) c FROM operation_logs WHERE action='login_fail'", desc: '统计登录失败数' },
  ];
  const hit = RULES.find((r) => r.kw.some((k) => question.includes(k)));
  if (!hit) return ok(res, { matched: false, hint: '未匹配内置规则；配置大模型后可走 LLM 生成 SQL（需人工确认后执行）' });
  try {
    const [rows] = await poolOf(req).execute(hit.sql);
    ok(res, { matched: true, intent: hit.desc, sql: hit.sql, rows });
  } catch { err(res, 500, '查询失败'); }
});
// 智能日志巡检（基于 ai_inspect_rules 规则扫描）
router.get('/ai/inspect', async (req, res) => {
  const pool = poolOf(req);
  try {
    const [rules] = await pool.execute('SELECT * FROM ai_inspect_rules WHERE enabled=1');
    const findings = [];
    for (const rule of rules) {
      const cfg = jsonParse(rule.config, {});
      if (rule.ruleType === 'log' && cfg.action) {
        const [[{ c }]] = await pool.execute('SELECT COUNT(*) c FROM operation_logs WHERE action=? AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)', [cfg.action, cfg.windowMinutes || 5]);
        if (c >= (cfg.threshold || 10)) findings.push({ rule: rule.name, level: 'WARN', detail: `${cfg.action} 近 ${cfg.windowMinutes || 5} 分钟发生 ${c} 次，超过阈值 ${cfg.threshold || 10}` });
      } else if (rule.ruleType === 'anomaly' && cfg.metric === 'slow_request') {
        const [[{ c }]] = await pool.execute('SELECT COUNT(*) c FROM operation_logs WHERE durationMs > 800 AND createdAt > DATE_SUB(NOW(), INTERVAL ? MINUTE)', [cfg.windowMinutes || 10]);
        if (c >= (cfg.threshold || 20)) findings.push({ rule: rule.name, level: 'WARN', detail: `慢接口近 ${cfg.windowMinutes || 10} 分钟 ${c} 次，超过阈值 ${cfg.threshold || 20}` });
      }
    }
    ok(res, findings);
  } catch { err(res, 500, '巡检失败'); }
});
router.get('/ai/inspect/rules', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM ai_inspect_rules ORDER BY id'); ok(res, rows.map((r) => ({ ...r, config: jsonParse(r.config, {}) }))); }
  catch { err(res, 500, '读取规则失败'); }
});

/* ==================== 5. 适配器状态总览 ==================== */
router.get('/platform/status', (req, res) => {
  const p = shared(req);
  ok(res, {
    cache: p.cache.kind, eventBus: p.bus.kind, llm: p.llm.kind, tracer: p.tracer.kind,
    circuitCount: p.circuit.size,
    placeholders: [p.cache.__message, p.bus.__message, p.tracer.note].filter(Boolean),
  });
});

export default router;
