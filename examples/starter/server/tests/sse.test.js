/**
 * SSE 推送总线测试：注册/定向广播/全员广播/移除/统计/心跳
 */
import { describe, it, expect } from 'vitest';
import { createSseBus } from '../services/sse-bus.js';

function fakeRes() {
  const chunks = [];
  return {
    chunks,
    write(s) { chunks.push(s); return true; },
    text() { return chunks.join(''); },
  };
}

describe('SSE 总线', () => {
  it('定向广播只推给目标用户', () => {
    const bus = createSseBus();
    const alice = fakeRes(); const bob = fakeRes();
    const rmAlice = bus.add('alice', alice); bus.add('bob', bob);
    bus.broadcast('notification', { title: 'hi' }, 'alice');
    expect(alice.text()).toMatch(/event: notification/);
    expect(alice.text()).toMatch(/hi/);
    expect(bob.text()).toBe('');
    rmAlice();
  });

  it('全员广播推给所有连接', () => {
    const bus = createSseBus();
    const a = fakeRes(); const b = fakeRes();
    bus.add('alice', a); bus.add('bob', b);
    bus.broadcast('notice', { x: 1 });
    expect(a.text()).toMatch(/event: notice/);
    expect(b.text()).toMatch(/event: notice/);
  });

  it('移除后不再收到推送，统计同步减少', () => {
    const bus = createSseBus();
    const a = fakeRes();
    const rm = bus.add('alice', a);
    expect(bus.stats()).toEqual({ connections: 1, users: 1 });
    rm();
    expect(bus.stats()).toEqual({ connections: 0, users: 0 });
    bus.broadcast('notice', { x: 1 });
    expect(a.text()).toBe('');
  });

  it('同一用户多端都收到广播', () => {
    const bus = createSseBus();
    const a = fakeRes(); const b = fakeRes();
    bus.add('alice', a); bus.add('alice', b);
    expect(bus.stats().connections).toBe(2);
    bus.broadcast('notification', { title: 'multi' }, 'alice');
    expect(a.text()).toMatch(/multi/);
    expect(b.text()).toMatch(/multi/);
  });

  it('心跳发送 ping 事件', () => {
    const bus = createSseBus();
    const a = fakeRes();
    bus.add('alice', a);
    bus.heartbeat();
    expect(a.text()).toMatch(/event: ping/);
  });
});
