/**
 * 查询出口分级管控路由（数据安全 C2）
 *
 * 常规导出：低风险可直接导；中/高风险必须申请 → 管理员审批 → 一次性导出。
 * 所有申请、审批、导出均写审计，导出文件自动加「导出信息」水印 sheet。
 */
import express from 'express';
import { adminOnly, isAdmin } from '../middleware/role.js';
import { writeAudit } from '../middleware/audit.js';
import { SCHEMAS } from './excel.js';
import {
  EXPORT_POLICY, EXPORT_MAX_ROWS, APPROVAL_TTL_MS,
  classifySchema, createRequest, getRequest, decide, needsApproval,
} from '../services/data-export-guard.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const usernameOf = (req) => req.user?.name || req.user?.username || '系统';

/** 策略与各模板风险等级（前端可据此提示"需审批"） */
router.get('/data-export/policy', async (req, res) => {
  const schemas = Object.entries(SCHEMAS).map(([key, schema]) => {
    const info = classifySchema(key, schema);
    return { key, title: schema.title, ...info, needsApproval: needsApproval(info.risk) };
  });
  res.json({
    success: true,
    data: { policy: EXPORT_POLICY, maxRows: EXPORT_MAX_ROWS, approvalTtlMs: APPROVAL_TTL_MS, schemas },
  });
});

/** 提交导出申请；低风险自动放行，仍落单便于统计 */
router.post('/data-export/request', async (req, res) => {
  const { schemaKey, reason, rowLimit } = req.body || {};
  const schema = SCHEMAS[schemaKey];
  if (!schema) return res.status(404).json({ success: false, message: '未注册的导出模板' });
  const info = classifySchema(schemaKey, schema);
  try {
    const result = await createRequest(poolOf(req), req, { ...info, reason, rowLimit });
    await writeAudit(poolOf(req), req, {
      action: 'export_request', module: 'data-export',
      targetName: schemaKey, detail: `导出申请 ${result.requestNo}，风险=${result.risk}，状态=${result.status}，用途=${String(reason || '').slice(0, 100)}`,
      ipAddress: req.ip,
    }).catch(() => {});
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: '申请失败：' + e.message });
  }
});

/** 审批单列表：管理员看全部，普通用户只看自己 */
router.get('/data-export/approvals', async (req, res) => {
  try {
    const pool = poolOf(req);
    let rows;
    if (isAdmin(req)) {
      [rows] = await pool.execute('SELECT * FROM data_export_approvals ORDER BY id DESC LIMIT 200');
    } else {
      [rows] = await pool.execute('SELECT * FROM data_export_approvals WHERE requestedBy = ? ORDER BY id DESC LIMIT 200', [usernameOf(req)]);
    }
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, message: '查询审批单失败：' + e.message });
  }
});

/** 管理员审批通过 / 驳回 */
router.post('/data-export/approvals/:no/:decision', adminOnly, async (req, res) => {
  const { no, decision } = req.params;
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ success: false, message: '审批动作只能是 approve 或 reject' });
  }
  try {
    const result = await decide(poolOf(req), req, no, decision, req.body?.comment);
    if (!result.ok) return res.status(409).json({ success: false, message: result.message });
    await writeAudit(poolOf(req), req, {
      action: decision === 'approve' ? 'export_approve' : 'export_reject', module: 'data-export',
      targetName: no, detail: `导出审批 ${no} → ${result.status}；意见=${String(req.body?.comment || '').slice(0, 100)}`,
      ipAddress: req.ip,
    }).catch(() => {});
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: '审批失败：' + e.message });
  }
});

/** 审批单详情 */
router.get('/data-export/approvals/:no', async (req, res) => {
  try {
    const item = await getRequest(poolOf(req), req.params.no);
    if (!item) return res.status(404).json({ success: false, message: '审批单不存在' });
    if (!isAdmin(req) && item.requestedBy !== usernameOf(req)) {
      return res.status(403).json({ success: false, message: '无权查看他人的审批单' });
    }
    res.json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ success: false, message: '查询失败：' + e.message });
  }
});

export default router;
