/**
 * Cron 可视化辅助测试：解析 / 人类可读描述 / 下次执行时间
 */
import { describe, it, expect } from 'vitest';
import { parse, describe as describeCron, nextRun } from '../services/cron.js';

describe('Cron · 解析', () => {
  it('合法 5 段解析', () => {
    const p = parse('30 9 * * 1');
    expect(p.minute).toBe(30); expect(p.hour).toBe(9); expect(p.week).toBe(1);
  });
  it('段数错误抛异常', () => {
    expect(() => parse('0 2 * *')).toThrow(/5 段/);
  });
  it('数值越界抛异常', () => {
    expect(() => parse('99 2 * * *')).toThrow(/范围/);
  });
});

describe('Cron · 人类可读描述', () => {
  it('常见模式可读', () => {
    expect(describeCron('* * * * *').text).toMatch(/每分钟/);
    expect(describeCron('*/5 * * * *').text).toMatch(/5 分钟/);
    expect(describeCron('0 */6 * * *').text).toMatch(/6 小时/);
    expect(describeCron('0 2 * * *').text).toMatch(/每天 02:00/);
    expect(describeCron('0 9 * * 1').text).toMatch(/每周一/);
    expect(describeCron('0 0 1 * *').text).toMatch(/每月 1 日/);
  });
  it('非法表达式返回 ok=false', () => {
    expect(describeCron('bad').ok).toBe(false);
  });
});

describe('Cron · 下次执行时间', () => {
  const from = new Date('2026-11-26T10:15:30');
  it('每分钟 → 下一分钟整', () => {
    const n = nextRun('* * * * *', from);
    expect(n.getMinutes()).toBe(16); expect(n.getSeconds()).toBe(0);
  });
  it('每天 02:00 → 次日 02:00（当天已过）', () => {
    const n = nextRun('0 2 * * *', from);
    expect(n.getHours()).toBe(2); expect(n.getMinutes()).toBe(0);
    expect(n.getDate()).toBe(27);
  });
  it('每周一 → 下一个周一', () => {
    const n = nextRun('0 9 * * 1', from); // 2026-11-26 是周四
    expect(n.getDay()).toBe(1); expect(n.getHours()).toBe(9);
  });
  it('每月 1 号 → 下月 1 号', () => {
    const n = nextRun('0 0 1 * *', from);
    expect(n.getDate()).toBe(1); expect(n.getHours()).toBe(0);
  });
});
