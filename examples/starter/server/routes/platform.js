/**
 * 平台化能力路由（业务流程 / 多租户 / 合规 / 数据集成）
 * 全部基于本地实现，不依赖外部服务。
 */
import express from 'express';
import crypto from 'node:crypto';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';
import { createSecrets } from '../services/platform.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const operatorOf = (req) => getOperator(req) || 'system';
const secrets = createSecrets();

// mysql2 会把 JSON 列自动反序列化为对象/数组，只在实际是字符串时再 parse
const jsonParse = (v, fallback) => { if (v == null) return fallback; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return fallback; } };
const ok = (res, data, extra = {}) => res.json({ success: true, data, ...extra });
const err = (res, code, msg) => res.status(code).json({ success: false, message: msg });

/* ==================== 1. 工作流引擎 ==================== */
// 流程定义 CRUD
router.get('/workflows', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM workflow_definitions ORDER BY id'); ok(res, rows.map((r) => ({ ...r, nodes: jsonParse(r.nodes, []), edges: jsonParse(r.edges, []) }))); }
  catch { err(res, 500, '读取流程定义失败'); }
});
router.post('/workflows', async (req, res) => {
  const { code, name, description = '', nodes = [], edges = [] } = req.body || {};
  if (!code || !name || !Array.isArray(nodes)) return err(res, 400, '编码/名称/节点必填');
  try {
    const [r] = await poolOf(req).execute(
      'INSERT INTO workflow_definitions (code,name,description,nodes,edges,createdBy) VALUES (?,?,?,?,?,?)',
      [code, name, description, JSON.stringify(nodes), JSON.stringify(edges), operatorOf(req)]
    );
    await writeAudit(poolOf(req), req, { action: 'create', module: 'workflow', targetName: name, detail: `创建流程 ${code}` });
    ok(res, { id: r.insertId });
  } catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '流程编码已存在' : '创建失败'); }
});
router.put('/workflows/:id', async (req, res) => {
  const { name, description = '', nodes = [], edges = [], status = 1 } = req.body || {};
  try {
    await poolOf(req).execute(
      'UPDATE workflow_definitions SET name=?,description=?,nodes=?,edges=?,status=?,version=version+1 WHERE id=?',
      [name, description, JSON.stringify(nodes), JSON.stringify(edges), status, req.params.id]
    );
    await writeAudit(poolOf(req), req, { action: 'update', module: 'workflow', targetId: req.params.id, detail: `更新流程 ${name || req.params.id}` });
    ok(res, { updated: true });
  } catch { err(res, 500, '更新失败'); }
});
router.delete('/workflows/:id', async (req, res) => {
  try { await poolOf(req).execute('DELETE FROM workflow_definitions WHERE id=?', [req.params.id]); await writeAudit(poolOf(req), req, { action: 'delete', module: 'workflow', targetId: req.params.id }); ok(res, { deleted: true }); }
  catch { err(res, 500, '删除失败'); }
});

// 发起流程实例：按 nodes 顺序生成待办任务，approve 节点 assignee 取 approvers 或发起人上级(简化取 admin)
router.post('/workflows/:code/start', async (req, res) => {
  const { title, formData = {}, businessKey = null } = req.body || {};
  const pool = poolOf(req);
  try {
    const [[def]] = await pool.execute('SELECT * FROM workflow_definitions WHERE code=? AND status=1', [req.params.code]);
    if (!def) return err(res, 404, '流程不存在或已停用');
    const nodes = jsonParse(def.nodes, []);
    const approveNodes = nodes.filter((n) => n.type === 'approve');
    const [r] = await pool.execute(
      'INSERT INTO workflow_instances (defCode,title,initiator,businessKey,formData,currentNode,status) VALUES (?,?,?,?,?,?,?)',
      [req.params.code, title || `${def.name}-${Date.now()}`, operatorOf(req), businessKey, JSON.stringify(formData), approveNodes[0]?.id || 'end', 'running']
    );
    const instId = r.insertId;
    for (const n of approveNodes) {
      const assignees = Array.isArray(n.approvers) && n.approvers.length ? n.approvers : ['admin'];
      for (const a of assignees) await pool.execute('INSERT INTO workflow_tasks (instanceId,nodeId,assignee) VALUES (?,?,?)', [instId, n.id, a]);
    }
    await writeAudit(pool, req, { action: 'submit', module: 'workflow', targetName: title, detail: `发起流程 ${req.params.code}` });
    ok(res, { instanceId: instId, currentNode: approveNodes[0]?.id || 'end' });
  } catch (e) { err(res, 500, '发起失败：' + e.message); }
});

