/**
 * SSE 实时推送路由（免轮询）
 *
 *   GET /api/sse/notifications?token=<JWT>  —— EventSource 专用（无法设 Authorization 头）
 *   GET /api/sse/stats                       —— 连接统计（管理员，供监控）
 *
 * 注意：本路由在 server.js 中挂到 requireAuth **之前**，内部自行用 query token 鉴权。
 * 消息发送成功后由 messages.js 调 sseBus.broadcast('notification', ...) 推送。
 */
import express from 'express';
import { sseBus } from '../services/sse-bus.js';

const router = express.Router();

function authFromQuery(verifyToken) {
  return (req, res, next) => {
    const token = String(req.query.token || '');
    if (!token) return res.status(401).json({ success: false, message: '未登录' });
    try {
      req.user = verifyToken(token);
      next();
    } catch {
      res.status(401).json({ success: false, message: '登录已过期' });
    }
  };
}

/** 创建 SSE 路由时注入 verifyToken（避免在模块顶层依赖 server.js 的 security 实例） */
export function createSseRouter(verifyToken) {
  const r = express.Router();
  const guard = authFromQuery(verifyToken);

  r.get('/sse/notifications', guard, (req, res) => {
    const username = req.user?.username || req.user?.name || '';
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
    res.flushHeaders?.();

    sseBus.write(res, 'connected', { username, at: Date.now() });
    const remove = sseBus.add(username, res);
    req.on('close', remove);
  });

  r.get('/sse/stats', guard, (req, res) => {
    res.json({ success: true, data: sseBus.stats() });
  });

  return r;
}

/** 默认导出占位 router（server.js 用 createSseRouter 注入 verifyToken） */
export default router;
export { sseBus };
