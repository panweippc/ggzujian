/**
 * 一键安全自检 API 的纯函数路径：
 * 环境开关、白名单校验、等级枚举、三种脚本 JSON 输出归一化。
 * 子进程执行部分由脚本自身的冒烟验证覆盖，这里不实际起检测进程。
 */
import { describe, it, expect } from 'vitest';
import {
  CHECK_IDS, isUiEnabled, pickChecks, normalizeLevel, normalizeResult,
} from '../routes/security-check.js';

describe('安全自检 · 环境开关', () => {
  it('开发环境默认开启', () => {
    expect(isUiEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(isUiEnabled({})).toBe(true);
  });
  it('生产环境默认关闭', () => {
    expect(isUiEnabled({ NODE_ENV: 'production' })).toBe(false);
  });
  it('显式配置优先于环境推断', () => {
    expect(isUiEnabled({ NODE_ENV: 'production', SECURITY_UI_ENABLED: 'true' })).toBe(true);
    expect(isUiEnabled({ NODE_ENV: 'development', SECURITY_UI_ENABLED: 'false' })).toBe(false);
    expect(isUiEnabled({ NODE_ENV: 'production', SECURITY_UI_ENABLED: ' TRUE ' })).toBe(true);
  });
});

describe('安全自检 · 请求白名单', () => {
  it('未指定时返回全部检测项', () => {
    expect(pickChecks(undefined).checks.map((c) => c.id)).toEqual(CHECK_IDS);
  });
  it('接受单项字符串与数组，并去重', () => {
    expect(pickChecks('secrets').checks.map((c) => c.id)).toEqual(['secrets']);
    expect(pickChecks(['quality', 'quality', 'secrets']).checks.map((c) => c.id)).toEqual(['quality', 'secrets']);
  });
  it('拒绝未知项与空数组（防路径/参数注入）', () => {
    expect(pickChecks(['secrets', '../../etc/passwd']).error).toMatch(/不支持的检测项/);
    expect(pickChecks('node -e evil').error).toMatch(/不支持的检测项/);
    expect(pickChecks([]).error).toMatch(/至少选择一项/);
  });
  it('等级仅允许 二级 / 三级', () => {
    expect(normalizeLevel()).toBe('三级');
    expect(normalizeLevel('二级')).toBe('二级');
    expect(normalizeLevel('一级')).toBeNull();
  });
});

describe('安全自检 · 结果归一化', () => {
  it('密钥扫描：高危→fail，可疑→warn，干净→pass', () => {
    expect(normalizeResult('secrets', { ok: true, critical: [], suspicious: [] }).status).toBe('pass');
    const warn = normalizeResult('secrets', {
      ok: false, critical: [], suspicious: [{ file: 'a.js', line: 3, msg: '高熵', level: 'suspicious' }],
    });
    expect(warn.status).toBe('warn');
    expect(warn.findings[0]).toMatchObject({ file: 'a.js', line: 3, message: '高熵' });
    const fail = normalizeResult('secrets', {
      ok: false, critical: [{ file: 'b.js', line: 8, msg: '私钥', level: 'critical' }], suspicious: [],
    });
    expect(fail.status).toBe('fail');
    expect(fail.summary.高危).toBe(1);
  });

  it('代码质量：有发现→warn，无发现→pass', () => {
    const s = { files: 126, duplicateBlocks: 2, longFiles: 0, longFns: 1, deadExports: 0, todo: 0, consoleLogs: 0 };
    const warn = normalizeResult('quality', {
      ok: true, summary: s, findings: [{ type: 'duplicate', level: 'warn', file: 'x.js', line: 12, detail: '重复块' }], note: '启发式',
    });
    expect(warn.status).toBe('warn');
    expect(warn.summary.扫描文件).toBe(126);
    expect(warn.findings[0].message).toBe('重复块');
    expect(normalizeResult('quality', { ok: true, summary: s, findings: [], note: '' }).status).toBe('pass');
  });

  it('等保自查：缺失→fail，仅人工→warn，全通过→pass', () => {
    const base = { level: '三级', disclaimer: '自查预检，非等级保护测评结论' };
    const missing = normalizeResult('compliance', { ...base, summary: { pass: 14, missing: 1, manual: 18, total: 33 }, results: [] });
    expect(missing.status).toBe('fail');
    expect(missing.summary.需人工).toBe(18);
    expect(missing.disclaimer).toMatch(/非等级保护测评结论/);
    const manual = normalizeResult('compliance', { ...base, summary: { pass: 14, missing: 0, manual: 19, total: 33 }, results: [] });
    expect(manual.status).toBe('warn');
    const pass = normalizeResult('compliance', { ...base, summary: { pass: 33, missing: 0, manual: 0, total: 33 }, results: [] });
    expect(pass.status).toBe('pass');
  });

  it('扩展检测（12 项）：通用归一化器按 counts 判定并保留 findings', () => {
    const warn = normalizeResult('api-exposure', {
      ok: true, summary: { publicEndpoints: 4 }, counts: { pass: 3, warn: 1 },
      findings: [{ level: 'warn', file: 'server.js', line: 1, message: '需复核' }],
    });
    expect(warn.status).toBe('warn');
    expect(warn.summary.publicEndpoints).toBe(4);
    expect(warn.findings[0]).toMatchObject({ file: 'server.js', line: 1, message: '需复核' });
    expect(normalizeResult('sbom', { ok: false, counts: { critical: 1 }, findings: [] }).status).toBe('fail');
  });

  it('白名单共 15 项（原 3 项 + 扩展 12 项）', () => {
    expect(CHECK_IDS).toHaveLength(15);
  });

  it('非 JSON / 空输出归一为 error；未登记 id 走通用格式', () => {
    expect(normalizeResult('secrets', null).status).toBe('error');
    // id 已由 pickChecks 白名单拦截；这里验证通用归一化不会误判为 error
    expect(normalizeResult('unknown', { ok: true, counts: {}, findings: [] }).status).toBe('pass');
  });
});
