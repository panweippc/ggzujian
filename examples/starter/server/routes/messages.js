/**
 * 统一消息中心接口（底座第 5 部分）
 * 对外只暴露 send / channels / logs，业务系统调 send 即可多渠道触达。
 */
import express from 'express';
import { sendMessage, channelStatus, readMessageLog } from '../services/message-channels.js';
import { writeAudit } from '../middleware/audit.js';

const router = express.Router();
const adminOnly = (req, res, next) => {
  const role = req.user?.role || req.user?.roleName || '';
  const name = req.user?.name || req.user?.username || '';
  return (['admin', '系统管理员', '总经理'].includes(role) || name === 'admin')
    ? next() : res.status(403).json({ success: false, message: '无权限，仅管理员可操作' });
};

/** 统一发送入口：一次调用，任选通道 */
router.post('/messages/send', adminOnly, async (req, res) => {
  const { channel, to, title, content, link, type } = req.body || {};
  if (!title) return res.status(400).json({ success: false, message: '标题必填' });
  try {
    const result = await sendMessage(req.app.locals.pool, { channel, to, title, content, link, type });
    await writeAudit(req.app.locals.pool, req, {
      action: 'message_send', module: 'message', targetName: to || '*',
      detail: `通过 ${result.channel} 发送消息「${title}」(${result.mode})`
    }).catch(() => {});
    res.json({ success: result.ok, data: result, message: result.ok ? undefined : result.error });
  } catch (e) {
    res.status(400).json({ success: false, message: e.message });
  }
});

/** 通道状态：前端展示哪些已就绪、哪些是控制台适配器 */
router.get('/messages/channels', adminOnly, (req, res) => {
  res.json({ success: true, data: channelStatus() });
});

/** 消息发送日志 */
router.get('/messages/logs', adminOnly, (req, res) => {
  res.json({ success: true, data: readMessageLog(+(req.query.limit || 50)) });
});

export default router;