// 我的待办
router.get('/workflows/tasks/mine', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute(
      `SELECT t.*, i.title, i.initiator, i.defCode, i.formData
       FROM workflow_tasks t JOIN workflow_instances i ON t.instanceId=i.id
       WHERE t.assignee=? AND t.status='pending' ORDER BY t.id DESC`, [operatorOf(req)]);
    ok(res, rows.map((r) => ({ ...r, formData: jsonParse(r.formData, {}) })));
  } catch { err(res, 500, '读取待办失败'); }
});

// 审批（通过/驳回）——推进实例到下一节点
router.post('/workflows/tasks/:id/handle', async (req, res) => {
  const { decision = 'approve', comment = '' } = req.body || {};
  const pool = poolOf(req);
  try {
    const [[task]] = await pool.execute('SELECT * FROM workflow_tasks WHERE id=?', [req.params.id]);
    if (!task || task.status !== 'pending') return err(res, 404, '待办不存在或已处理');
    if (task.assignee !== operatorOf(req)) return err(res, 403, '非当前处理人');
    await pool.execute('UPDATE workflow_tasks SET status=?,comment=?,handledAt=NOW() WHERE id=?', [decision === 'approve' ? 'approved' : 'rejected', comment, req.params.id]);
    const [[inst]] = await pool.execute('SELECT * FROM workflow_instances WHERE id=?', [task.instanceId]);
    if (decision !== 'approve') {
      await pool.execute("UPDATE workflow_instances SET status='rejected',endedAt=NOW() WHERE id=?", [task.instanceId]);
    } else {
      const [[next]] = await pool.execute("SELECT id FROM workflow_tasks WHERE instanceId=? AND status='pending' ORDER BY id LIMIT 1", [task.instanceId]);
      if (next) await pool.execute('UPDATE workflow_instances SET currentNode=? WHERE id=?', [next.nodeId, task.instanceId]);
      else await pool.execute("UPDATE workflow_instances SET status='approved',currentNode='end',endedAt=NOW() WHERE id=?", [task.instanceId]);
    }
    await writeAudit(pool, req, { action: decision === 'approve' ? 'approve' : 'reject', module: 'workflow', targetId: task.instanceId, detail: `审批 ${decision}：${inst?.title || ''}` });
    ok(res, { handled: true, decision });
  } catch { err(res, 500, '审批失败'); }
});

// 我发起的 + 流程实例详情
router.get('/workflows/instances', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT id,defCode,title,initiator,status,currentNode,startedAt,endedAt FROM workflow_instances WHERE initiator=? ORDER BY id DESC', [operatorOf(req)]);
    ok(res, rows);
  } catch { err(res, 500, '读取实例失败'); }
});
router.get('/workflows/instances/:id', async (req, res) => {
  try {
    const [[inst]] = await poolOf(req).execute('SELECT * FROM workflow_instances WHERE id=?', [req.params.id]);
    if (!inst) return err(res, 404, '实例不存在');
    const [tasks] = await poolOf(req).execute('SELECT * FROM workflow_tasks WHERE instanceId=? ORDER BY id', [req.params.id]);
    ok(res, { ...inst, formData: jsonParse(inst.formData, {}), tasks });
  } catch { err(res, 500, '读取详情失败'); }
});

/* ==================== 2. 表单设计器 ==================== */
router.get('/form-schemas', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM form_schemas ORDER BY id'); ok(res, rows.map((r) => ({ ...r, schemaData: jsonParse(r.schemaData, []) }))); }
  catch { err(res, 500, '读取表单失败'); }
});
router.post('/form-schemas', async (req, res) => {
  const { code, name, schemaData = [] } = req.body || {};
  if (!code || !name) return err(res, 400, '编码/名称必填');
  try { const [r] = await poolOf(req).execute('INSERT INTO form_schemas (code,name,schemaData) VALUES (?,?,?)', [code, name, JSON.stringify(schemaData)]); ok(res, { id: r.insertId }); }
  catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '编码已存在' : '创建失败'); }
});
router.put('/form-schemas/:id', async (req, res) => {
  const { name, schemaData = [], status = 1 } = req.body || {};
  try { await poolOf(req).execute('UPDATE form_schemas SET name=?,schemaData=?,status=? WHERE id=?', [name, JSON.stringify(schemaData), status, req.params.id]); ok(res, { updated: true }); }
  catch { err(res, 500, '更新失败'); }
});
router.delete('/form-schemas/:id', async (req, res) => {
  try { await poolOf(req).execute('DELETE FROM form_schemas WHERE id=?', [req.params.id]); ok(res, { deleted: true }); }
  catch { err(res, 500, '删除失败'); }
});

