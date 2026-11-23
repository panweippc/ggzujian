/**
 * 通用审计日志工具（pool 依赖注入，无业务耦合）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. 表名与字段映射可配置——不同项目操作日志表结构不同（qygl: operation_logs；
 *     wygl: sys_operation_log 或 operation_logs），通过 createAudit(config) 注入。
 *  2. createNotification 属于 OA 业务（notifications 表），不放入通用包，留在业务项目。
 */

/**
 * @param {object} config
 * @param {string} [config.table='operation_logs'] 日志表名
 * @param {object} [config.columns] 列名映射，默认与 qygl/wygl 通用命名一致
 * @param {function} [config.onError] 自定义错误回调，默认 console.error
 */
export function createAudit(config = {}) {
  const table = config.table ?? 'operation_logs';
  const C = {
    userId: 'userId', username: 'username', action: 'action', module: 'module',
    targetId: 'targetId', targetName: 'targetName', detail: 'detail',
    beforeValue: 'beforeValue', afterValue: 'afterValue', ipAddress: 'ipAddress',
    createdAt: 'createdAt',
    ...(config.columns || {})
  };
  const onError = config.onError ?? ((msg, e) => console.error(msg, e?.message));
  const cols = [C.userId, C.username, C.action, C.module, C.targetId, C.targetName,
    C.detail, C.beforeValue, C.afterValue, C.ipAddress, C.createdAt];
  // createdAt 放最后一列，用 NOW() 填；其余列用占位符，确保列与值一一对齐
  // （旧实现把 NOW() 放到第一个占位，导致 11 列整体错位一行）
  const valueCols = cols.slice(0, -1);
  const valueCount = valueCols.length;
  const insertSql = `INSERT INTO \`${table}\` (${cols.join(', ')}) VALUES (${valueCols.map(() => '?').join(', ')}, NOW())`;

  const serialize = (v) => {
    if (v === null || v === undefined) return null;
    try { return typeof v === 'string' ? v : JSON.stringify(v); } catch { return String(v); }
  };

  /** 写一条操作日志（失败不抛异常，仅回调 onError） */
  async function log(pool, {
    userId, username, action, module, targetId = null, targetName = null,
    detail = null, ipAddress = null, beforeValue = null, afterValue = null
  } = {}) {
    try {
      const values = [
        userId || '', username || '', action, module, targetId, targetName,
        detail, serialize(beforeValue), serialize(afterValue), ipAddress || ''
      ].slice(0, valueCount);
      await pool.execute(insertSql, values);
    } catch (e) {
      onError('创建操作日志失败:', e);
    }
  }

  /** 兼容原名的别名 */
  const createOperationLog = log;

  /** 获取真实操作人：优先登录态，退回请求体/查询参数 */
  function getOperator(req) {
    const fromUser = req?.user?.name || req?.user?.username;
    if (fromUser) return fromUser;
    const fallback = req?.body?.operator || req?.query?.operator ||
      req?.body?.username || req?.body?.applicant || req?.query?.username;
    return fallback || '系统';
  }

  /** 更新前取旧值快照 */
  async function getRecordBefore(pool, targetTable, id, fields) {
    try {
      if (!pool || !targetTable || id === undefined || id === null) return null;
      const [rows] = await pool.execute(`SELECT * FROM \`${targetTable}\` WHERE id = ?`, [id]);
      if (!rows.length) return null;
      const row = rows[0];
      if (!fields) return { ...row };
      const out = {};
      Object.keys(fields).forEach(k => { if (k in row) out[k] = row[k]; });
      return out;
    } catch (e) {
      onError('获取变更前记录失败:', e);
      return null;
    }
  }

  /** 数据变更审计（before/after 对比） */
  async function logDataChange(pool, {
    module, action = 'update', username, targetId, targetName,
    beforeValue, afterValue, ipAddress
  } = {}) {
    await log(pool, {
      userId: null,
      username: username || '系统',
      action,
      module,
      targetId,
      targetName: targetName || '',
      detail: `数据变更: ${targetName || module} (ID: ${targetId})`,
      ipAddress: ipAddress || '',
      beforeValue,
      afterValue: afterValue || null
    });
  }

  /** 清理过期日志 */
  async function cleanupOldLogs(pool, days = 90) {
    try {
      const [r] = await pool.execute(
        `DELETE FROM \`${table}\` WHERE \`${C.createdAt}\` < DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]
      );
      return r.affectedRows;
    } catch (e) {
      onError('清理操作日志失败:', e);
      return 0;
    }
  }

  return { log, createOperationLog, getOperator, getRecordBefore, logDataChange, cleanupOldLogs, table, columns: C };
}

/** 默认实例：直接对应 qygl 的 operation_logs 表结构 */
export const audit = createAudit();
export const createOperationLog = audit.createOperationLog;
export const getOperator = audit.getOperator;
export const getRecordBefore = audit.getRecordBefore;
export const logDataChange = audit.logDataChange;
export const cleanupOldLogs = audit.cleanupOldLogs;

export default { createAudit, audit, createOperationLog, getOperator, getRecordBefore, logDataChange, cleanupOldLogs };
