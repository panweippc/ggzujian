/**
 * 查询出口分级管控（数据安全 C2）
 *
 * 敏感查询/导出不再"谁登录谁随便导"：
 *   - 按敏感字段注册表自动判定风险（low / medium / high）
 *   - 达到阈值的导出必须先申请审批单，管理员 approve 后一次性使用
 *   - 每次导出强制审计留痕（用途、行数、审批人、申请单号）
 *   - 导出文件自动附「导出信息」sheet 水印，便于泄露溯源
 *
 * 策略：EXPORT_POLICY=low（全部审批）/ medium（PII 及以上，默认）/ high（仅高风险）
 */
import crypto from 'node:crypto';
import { riskLevelOf, RISK_RANK } from './sensitive-fields.js';

export const EXPORT_POLICY = String(process.env.EXPORT_POLICY || 'medium').toLowerCase();
export const EXPORT_MAX_ROWS = Math.max(1, +(process.env.EXPORT_MAX_ROWS || 10000));
export const APPROVAL_TTL_MS = Math.max(60_000, +(process.env.EXPORT_APPROVAL_TTL_MS || 30 * 60 * 1000));
const THRESHOLD = { low: 0, medium: 1, high: 2 };

/** 该风险等级是否需要审批 */
export function needsApproval(risk) {
  return RISK_RANK[risk] >= (THRESHOLD[EXPORT_POLICY] ?? 1);
}

/** 根据 schema 注册表判定导出风险（不依赖调用方自觉声明） */
export function classifySchema(schemaKey, schema) {
  const table = schema?.table || schemaKey;
  const fields = (schema?.fields || []).map((f) => f.key);
  return { table, fields, risk: riskLevelOf(table, fields) };
}

/** 申请单号：EXP + 时间戳 + 随机短码 */
export function makeRequestNo() {
  return `EXP${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

const usernameOf = (req) => req?.user?.name || req?.user?.username || '系统';
const nowStr = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

/** 创建导出申请；低风险自动放行（仍留审批单，便于统计与追溯） */
export async function createRequest(pool, req, { schemaKey, table, risk, reason, rowLimit }) {
  const no = makeRequestNo();
  const status = needsApproval(risk) ? 'pending' : 'approved';
  const now = nowStr();
  const expires = new Date(Date.now() + APPROVAL_TTL_MS).toISOString().slice(0, 19).replace('T', ' ');
  await pool.execute(
    `INSERT INTO data_export_approvals
     (requestNo,schemaKey,tableName,riskLevel,requestedBy,requestedAt,reason,rowLimit,status,approvedBy,approvedAt,expiresAt,createdAt,updatedAt)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [no, schemaKey, table, risk, usernameOf(req), now, String(reason || '').slice(0, 500),
     Math.min(+rowLimit || EXPORT_MAX_ROWS, EXPORT_MAX_ROWS), status,
     status === 'approved' ? 'auto' : null, status === 'approved' ? now : null, expires, now, now]
  );
  return { requestNo: no, status, risk, expiresAt: expires };
}

/** 审批单是否过期（兼容 mysql2 的 Date 与字符串两种形态） */
export function isExpired(row) {
  if (!row?.expiresAt) return false;
  let expires = row.expiresAt;
  if (!(expires instanceof Date)) {
    const s = String(expires).replace(' ', 'T');
    expires = new Date(s.endsWith('Z') ? s : `${s}Z`);
  }
  return expires.getTime() < Date.now();
}

/** 查询审批单（含过期判定） */
export async function getRequest(pool, no) {
  if (!/^EXP[0-9A-Z]{18,24}$/.test(String(no || ''))) return null;
  const [rows] = await pool.execute('SELECT * FROM data_export_approvals WHERE requestNo = ?', [no]);
  const row = rows[0];
  if (!row) return null;
  if (row.status === 'pending' && isExpired(row)) return { ...row, status: 'expired' };
  return row;
}

/** 审批：仅 pending 可改判；adminOnly 由路由保证 */
export async function decide(pool, req, no, decision, comment) {
  const row = await getRequest(pool, no);
  if (!row) return { ok: false, message: '审批单不存在' };
  if (row.status !== 'pending') return { ok: false, message: `审批单当前状态为 ${row.status}，不可重复审批` };
  const next = decision === 'approve' ? 'approved' : 'rejected';
  await pool.execute(
    'UPDATE data_export_approvals SET status=?, approvedBy=?, approvedAt=?, reason=CONCAT(?, ?, ?), updatedAt=? WHERE requestNo=? AND status=?',
    [next, usernameOf(req), nowStr(), String(row.reason || ''), ' | 审批意见:', String(comment || '').slice(0, 200), nowStr(), no, 'pending']
  );
  return { ok: true, status: next };
}

/**
 * 一次性消费审批单：UPDATE 带 status 条件保证并发下只有一个导出能成功。
 * 返回 true 表示消费成功。
 */
export async function consume(pool, no) {
  if (!no) return false;
  const [r] = await pool.execute(
    "UPDATE data_export_approvals SET status='used', updatedAt=? WHERE requestNo=? AND status='approved'",
    [nowStr(), no]
  );
  return r?.affectedRows > 0;
}

/**
 * 校验导出是否被允许。返回 { allowed, reason, request }。
 * 校验项：审批单存在 / 状态 / 申请人一致 / schemaKey 一致 / 未过期 / 行数上限。
 */
export async function checkExport(pool, req, { schemaKey, risk, requestNo, requestedRows }) {
  if (!needsApproval(risk)) {
    if (requestedRows > EXPORT_MAX_ROWS) {
      return { allowed: false, reason: `单次导出不得超过 ${EXPORT_MAX_ROWS} 行` };
    }
    return { allowed: true, request: null };
  }
  if (!requestNo) return { allowed: false, reason: '该导出涉及敏感字段，请先申请审批（POST /api/data-export/request）' };
  const item = await getRequest(pool, requestNo);
  if (!item) return { allowed: false, reason: '审批单不存在或编号不合法' };
  if (item.status !== 'approved') return { allowed: false, reason: `审批单状态为 ${item.status}，不可用于导出` };
  if (isExpired(item)) return { allowed: false, reason: '审批单已过期，请重新申请' };
  if (item.requestedBy !== usernameOf(req)) return { allowed: false, reason: '审批单申请人不一致' };
  if (item.schemaKey !== schemaKey) return { allowed: false, reason: '审批单与导出模板不匹配' };
  const limit = Math.min(+item.rowLimit || EXPORT_MAX_ROWS, EXPORT_MAX_ROWS);
  if (requestedRows > limit) return { allowed: false, reason: `超出审批单行数上限 ${limit} 行` };
  return { allowed: true, request: item };
}

/** 给导出的 xlsx 追加「导出信息」sheet 作为水印（不改数据 sheet 结构） */
export function stampWatermark(XLSX, buf, meta) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const rows = [
    ['项目', '内容'],
    ['导出人', meta.username || '系统'],
    ['导出时间', meta.time || nowStr()],
    ['数据范围', meta.schemaKey || '-'],
    ['风险等级', meta.risk || 'low'],
    ['导出用途', meta.reason || '（未填写）'],
    ['审批单号', meta.requestNo || '免审批（低风险）'],
    ['审批人', meta.approvedBy || '-'],
    ['导出行数', String(meta.rows ?? 0)],
    ['追溯提示', '本文件由系统自动加水印，请妥善保管，禁止外传'],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 16 }, { wch: 64 }];
  XLSX.utils.book_append_sheet(wb, ws, '导出信息');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