/* ==================== 3. 报表 / BI ==================== */
router.get('/reports', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM report_definitions ORDER BY id'); ok(res, rows); }
  catch { err(res, 500, '读取报表定义失败'); }
});
// 只读 SQL 校验：必须是单条 SELECT，禁止分号后还有语句、禁止危险关键字
function assertReadOnly(sql) {
  const s = String(sql || '').trim();
  if (!/^select\s/i.test(s)) throw new Error('报表 SQL 必须以 SELECT 开头');
  if (s.includes(';')) throw new Error('报表 SQL 不允许包含分号或多语句');
  if (/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|into\s+outfile|load_file)\b/i.test(s)) throw new Error('报表 SQL 含禁止的关键字');
  return s;
}
router.post('/reports', async (req, res) => {
  const { code, name, type = 'chart', chartType = 'bar', sqlTemplate, description = '' } = req.body || {};
  if (!code || !name || !sqlTemplate) return err(res, 400, '编码/名称/SQL 必填');
  try { assertReadOnly(sqlTemplate); } catch (e) { return err(res, 400, e.message); }
  try { const [r] = await poolOf(req).execute('INSERT INTO report_definitions (code,name,type,chartType,sqlTemplate,description) VALUES (?,?,?,?,?,?)', [code, name, type, chartType, sqlTemplate, description]); ok(res, { id: r.insertId }); }
  catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '编码已存在' : '创建失败'); }
});
router.get('/reports/:code/data', async (req, res) => {
  try {
    const [[def]] = await poolOf(req).execute('SELECT * FROM report_definitions WHERE code=?', [req.params.code]);
    if (!def) return err(res, 404, '报表不存在');
    const sql = assertReadOnly(def.sqlTemplate);
    const [rows] = await poolOf(req).execute(sql);
    ok(res, { chartType: def.chartType, columns: rows.length ? Object.keys(rows[0]) : [], rows });
  } catch (e) { err(res, 400, e.message || '查询失败'); }
});

/* ==================== 4. 多租户 / 套餐 ==================== */
router.get('/tenants', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT t.*, p.name planName FROM tenants t LEFT JOIN plans p ON t.planId=p.id ORDER BY t.id'); ok(res, rows.map((r) => ({ ...r, config: jsonParse(r.config, {}) }))); }
  catch { err(res, 500, '读取租户失败'); }
});
router.post('/tenants', async (req, res) => {
  const { code, name, planId = null, config = {} } = req.body || {};
  if (!code || !name) return err(res, 400, '编码/名称必填');
  try { const [r] = await poolOf(req).execute('INSERT INTO tenants (code,name,planId,config) VALUES (?,?,?,?)', [code, name, planId, JSON.stringify(config)]); ok(res, { id: r.insertId }); }
  catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '编码已存在' : '创建失败'); }
});
router.put('/tenants/:id', async (req, res) => {
  const { name, planId, config = {}, status = 1 } = req.body || {};
  try { await poolOf(req).execute('UPDATE tenants SET name=?,planId=?,config=?,status=? WHERE id=?', [name, planId, JSON.stringify(config), status, req.params.id]); ok(res, { updated: true }); }
  catch { err(res, 500, '更新失败'); }
});
router.get('/plans', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM plans ORDER BY id'); ok(res, rows.map((r) => ({ ...r, limits: jsonParse(r.limits, {}) }))); }
  catch { err(res, 500, '读取套餐失败'); }
});
router.post('/plans', async (req, res) => {
  const { code, name, limits = {}, price = 0 } = req.body || {};
  if (!code || !name) return err(res, 400, '编码/名称必填');
  try { const [r] = await poolOf(req).execute('INSERT INTO plans (code,name,limits,price) VALUES (?,?,?,?)', [code, name, JSON.stringify(limits), price]); ok(res, { id: r.insertId }); }
  catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '编码已存在' : '创建失败'); }
});
// 配额校验示例：租户用户数是否超额
router.get('/tenants/:code/quota', async (req, res) => {
  try {
    const [[row]] = await poolOf(req).execute('SELECT p.limits FROM tenants t LEFT JOIN plans p ON t.planId=p.id WHERE t.code=?', [req.params.code]);
    const limits = jsonParse(row?.limits, {});
    const [[{ cnt }]] = await poolOf(req).execute('SELECT COUNT(*) cnt FROM user_tenants ut JOIN tenants t ON ut.tenantId=t.id WHERE t.code=?', [req.params.code]);
    ok(res, { used: cnt, max: limits.maxUsers ?? null, exceeded: limits.maxUsers != null && cnt > limits.maxUsers, limits });
  } catch { err(res, 500, '配额检查失败'); }
});

