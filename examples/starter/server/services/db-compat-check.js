/**
 * 数据库自动识别 + 启动自检（把"上线时才报错"提前到"启动时报错"）
 *
 * 两个层次：
 *   1) detectDriver()：连接前按连接串 scheme / 端口推断协议族，连上后按 VERSION() 识别真实驱动。
 *      DB_DRIVER=auto 或留空时启用；识别不出来明确报错并打印原始版本串，绝不猜测后硬套方言。
 *   2) runStartupCheck()：用真实驱动跑冒烟 SQL（SELECT 1 / 版本 / upsert / 分页 / 函数），
 *      每条都经过兼容层转换，失败时明确报出「哪条 SQL + 哪个方言」。
 *
 * 开关：
 *   DB_DRIVER=auto|mysql|postgres|kingbase|opengauss|dameng
 *   DB_STRICT_DRIVER_MATCH=true  识别结果与配置不一致时启动失败（默认只警告）
 *   DB_SKIP_COMPAT_CHECK=true    跳过自检（紧急情况，不建议生产使用）
 */
import { getDialect, PG_DRIVERS, ALL_DRIVERS } from './dialects.js';

/** 版本串 → 驱动的关键字规则（顺序敏感：特殊库在前，通用 PG 在后） */
const VERSION_RULES = [
  { driver: 'kingbase', re: /kingbase|人大金仓/i },
  { driver: 'opengauss', re: /open[\s_-]*gauss/i },
  { driver: 'dameng', re: /dm\s*database|dameng|达梦/i },
  { driver: 'mysql', re: /mysql|mariadb/i },
  { driver: 'postgres', re: /postgres(?:ql)?/i },
];

/** 从版本串识别驱动；识别不出返回 null（调用方明确报错） */
export function driverFromVersion(versionText) {
  const s = String(versionText || '');
  for (const rule of VERSION_RULES) if (rule.re.test(s)) return rule.driver;
  return null;
}

/** 按连接串 scheme / 端口推断协议族（mysql | pg），仅用于"先用哪个驱动去连" */
export function guessProtocol() {
  const url = process.env.DATABASE_URL || process.env.PG_URL || '';
  const sm = url.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (sm) {
    const scheme = sm[1].toLowerCase();
    if (/mysql/i.test(scheme)) return 'mysql';
    if (/postgres|postgresql|kingbase|opengauss|dm|dameng/i.test(scheme)) return 'pg';
  }
  const port = +(process.env.DB_PORT || 0);
  if (port === 3306 || port === 3307) return 'mysql';
  if (port === 5432 || port === 5433 || port === 5236 || port === 54321) return 'pg';
  // 默认按显式 DB_DRIVER 或 mysql
  return (process.env.DB_DRIVER || '').toLowerCase() === 'mysql' ? 'mysql' : 'pg';
}

/** 读取连接配置（供临时探测连接用） */
function connConfig() {
  return {
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectionString: process.env.PG_URL || process.env.DATABASE_URL || undefined,
  };
}

/**
 * 自动识别真实驱动。
 * @returns {Promise<{driver:string, version:string, protocol:string, source:string}>}
 */
export async function detectDriver() {
  const protocol = guessProtocol();
  const cfg = connConfig();
  let version = '';
  if (protocol === 'mysql') {
    const mysql = (await import('mysql2/promise')).default;
    const conn = await mysql.createConnection({ ...cfg, connectTimeout: 5000 });
    try {
      const [rows] = await conn.query('SELECT VERSION() AS v');
      version = rows?.[0]?.v || '';
    } finally { await conn.end(); }
  } else {
    const { default: pg } = await import('pg');
    const client = new pg.Client({ ...cfg, connectionTimeoutMillis: 5000 });
    await client.connect();
    try {
      // 达梦 PG 兼容模式可能无 version()，回退 v$version
      try {
        const r = await client.query('SELECT version() AS v');
        version = r.rows?.[0]?.v || '';
      } catch {
        try {
          const r = await client.query('SELECT * FROM v$version WHERE ROWNUM = 1');
          version = Object.values(r.rows?.[0] || {}).join(' ') || '';
        } catch { /* 版本探测两种都失败，下面明确报错 */ }
      }
    } finally { await client.end(); }
  }
  const driver = driverFromVersion(version);
  if (!driver) {
    throw new Error(
      `[db-detect] 无法从版本串识别数据库类型（协议推断=${protocol}）。原始版本串：${JSON.stringify(version)}。` +
      `请显式设置 DB_DRIVER（${ALL_DRIVERS.join(' / ')}），或补充 services/db-compat-check.js 的 VERSION_RULES。`
    );
  }
  return { driver, version, protocol, source: 'version()' };
}

/**
 * 解析最终驱动：显式配置优先；auto/留空则自动识别。
 * @returns {Promise<{driver:string, detected:boolean, info:object}>}
 */
