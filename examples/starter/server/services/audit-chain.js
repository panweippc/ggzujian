/**
 * 审计日志哈希链（防篡改）
 * 每行 rowHash = SHA256(prevHash + action + username + detail + traceId + requestBody + createdAt)。
 * 校验时逐行重算，一旦发现不一致即判定该行及之后被篡改。
 */
import crypto from 'crypto';

// 串行化哈希写入，避免并发请求取到同一个 prevHash 导致链断裂
let chainTail = Promise.resolve();
export function withChainLock(task) {
  const result = chainTail.then(task, task);
  chainTail = result.catch(() => {});
  return result;
}

/** 把时间统一成 'YYYY-MM-DD HH:mm:ss'，杜绝 Date/字符串/ISO 三种格式导致的哈希漂移 */
function normTime(v) {
  if (!v) return '';
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  const s = String(v);
  // ISO: 2026-11-24T20:04:35.000Z → 2026-11-24 20:04:35（按本地时区写入时的墙上时间）
  const m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : s.slice(0, 19);
}

/** 计算某行的哈希 */
export function rowHashOf(prevHash, row) {
  const base = [
    prevHash || '', row.action ?? '', row.username ?? '', row.detail ?? '',
    row.traceId ?? '', row.requestBody ?? '', normTime(row.createdAt),
  ].join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}

/** 取表中最后一行的哈希（作为链头） */
export async function lastHash(pool, table = 'operation_logs') {
  const [rows] = await pool.execute(
    `SELECT rowHash FROM ${table} WHERE rowHash IS NOT NULL ORDER BY id DESC LIMIT 1`
  );
  return rows[0]?.rowHash || '';
}

/** 校验整表哈希链完整性，返回首个异常行 id 或 null */
export async function verifyChain(pool, table = 'operation_logs') {
  const [rows] = await pool.execute(
    `SELECT id, action, username, detail, traceId, requestBody, createdAt, rowHash
     FROM ${table} WHERE rowHash IS NOT NULL ORDER BY id ASC`
  );
  let prev = '';
  for (const row of rows) {
    const expect = rowHashOf(prev, row);
    if (expect !== row.rowHash) return { ok: false, brokenAt: row.id };
    prev = row.rowHash;
  }
  return { ok: true, checked: rows.length };
}