/* ==================== 5. 安全合规：数据分级 / 委托 ==================== */
router.get('/classifications', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM data_classification ORDER BY tableName,columnName'); ok(res, rows); }
  catch { err(res, 500, '读取分级策略失败'); }
});
router.post('/classifications', async (req, res) => {
  const { tableName, columnName, level = 'internal', maskRule = null, encrypt = 0 } = req.body || {};
  if (!tableName || !columnName) return err(res, 400, '表名/列名必填');
  try { await poolOf(req).execute('INSERT INTO data_classification (tableName,columnName,level,maskRule,encrypt) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE level=VALUES(level),maskRule=VALUES(maskRule),encrypt=VALUES(encrypt)', [tableName, columnName, level, maskRule, encrypt]); ok(res, { saved: true }); }
  catch { err(res, 500, '保存失败'); }
});
// 字段值加密/解密演示（走 platform 适配器，本地 AES / KMS 预留）
router.post('/classifications/encrypt', async (req, res) => {
  const { value } = req.body || {};
  try { ok(res, { cipher: secrets.encrypt(value ?? ''), kind: secrets.kind }); }
  catch (e) { err(res, 400, e.message); }
});
router.post('/classifications/decrypt', async (req, res) => {
  const { cipher } = req.body || {};
  try { ok(res, { value: secrets.decrypt(cipher), kind: secrets.kind }); }
  catch (e) { err(res, 400, e.message); }
});
// 委托授权
router.get('/delegations', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM delegations ORDER BY id DESC'); ok(res, rows); }
  catch { err(res, 500, '读取委托失败'); }
});
router.post('/delegations', async (req, res) => {
  const { fromUser, toUser, reason = '', startTime, endTime } = req.body || {};
  if (!fromUser || !toUser || !startTime || !endTime) return err(res, 400, '委托人/受托人/起止时间必填');
  try { const [r] = await poolOf(req).execute('INSERT INTO delegations (fromUser,toUser,reason,startTime,endTime) VALUES (?,?,?,?,?)', [fromUser, toUser, reason, startTime, endTime]); ok(res, { id: r.insertId }); }
  catch { err(res, 500, '创建失败'); }
});
router.delete('/delegations/:id', async (req, res) => {
  try { await poolOf(req).execute('DELETE FROM delegations WHERE id=?', [req.params.id]); ok(res, { deleted: true }); }
  catch { err(res, 500, '删除失败'); }
});

/* ==================== 6. 事件订阅 / Webhook ==================== */
router.get('/event-subscriptions', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT id,eventKey,targetUrl,enabled,lastTriggerAt,createdAt FROM event_subscriptions ORDER BY id'); ok(res, rows); }
  catch { err(res, 500, '读取订阅失败'); }
});
router.post('/event-subscriptions', async (req, res) => {
  const { eventKey, targetUrl, secret = '', enabled = 1 } = req.body || {};
  if (!eventKey || !targetUrl) return err(res, 400, '事件/地址必填');
  try {
    const [r] = await poolOf(req).execute('INSERT INTO event_subscriptions (eventKey,targetUrl,secret,enabled) VALUES (?,?,?,?)', [eventKey, targetUrl, secret ? secrets.encrypt(secret) : null, enabled]);
    ok(res, { id: r.insertId });
  } catch { err(res, 500, '创建失败'); }
});
router.delete('/event-subscriptions/:id', async (req, res) => {
  try { await poolOf(req).execute('DELETE FROM event_subscriptions WHERE id=?', [req.params.id]); ok(res, { deleted: true }); }
  catch { err(res, 500, '删除失败'); }
});
// 手动触发订阅回调（Webhook 签名演示，HMAC-SHA256）
router.post('/event-subscriptions/:id/test', async (req, res) => {
  try {
    const [[sub]] = await poolOf(req).execute('SELECT * FROM event_subscriptions WHERE id=?', [req.params.id]);
    if (!sub) return err(res, 404, '订阅不存在');
    const payload = JSON.stringify({ event: sub.eventKey, test: true, at: new Date().toISOString() });
    const secret = sub.secret ? secrets.decrypt(sub.secret) : '';
    const signature = crypto.createHmac('sha256', secret || 'test').update(payload).digest('hex');
    // 不实际外发（骨架无外部资源），返回将发送的请求供验证
    ok(res, { wouldPost: sub.targetUrl, payload, headers: { 'X-Event': sub.eventKey, 'X-Signature': `sha256=${signature}` }, note: '骨架演示：未实际外发，接入外部资源后由事件总线投递' });
  } catch (e) { err(res, 500, e.message); }
});

