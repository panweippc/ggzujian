/**
 * SSE（Server-Sent Events）推送总线 —— 内存实现，零外部依赖
 *
 * 每个连接按 username 注册（支持一人多端）。广播时只推给目标用户或全部。
 * 心跳每 25s 发送，防止代理/Nginx 断连；连接断开自动清理。
 */
import { EventEmitter } from 'node:events';

export function createSseBus() {
  const ee = new EventEmitter();
  ee.setMaxListeners(0);
  const clients = new Map(); // username -> Set<res>
  let seq = 0;

  function add(username, res) {
    if (!clients.has(username)) clients.set(username, new Set());
    clients.get(username).add(res);
    const id = ++seq;
    return () => {
      const set = clients.get(username);
      if (set) { set.delete(res); if (!set.size) clients.delete(username); }
    };
  }

  function write(res, event, data, id) {
    try {
      if (id !== undefined) res.write(`id: ${id}\n`);
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      return true;
    } catch { return false; }
  }

  /** 广播：to 为空则推给所有连接 */
  function broadcast(event, data, to = '') {
    const targets = to ? [...(clients.get(to) || [])] : [...clients.values()].flatMap(s => [...s]);
    for (const res of targets) write(res, event, data);
    ee.emit('broadcast', { event, data, to, count: targets.length });
  }

  function heartbeat() {
    for (const set of clients.values()) for (const res of set) write(res, 'ping', { at: Date.now() });
  }

  function stats() {
    return { connections: [...clients.values()].reduce((n, s) => n + s.size, 0), users: clients.size };
  }

  return { add, broadcast, heartbeat, stats, write, events: ee };
}

export const sseBus = createSseBus();
export default { createSseBus, sseBus };
