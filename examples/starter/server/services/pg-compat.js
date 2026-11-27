/**
 * PostgreSQL 协议栈兼容层（含国产库 PG 兼容模式）
 *
 * 把 pg.Pool 包装成 mysql2/promise 的调用形态，使现有路由零改动可用：
 *   - `identifier` → "identifier"，? → $N（跳过字符串字面量）
 *   - DATABASE() → current_database()、IFNULL() → COALESCE()
 *   - INSERT IGNORE → ON CONFLICT DO NOTHING
 *   - ON DUPLICATE KEY UPDATE → ON CONFLICT (唯一键) DO UPDATE SET …=EXCLUDED.…
 *   - GROUP_CONCAT() → STRING_AGG()/LISTAGG()（按方言）
 *   - INSERT 自动补 RETURNING * 以提取 insertId
 *
 * 方言按驱动分发（postgres/kingbase/opengauss/dameng 各有差异，见 dialects.js）。
 * 无法安全改写的 MySQL 专有语法（SHOW / STRAIGHT_JOIN 等）仍然明确拒绝，
 * 不静默产出错误结果。
 */
import { getDialect, upsertKeysFor, PG_DRIVERS } from './dialects.js';

export { PG_DRIVERS };

/** 确实无法安全改写的语法（已可改写的 ON DUPLICATE/INSERT IGNORE/GROUP_CONCAT 不在此列） */
const MYSQL_ONLY = /\b(SHOW\s+(?:CREATE\s+TABLE|TABLES|DATABASES|COLUMNS)|STRAIGHT_JOIN|SQL_CALC_FOUND_ROWS|REPLACE\s+INTO)\b/i;

/**
 * PG 标识符策略：统一用小写裸标识符。
 * PG 会把裸标识符折叠为小写，DDL 生成器也按小写建列，二者天然匹配；
 * 若用双引号包裹 camelCase，反而会因大小写不一致导致"列不存在"。
 */
const q = (col, _dialect) => String(col).trim().replace(/^["`]|["`]$/g, '').toLowerCase();

/**
 * 改写 SET 子句：VALUES(col) → EXCLUDED."col"，并给赋值目标列加引号。
 * 例：label=VALUES(label), version=version+1 → "label"=EXCLUDED."label", "version"=version+1
 */
function rewriteSetClause(clause, dialect) {
  const qc = (col) => q(col, dialect);
  let s = clause.replace(/\bVALUES\s*\(\s*(["`]?)([A-Za-z_]\w*)\1\s*\)/gi, (_, _q, col) => `EXCLUDED.${qc(col)}`);
  // 给赋值目标（逗号后或开头的裸标识符且其后紧跟 =）加引号
  let out = '';
  let expectColumn = true;
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (ch === ',') { expectColumn = true; out += ch; i += 1; continue; }
    if (/\s/.test(ch)) { out += ch; i += 1; continue; }
    if (expectColumn && /[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      const ident = s.slice(i, j);
      let k = j;
      while (k < s.length && /\s/.test(s[k])) k += 1;
      out += s[k] === '=' ? qc(ident) : s.slice(i, j);
      i = j;
      expectColumn = false;
      continue;
    }
    out += ch;
    expectColumn = false;
    i += 1;
  }
  return out;
}

