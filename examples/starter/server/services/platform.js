/**
 * 平台能力适配器层（无外部资源直接可用，外部资源预留配置位）
 *
 * 设计原则：每个能力都有一个"本地实现"（开箱即用），当对应环境变量填写后切换为真实适配器。
 *   - cache      : 内存 LRU（默认） / REDIS_URL 配置后预留 Redis 适配器
 *   - eventBus   : 内存 EventEmitter（默认） / MQ_URL 配置后预留 RabbitMQ/Kafka 适配器
 *   - secrets    : 本地 AES-256-GCM（默认） / KMS_URL 配置后预留 KMS 适配器
 *   - llm        : 内置演示回答（默认） / LLM_API_URL 配置后走 OpenAI 兼容 HTTP 接口
 *   - tracing    : 内存 span 环形缓冲（默认） / OTLP_ENDPOINT 配置后预留 OTLP 上报
 *   - featureFlag: 基于 app_configs 表的开关（读时生效）
 *
 * 所有"预留适配器"在被调用时给出明确提示，绝不静默降级成错误的成功。
 */
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

/* ============================ 1. 缓存 ============================ */
function createMemoryCache(max = 2000) {
  const store = new Map();
  return {
    kind: 'memory',
    get(k) { const v = store.get(k); if (!v) return undefined; if (v.exp && v.exp < Date.now()) { store.delete(k); return undefined; } return v.val; },
    set(k, val, ttlMs = 0) { store.set(k, { val, exp: ttlMs > 0 ? Date.now() + ttlMs : 0 }); if (store.size > max) store.delete(store.keys().next().value); return true; },
    del(k) { return store.delete(k); },
    clear() { store.clear(); },
    async size() { return store.size; },
  };
}
function createRedisPlaceholder(url) {
  const msg = `REDIS_URL 已配置但 Redis 适配器尚未接入。请安装 redis 客户端并在 services/platform.js 的 createCache 中实现（连接 ${url}）。当前请清空 REDIS_URL 使用内存缓存。`;
  return { kind: 'redis-placeholder', __message: msg, get() { throw new Error(msg); }, set() { throw new Error(msg); }, del() { throw new Error(msg); }, clear() { throw new Error(msg); }, async size() { throw new Error(msg); } };
}
export function createCache() {
  return process.env.REDIS_URL ? createRedisPlaceholder(process.env.REDIS_URL) : createMemoryCache(+(process.env.CACHE_MAX_KEYS || 2000));
}

/* ============================ 2. 事件总线 ============================ */
function createMemoryBus() {
  const ee = new EventEmitter();
  ee.setMaxListeners(200);
  const published = [];
  return {
    kind: 'memory',
    on(evt, fn) { ee.on(evt, fn); return () => ee.off(evt, fn); },
    async publish(evt, payload) { published.push({ evt, payload, at: new Date().toISOString() }); ee.emit(evt, payload); if (published.length > 500) published.shift(); return true; },
    history() { return published.slice(); },
    async size() { return ee.eventNames().length; },
  };
}
function createMQPlaceholder(url) {
  const msg = `MQ_URL 已配置但消息队列适配器尚未接入。请安装 amqplib/kafkajs 并在 services/platform.js 的 createEventBus 中实现（连接 ${url}）。当前请清空 MQ_URL 使用内存事件总线。`;
  return { kind: 'mq-placeholder', __message: msg, on() { throw new Error(msg); }, async publish() { throw new Error(msg); }, history() { return []; }, async size() { throw new Error(msg); } };
}
export function createEventBus() {
  const bus = process.env.MQ_URL ? createMQPlaceholder(process.env.MQ_URL) : createMemoryBus();
  // 应用内预置几个领域事件通道，方便业务直接订阅
  bus.CHANNELS = ['user.created', 'audit.danger', 'workflow.approved', 'data.changed', 'notification.send'];
  return bus;
}

/* ============================ 3. 密钥管理（加密存储） ============================ */
const KEY = (() => {
  const secret = process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || 'dev-master-key-change-me';
  return crypto.createHash('sha256').update(secret).digest(); // 32 字节 AES 密钥
})();
function encryptLocal(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return `enc:v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${enc.toString('base64')}`;
}
function decryptLocal(payload) {
  if (typeof payload !== 'string' || !payload.startsWith('enc:v1:')) return payload; // 非密文原样返回（兼容历史数据）
  const [, , ivB64, tagB64, dataB64] = payload.split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
}
export function createSecrets() {
  if (process.env.KMS_URL) {
    const msg = `KMS_URL 已配置但 KMS 适配器尚未接入。请实现 services/platform.js 的 createSecrets 对接 ${process.env.KMS_URL}（字段级加密/密钥轮换）。当前请清空 KMS_URL 使用本地 AES-256-GCM。`;
    return { kind: 'kms-placeholder', __message: msg, encrypt() { throw new Error(msg); }, decrypt() { throw new Error(msg); }, rotate() { throw new Error(msg); } };
  }
  return {
    kind: 'local-aes-256-gcm',
    encrypt: encryptLocal,
    decrypt: decryptLocal,
    rotate() { return { ok: false, message: '本地 AES 模式使用静态主密钥；启用密钥轮换请配置 KMS_URL 并接入 KMS 适配器' }; },
    fingerprint(plain) { return crypto.createHash('sha256').update(String(plain)).digest('hex').slice(0, 16); },
  };
}

