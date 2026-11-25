/**
 * 写接口幂等中间件
 * 客户端在写请求带 Idempotency-Key 头；同一 key 在窗口内重复提交直接返回首次响应，
 * 避免网络重试导致重复下单/重复新增。骨架用 DB 表存储（idempotency_keys），进程无关。
 */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const WINDOW_MS = +(process.env.IDEMPOTENCY_WINDOW_MS || 24 * 3600 * 1000);

// 一级缓存（同步命中，规避 DB 异步写入竞态）；二级缓存为 DB 表
const memCache = new Map(); // key -> { endpoint, responseJson, statusCode, at }

export function idempotencyMiddleware() {
  return async (req, res, next) => {
    const key = req.headers['idempotency-key'];
    if (!WRITE_METHODS.has(req.method) || typeof key !== 'string' || !key.trim()) return next();
    const pool = req.app?.locals?.pool;
    const idemKey = key.trim().slice(0, 128);
    const endpoint = `${req.method} ${(req.originalUrl || req.path || '').split('?')[0]}`;
    const cacheKey = `${idemKey}|${endpoint}`;

    // 先查内存（同步，立即可用）
    const mem = memCache.get(cacheKey);
    if (mem && Date.now() - mem.at < WINDOW_MS) {
      res.status(mem.statusCode || 200);
      return res.json(JSON.parse(mem.responseJson || '{}'));
    }
    if (!pool) return next();
    try {
      // 再查 DB（二级）
      const [rows] = await pool.execute(
        'SELECT responseJson, statusCode FROM idempotency_keys WHERE idempotencyKey=? AND endpoint=?',
        [idemKey, endpoint]
      );
      if (rows[0]) {
        memCache.set(cacheKey, { ...rows[0], at: Date.now() });
        res.status(rows[0].statusCode || 200);
        return res.json(JSON.parse(rows[0].responseJson || '{}'));
      }
      // 首次请求：包裹 res.json 同步写内存 + 异步落库
      const origJson = res.json.bind(res);
      res.json = (body) => {
        try {
          const responseJson = JSON.stringify(body)?.slice(0, 60000) || '{}';
          memCache.set(cacheKey, { responseJson, statusCode: res.statusCode, at: Date.now() });
          pool.execute(
            'INSERT IGNORE INTO idempotency_keys (idempotencyKey, endpoint, responseJson, statusCode) VALUES (?,?,?,?)',
            [idemKey, endpoint, responseJson, res.statusCode]
          ).catch(() => {});
        } catch { /* 忽略 */ }
        return origJson(body);
      };
      next();
    } catch {
      next(); // 幂等存储失败不阻断业务
    }
  };
}