/* ==================== 7. ETL 数据同步 ==================== */
router.get('/etl', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT * FROM etl_pipelines ORDER BY id'); ok(res, rows.map((r) => ({ ...r, sourceConfig: jsonParse(r.sourceConfig, {}), fieldMap: jsonParse(r.fieldMap, {}) }))); }
  catch { err(res, 500, '读取ETL失败'); }
});
router.post('/etl', async (req, res) => {
  const { code, name, sourceType = 'mysql', sourceConfig = {}, targetTable, fieldMap = {}, cron = null } = req.body || {};
  if (!code || !name || !targetTable) return err(res, 400, '编码/名称/目标表必填');
  try { const [r] = await poolOf(req).execute('INSERT INTO etl_pipelines (code,name,sourceType,sourceConfig,targetTable,fieldMap,cron) VALUES (?,?,?,?,?,?,?)', [code, name, sourceType, JSON.stringify(sourceConfig), targetTable, JSON.stringify(fieldMap), cron]); ok(res, { id: r.insertId }); }
  catch (e) { err(res, 500, e.code === 'ER_DUP_ENTRY' ? '编码已存在' : '创建失败'); }
});
// CSV 导入执行（本地实现：解析内联 CSV 写入目标表）
router.post('/etl/:id/run', async (req, res) => {
  const { rows = [] } = req.body || {}; // [{col:value}...]
  if (!Array.isArray(rows) || !rows.length) return err(res, 400, 'rows 数组不能为空');
  const pool = poolOf(req);
  try {
    const [[pipe]] = await pool.execute('SELECT * FROM etl_pipelines WHERE id=?', [req.params.id]);
    if (!pipe) return err(res, 404, '管线不存在');
    const fieldMap = jsonParse(pipe.fieldMap, {});
    const table = pipe.targetTable.replace(/[^a-zA-Z0-9_]/g, '');
    let count = 0;
    for (const row of rows) {
      const mapped = {};
      for (const [src, dst] of Object.entries(fieldMap)) if (row[src] !== undefined) mapped[dst] = row[src];
      const cols = Object.keys(mapped);
      if (!cols.length) continue;
      const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      await pool.execute(sql, cols.map((c) => mapped[c]));
      count++;
    }
    await pool.execute('UPDATE etl_pipelines SET lastRunAt=NOW() WHERE id=?', [req.params.id]);
    ok(res, { imported: count, table });
  } catch (e) { err(res, 500, '执行失败：' + e.message); }
});

/* ==================== 8. 开放平台 API 密钥 ==================== */
router.get('/api-keys', async (req, res) => {
  try { const [rows] = await poolOf(req).execute('SELECT id,appName,accessKey,scopeList,expiresAt,status,createdAt FROM api_keys ORDER BY id'); ok(res, rows.map((r) => ({ ...r, scopeList: jsonParse(r.scopeList, []) }))); }
  catch { err(res, 500, '读取密钥失败'); }
});
router.post('/api-keys', async (req, res) => {
  const { appName, scopeList = [], expiresAt = null } = req.body || {};
  if (!appName) return err(res, 400, '应用名必填');
  const accessKey = 'ak_' + crypto.randomBytes(12).toString('hex');
  const secret = crypto.randomBytes(24).toString('hex');
  const secretHash = crypto.createHash('sha256').update(secret).digest('hex');
  try {
    await poolOf(req).execute('INSERT INTO api_keys (appName,accessKey,secretHash,scopeList,expiresAt) VALUES (?,?,?,?,?)', [appName, accessKey, secretHash, JSON.stringify(scopeList), expiresAt]);
    ok(res, { accessKey, secret, note: 'secret 仅返回这一次，请妥善保存（库里只存哈希）' });
  } catch { err(res, 500, '创建失败'); }
});
router.delete('/api-keys/:id', async (req, res) => {
  try { await poolOf(req).execute('DELETE FROM api_keys WHERE id=?', [req.params.id]); ok(res, { deleted: true }); }
  catch { err(res, 500, '删除失败'); }
});

export default router;