export async function resolveDriver() {
  const configured = String(process.env.DB_DRIVER || 'auto').toLowerCase();
  if (configured && configured !== 'auto' && ALL_DRIVERS.includes(configured)) {
    return { driver: configured, detected: false, info: null };
  }
  const info = await detectDriver();
  const strict = String(process.env.DB_STRICT_DRIVER_MATCH || 'false').toLowerCase() === 'true';
  if (configured !== 'auto' && strict && configured !== info.driver) {
    throw new Error(`[db-detect] 配置 DB_DRIVER=${configured} 与实际数据库 ${info.driver} 不一致（严格模式）`);
  }
  return { driver: info.driver, detected: true, info };
}

/**
 * 启动自检：用兼容层跑冒烟 SQL。
 * @param {object} dataSource createDataSource() 返回的适配器
 * @param {string} driver 实际驱动
 * @param {(sql:string,params?:Array)=>object} transform 可选 SQL 转换函数（默认按 driver 自动选择）
 */
export async function runStartupCheck(dataSource, driver, transform) {
  const dialect = getDialect(driver);
  if (!dialect || !PG_DRIVERS.includes(driver)) {
    // MySQL 用原生驱动，无需方言自检
    if (driver === 'mysql') return { driver, checks: ['native-mysql'], ok: true };
    throw new Error(`[db-check] 驱动 ${driver} 无自检实现`);
  }
  // 默认转换器按 driver 同步转换；允许注入自定义转换器便于测试
  let defaultTransform = null;
  const tx = transform || ((sql, params = []) => {
    if (!defaultTransform) throw new Error('[db-check] 转换器未初始化');
    return defaultTransform(sql, params, driver);
  });
  const { transformSql } = await import('./pg-compat.js');
  defaultTransform = transformSql;
  const probes = [
    { name: 'connect', sql: 'SELECT 1 AS ok' },
    { name: 'version', sql: 'SELECT version() AS v' },
    { name: 'functions', sql: 'SELECT COALESCE(NULL, 1) AS x, current_database() AS db' },
    {
      name: 'upsert',
      sql: 'INSERT INTO app_configs (configKey, configValue, env) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE configValue=VALUES(configValue)',
      params: ['__compat_probe__', '1', 'probe'],
      // 探测写入：随后清理
      cleanup: "DELETE FROM app_configs WHERE configKey = '__compat_probe__' AND env = 'probe'",
    },
    { name: 'pagination', sql: 'SELECT 1 AS ok LIMIT ? OFFSET ?', params: [1, 0] },
  ];
  const results = [];
  for (const probe of probes) {
    const converted = await tx(probe.sql, probe.params || []);
    const text = converted.text;
    const values = converted.values || probe.params || [];
    try {
      await dataSource.execute(text, values);
      if (probe.cleanup) {
        const cleanupConverted = await tx(probe.cleanup, []);
        await dataSource.execute(cleanupConverted.text, []);
      }
      results.push({ name: probe.name, ok: true, sql: text });
    } catch (e) {
      throw new Error(
        `[db-check] 方言 ${dialect.name} 冒烟失败（${probe.name}）：${e.message}\n  探测 SQL：${text}\n` +
        `  原始 SQL：${probe.sql}\n  若是语法差异，请在 services/dialects.js / pg-compat.js 补充改写规则。`
      );
    }
  }
  return { driver, checks: results.map((r) => r.name), ok: true, details: results };
}

/**
 * 完整启动流程：解析驱动 → 自检。供 server.js 在 listen 前调用。
 * 自检失败默认只警告（避免开发期无 DB 时无法启动）；DB_STRICT_BOOT=true 时崩溃退出。
 */
export async function prepareDatabase(createDataSourceFn) {
  const skip = String(process.env.DB_SKIP_COMPAT_CHECK || 'false').toLowerCase() === 'true';
  const strictBoot = String(process.env.DB_STRICT_BOOT || 'false').toLowerCase() === 'true';
  let driver = String(process.env.DB_DRIVER || 'mysql').toLowerCase();
  let detected = false;
  let info = null;
  if (driver === 'auto' || !driver) {
    try {
      const resolved = await resolveDriver();
      driver = resolved.driver; detected = true; info = resolved.info;
      console.log(`[db-detect] 自动识别驱动=${driver} 版本=${info?.version || '?'}（未显式配置 DB_DRIVER）`);
    } catch (e) {
      if (strictBoot) throw e;
      console.warn(`[db-detect] 自动识别失败，回退 mysql：${e.message}`);
      driver = 'mysql';
    }
    process.env.DB_DRIVER = driver;
  }
  const dataSource = createDataSourceFn();
  if (skip) {
    console.warn('[db-check] 已跳过启动自检（DB_SKIP_COMPAT_CHECK=true）');
  } else {
    try {
      const check = await runStartupCheck(dataSource, driver);
      console.log(`[db-check] ${driver} 自检通过：${check.checks.join(', ')}`);
    } catch (e) {
      if (strictBoot) throw e;
      console.warn(`[db-check] 自检未通过（宽松模式，仅警告）：${e.message}`);
    }
  }
  return { dataSource, driver, detected, info };
}
