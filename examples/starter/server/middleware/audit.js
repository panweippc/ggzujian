/**
 * 增强版审计写入器（底座第 4 部分：全链路日志与审计）
 * 在公共包 createOperationLog 的固定字段之上，补写网关上下文：
 *   traceId / requestBody / responseResult / durationMs
 * 设计：不改公共包；完整 INSERT 失败（老库未迁移）时自动回退到标准字段写入。
 */
import { createOperationLog } from '@panweippc/auth-kit';

const STD_COLS = ['userId', 'username', 'action', 'module', 'targetId', 'targetName', 'detail', 'beforeValue', 'afterValue', 'ipAddress', 'createdAt'];
const RICH_COLS = [...STD_COLS.slice(0, -1), 'traceId', 'requestBody', 'responseResult', 'durationMs', 'createdAt'];

const serialize = (v) => {
  if (v === null || v === undefined) return null;
  try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
};

/**
 * 写一条带网关上下文的操作日志
 * @param {object} pool mysql2 连接池
 * @param {object} req  Express 请求（携带 traceId / _auditRequest / _auditResponse / _startAt）
 * @param {object} fields 标准审计字段（action/module/targetId/targetName/detail/beforeValue/afterValue...）
 */
export async function writeAudit(pool, req, fields = {}) {
  const elapsed = req?._startAt ? Math.round(Number(process.hrtime.bigint() - req._startAt) / 1e6) : 0;
  const std = {
    userId: fields.userId ?? req?.user?.id ?? '',
    username: fields.username ?? req?.user?.name ?? req?.user?.username ?? '系统',
    action: fields.action,
    module: fields.module,
    targetId: fields.targetId ?? null,
    targetName: fields.targetName ?? null,
    detail: fields.detail ?? null,
    ipAddress: fields.ipAddress ?? req?.ip ?? '',
  };
  const before = serialize(fields.beforeValue);
  const after = serialize(fields.afterValue);
  const traceId = fields.traceId ?? req?.traceId ?? null;
  const requestBody = fields.requestBody ?? req?._auditRequest ?? null;
  const responseResult = fields.responseResult ?? req?._auditResponse ?? null;
  const durationMs = fields.durationMs ?? elapsed;

  // 优先完整写入（新库）
  try {
    const vals = [
      std.userId, std.username, std.action, std.module, std.targetId, std.targetName,
      std.detail, before, after, std.ipAddress,
      traceId, requestBody, responseResult, durationMs,
    ];
    const [result] = await pool.execute(
      `INSERT INTO operation_logs (${RICH_COLS.join(', ')}) VALUES (${RICH_COLS.slice(0, -1).map(() => '?').join(', ')}, NOW())`,
      vals
    );
    // 记录 insertId，供响应生成后在 finish 阶段回填 responseResult / 准确耗时
    if (req && result?.insertId) {
      req._auditLogIds ||= [];
      req._auditLogIds.push(result.insertId);
    }
    return;
  } catch { /* 回退到标准写入 */ }

  // 降级：公共包标准字段（兼容未迁移的老库）
  await createOperationLog(pool, { ...std, beforeValue: fields.beforeValue, afterValue: fields.afterValue });
}