/** ON DUPLICATE KEY UPDATE → ON CONFLICT (唯一键) DO UPDATE SET … */
function rewriteOnDuplicate(sql, dialect) {
  const m = sql.match(/\bON\s+DUPLICATE\s+KEY\s+UPDATE\s+([\s\S]+)$/i);
  if (!m) return null;
  const tm = sql.match(/^\s*INSERT\s+INTO\s+(?:["`]?)([\w.]+)/i);
  const table = tm ? tm[1].split('.').pop().replace(/["`]/g, '') : '';
  const keys = upsertKeysFor(table);
  if (!keys || !keys.length) {
    throw new Error(
      `PostgreSQL 适配器无法自动改写表 ${table} 的 ON DUPLICATE KEY UPDATE：` +
      `缺少唯一键登记。请在 services/dialects.js 的 UPSERT_KEYS 中补充 ${table}: ['唯一键列']`
    );
  }
  const head = sql.slice(0, m.index).replace(/;+\s*$/, '').replace(/\s+$/, '');
  const conflict = keys.map((c) => q(c, dialect)).join(', ');
  const set = rewriteSetClause(m[1], dialect);
  return `${head} ON CONFLICT (${conflict}) DO UPDATE SET ${set}`;
}

/**
 * SQL 方言转换 + 占位符重写。
 * @param {string} sql
 * @param {Array} params
 * @param {string} driver 目标驱动（默认 postgres）；决定 upsert/concat 等改写策略
 */
export function transformSql(sql, params = [], driver = 'postgres') {
  const src = String(sql || '');
  const dialect = getDialect(driver) || getDialect('postgres');
  let out = '';
  let quote = null;
  let idx = 0;
  for (let i = 0; i < src.length;) {
    const ch = src[i];
    if (quote) {
      if (ch === '\\' && i + 1 < src.length) { out += src[i] + src[i + 1]; i += 2; continue; }
      let closed = false;
      if (ch === quote) {
        if (quote === "'" && src[i + 1] === "'") { out += "''"; i += 2; continue; }
        closed = true;
      }
      out += quote === '`' && ch === '`' ? '"' : ch;
      if (closed) quote = null;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch === '`' ? '"' : ch;
      i += 1;
      continue;
    }
    if (ch === '?') { idx += 1; out += `$${idx}`; i += 1; continue; }
    out += ch;
    i += 1;
  }

  // 通用兼容函数
  out = out.replace(/\bDATABASE\s*\(\s*\)/gi, 'current_database()')
           .replace(/\bIFNULL\s*\(/gi, 'COALESCE(');

  // INSERT IGNORE → 标记后改写成 ON CONFLICT DO NOTHING
  let ignoreInsert = false;
  if (/\bINSERT\s+IGNORE\s+INTO\b/i.test(out)) {
    ignoreInsert = true;
    out = out.replace(/\bINSERT\s+IGNORE\s+INTO\b/i, 'INSERT INTO');
  }

  // ON DUPLICATE KEY UPDATE → ON CONFLICT … DO UPDATE …
  let dupRewritten = false;
  if (/\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(out)) {
    const rewritten = rewriteOnDuplicate(out, dialect);
    if (rewritten) { out = rewritten; dupRewritten = true; }
  }

  // GROUP_CONCAT(expr) → 方言等价聚合
  out = out.replace(/\bGROUP_CONCAT\s*\(\s*([\s\S]*?)\s*\)/gi, (_, expr) => dialect.concat(expr));

  // 仍无法安全改写的语法：明确拒绝
  const unsupported = src.match(MYSQL_ONLY);
  if (unsupported) {
    throw new Error(`PostgreSQL 适配器不支持 MySQL 专有语法「${unsupported[1]}」，请改为方言安全写法`);
  }

  // INSERT IGNORE（未走 ON CONFLICT）补 DO NOTHING
  if (ignoreInsert && !dupRewritten && !/\bON\s+CONFLICT\b/i.test(out)) {
    out = `${out.replace(/;+\s*$/, '')} ON CONFLICT DO NOTHING`;
  }

  // INSERT 补 RETURNING *，供上层读取 insertId
  if (/^\s*INSERT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) {
    out = `${out.replace(/;+\s*$/, '')} RETURNING *`;
  }

  return { text: out, values: params, placeholders: idx, driver: dialect.name };
}

/** mysql2 conn.escape 的 PG 等价实现（备份 SQL 生成用） */
export function escapePg(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Buffer.isBuffer(v)) return `decode('${v.toString('hex')}', 'hex')`;
  return `'${String(v).replace(/'/g, "''")}'`;
}

/** @param {import('pg').Pool} pgPool @param {{driver?: string}} options */
export function createPgCompatPool(pgPool, options = {}) {
  const driver = options.driver || 'postgres';

  async function run(sql, params = [], client) {
    const { text, values } = transformSql(sql, params, driver);
    const result = await (client || pgPool).query(text, values);
    if (/^\s*INSERT\b/i.test(text)) {
      const first = result.rows?.[0] || {};
      return [{
        insertId: first.id ?? first.insertId ?? null,
        affectedRows: result.rowCount ?? result.rows?.length ?? 0,
      }, undefined];
    }
    return [result.rows || [], { rowCount: result.rowCount ?? result.rows?.length ?? 0, fields: result.fields }];
  }

  return {
    driver,
    __pg: true,
    query: (sql, params, client) => run(sql, params, client),
    execute: (sql, params, client) => run(sql, params, client),
    raw: pgPool,
    escape: escapePg,
    ping: async () => {
      const r = await pgPool.query('SELECT 1 AS ok');
      return r.rows?.[0]?.ok === 1 || r.rows?.[0]?.ok === true;
    },
    async getConnection() {
      const client = await pgPool.connect();
      return {
        query: (sql, params) => run(sql, params, client),
        execute: (sql, params) => run(sql, params, client),
        escape: escapePg,
        beginTransaction: async () => { await client.query('BEGIN'); },
        commit: async () => { await client.query('COMMIT'); },
        rollback: async () => { await client.query('ROLLBACK'); },
        release: () => client.release(),
        raw: client,
      };
    },
    async transaction(handler) {
      const client = await pgPool.connect();
      try {
        await client.query('BEGIN');
        const result = await handler({
          query: (sql, params) => run(sql, params, client),
          execute: (sql, params) => run(sql, params, client),
        });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async end() { await pgPool.end(); },
  };
}

export default createPgCompatPool;
