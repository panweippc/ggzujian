/**
 * 电子签章路由
 *   POST /api/signatures/sign      对文档签章（存摘要 + HMAC 签名）
 *   POST /api/signatures/verify    验签（传文档内容 + 签章 id 或完整签章信息）
 *   POST /api/signatures/revoke    撤销签章（管理员）
 *   GET  /api/signatures/:docId    查某文档的所有签章记录
 *   GET  /api/seals                印章列表
 *   POST /api/seals                新建印章（管理员）
 */
import express from 'express';
import crypto from 'node:crypto';
import { writeAudit } from '../middleware/audit.js';
import { adminOnly } from '../middleware/role.js';
import { createSignatureService } from '../services/signature.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const signatures = createSignatureService();

/** 签章 */
router.post('/signatures/sign', async (req, res) => {
  const { docId, docType = 'contract', docContent, signerName, sealId = 'default' } = req.body || {};
  if (!docId || docContent == null) return res.status(400).json({ success: false, message: 'docId 与 docContent 必填' });
  const signer = req.user?.name || req.user?.username || '';
  try {
    const rec = signatures.sign({ docContent, signer, signerName, sealId });
    const [r] = await poolOf(req).execute(
      `INSERT INTO signatures (docId, docType, docHash, signer, signerName, sealId, signature, signedAt, ip, userAgent, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,1)`,
      [String(docId), docType, rec.docHash, rec.signer, rec.signerName || '', rec.sealId, rec.signature,
        rec.signedAt, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 255)]
    );
    await writeAudit(poolOf(req), req, {
      userId: String(req.user?.id || ''), username: signer, action: 'sign', module: 'signature',
      detail: `对文档 ${docId} 签章，记录 id=${r.insertId}`, ipAddress: req.ip,
    }).catch(() => {});
    res.json({ success: true, data: { id: r.insertId, ...rec } });
  } catch (e) {
    res.status(500).json({ success: false, message: '签章失败：' + e.message });
  }
});

/** 验签：传 docContent + signatureId（从记录取）或直接传完整字段 */
router.post('/signatures/verify', async (req, res) => {
  const { docContent, signatureId, docHash, signer, sealId, signedAt, signature } = req.body || {};
  if (docContent == null) return res.status(400).json({ success: false, message: 'docContent 必填' });
  let info = { docHash, signer, sealId, signedAt, signature };
  let status = 1;
  if (signatureId) {
    try {
      const [rows] = await poolOf(req).execute('SELECT * FROM signatures WHERE id=?', [signatureId]);
      const row = rows[0];
      if (!row) return res.status(404).json({ success: false, message: '签章记录不存在' });
      info = row;
      status = row.status;
    } catch (e) { return res.status(500).json({ success: false, message: '查询签章失败' }); }
  }
  const result = signatures.verify({ ...info, docContent }, status);
  res.json({ success: true, data: result });
});

/** 撤销签章（管理员） */
router.post('/signatures/revoke', adminOnly, async (req, res) => {
  const { id, reason = '' } = req.body || {};
  if (!id) return res.status(400).json({ success: false, message: 'id 必填' });
  try {
    await poolOf(req).execute(
      'UPDATE signatures SET status=0, revokedAt=NOW(), revokedBy=?, reason=? WHERE id=? AND status=1',
      [req.user?.name || req.user?.username || '', String(reason).slice(0, 255), id]
    );
    await writeAudit(poolOf(req), req, {
      userId: String(req.user?.id || ''), username: req.user?.name || req.user?.username || '',
      action: 'revoke_signature', module: 'signature', detail: `撤销签章 id=${id}，原因=${reason}`, ipAddress: req.ip,
    }).catch(() => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '撤销失败：' + e.message }); }
});

/** 文档签章记录 */
router.get('/signatures/:docId', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute(
      'SELECT id, docId, docType, docHash, signer, signerName, sealId, signedAt, status, revokedAt, reason FROM signatures WHERE docId=? ORDER BY signedAt DESC',
      [req.params.docId]
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '查询失败：' + e.message }); }
});

/** 印章管理 */
router.get('/seals', async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM seals WHERE status=1 ORDER BY createdAt DESC');
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: '查询印章失败' }); }
});

router.post('/seals', adminOnly, async (req, res) => {
  const { name, owner, color = '#dc2626', imgData = '' } = req.body || {};
  if (!name || !owner) return res.status(400).json({ success: false, message: 'name 与 owner 必填' });
  const id = crypto.randomUUID();
  try {
    await poolOf(req).execute(
      'INSERT INTO seals (id, name, owner, color, imgData, status, createdBy) VALUES (?,?,?,?,?,1,?)',
      [id, name, owner, color, String(imgData).slice(0, 500000), req.user?.name || req.user?.username || '']
    );
    res.json({ success: true, data: { id } });
  } catch (e) { res.status(500).json({ success: false, message: '新建印章失败：' + e.message }); }
});

export default router;