/* ============================ 4. LLM（AI 助手） ============================ */
const DEMO_REplies = [
  '这是骨架内置的演示回答。配置 LLM_API_URL 与 LLM_API_KEY 后即可接入真实大模型（兼容 OpenAI chat/completions 协议）。',
  '我可以帮你分析日志、生成描述、解释接口。当前处于演示模式，接入模型后这些能力会自动启用。',
  '提示：在 .env 中填写 LLM_API_URL（如 https://api.openai.com/v1/chat/completions）和 LLM_API_KEY，无需改代码即可切换。',
];
export function createLLM() {
  if (!process.env.LLM_API_URL) {
    return {
      kind: 'demo',
      async chat(messages = []) {
        const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
        const idx = Math.abs([...last].reduce((a, c) => a + c.charCodeAt(0), 0)) % DEMO_REplies.length;
        return { kind: 'demo', content: DEMO_REplies[idx], usage: { promptTokens: 0, completionTokens: 0 } };
      },
    };
  }
  return {
    kind: 'http-openai-compatible',
    async chat(messages = []) {
      const resp = await fetch(process.env.LLM_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(process.env.LLM_API_KEY ? { Authorization: `Bearer ${process.env.LLM_API_KEY}` } : {}) },
        body: JSON.stringify({ model: process.env.LLM_MODEL || 'gpt-4o-mini', messages, temperature: 0.3, max_tokens: +(process.env.LLM_MAX_TOKENS || 1024) }),
        signal: AbortSignal.timeout(+(process.env.LLM_TIMEOUT_MS || 20000)),
      });
      if (!resp.ok) throw new Error(`LLM 上游返回 ${resp.status}`);
      const json = await resp.json();
      return { kind: 'http', content: json?.choices?.[0]?.message?.content || '', usage: json?.usage || {} };
    },
  };
}

/* ============================ 5. 链路追踪 ============================ */
export function createTracer(capacity = 1000) {
  const spans = [];
  return {
    kind: process.env.OTLP_ENDPOINT ? 'otlp-placeholder' : 'memory',
    note: process.env.OTLP_ENDPOINT ? `OTLP_ENDPOINT 已配置但上报适配器未接入，span 仅存内存。请实现 createTracer 上报到 ${process.env.OTLP_ENDPOINT}。` : null,
    start(name, traceId, parentId = null) { const s = { id: crypto.randomUUID(), name, traceId, parentId, startAt: Date.now(), endAt: null, attrs: {} }; spans.push(s); if (spans.length > capacity) spans.shift(); return s; },
    finish(spanId, attrs = {}) { const s = spans.find((x) => x.id === spanId); if (s) { s.endAt = Date.now(); s.durationMs = s.endAt - s.startAt; s.attrs = { ...s.attrs, ...attrs }; } return s; },
    list(traceId) { return traceId ? spans.filter((s) => s.traceId === traceId) : spans.slice(); },
    async flush() { return { spans: spans.length, exported: 0, note: this.note }; },
  };
}

/* ============================ 6. 特性开关 ============================ */
export function createFeatureFlags(pool) {
  return {
    kind: 'db-backed',
    async isOn(key, fallback = false) {
      try {
        const [rows] = await pool.execute("SELECT configValue FROM app_configs WHERE configKey=? AND category='feature'", [`feature.${key}`]);
        if (!rows.length) return fallback;
        return ['1', 'true', 'on'].includes(String(rows[0].configValue).toLowerCase());
      } catch { return fallback; }
    },
    async all() {
      try { const [rows] = await pool.execute("SELECT configKey, configValue FROM app_configs WHERE category='feature'"); return rows.map((r) => ({ key: r.configKey.replace(/^feature\./, ''), enabled: ['1', 'true', 'on'].includes(String(r.configValue).toLowerCase()) })); }
      catch { return []; }
    },
  };
}

/* ============================ 汇总 ============================ */
export function createPlatform(pool) {
  const cache = createCache();
  const eventBus = createEventBus();
  const secrets = createSecrets();
  const llm = createLLM();
  const tracer = createTracer();
  const featureFlags = createFeatureFlags(pool);
  const status = () => ({
    cache: cache.kind, eventBus: eventBus.kind, secrets: secrets.kind, llm: llm.kind, tracer: tracer.kind, featureFlags: featureFlags.kind,
    placeholders: [cache, eventBus, secrets, tracer].filter((x) => x.__message || x.note).map((x) => x.__message || x.note),
  });
  return { cache, eventBus, secrets, llm, tracer, featureFlags, status };
}
export default createPlatform;
