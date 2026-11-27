/**
 * 数据库自动识别 + 启动自检（纯 mock，无需真机）
 */
import { describe, it, expect, vi } from 'vitest';
import {
  driverFromVersion, guessProtocol, runStartupCheck, resolveDriver,
} from '../services/db-compat-check.js';
import { transformSql } from '../services/pg-compat.js';

describe('版本串识别驱动', () => {
  it('识别国产库与通用数据库', () => {
    expect(driverFromVersion('PostgreSQL 14.2')).toBe('postgres');
    expect(driverFromVersion('KingbaseES V008R006')).toBe('kingbase');
    expect(driverFromVersion('openGauss 3.1.0')).toBe('opengauss');
    expect(driverFromVersion('DM Database Server 64 V8')).toBe('dameng');
    expect(driverFromVersion('8.0.32 MySQL Community Server')).toBe('mysql');
    expect(driverFromVersion('10.11.2-MariaDB')).toBe('mysql');
  });

  it('特殊库优先于通用 PG（openGauss 版本串含 PostgreSQL 时）', () => {
    expect(driverFromVersion('openGauss 5.0 (based on PostgreSQL 14)')).toBe('opengauss');
  });

  it('未知版本串返回 null，不猜测', () => {
    expect(driverFromVersion('SomeUnknownDB 1.0')).toBeNull();
    expect(driverFromVersion('')).toBeNull();
  });
});

describe('协议推断', () => {
  const saved = { ...process.env };
  const reset = () => { process.env.DB_DRIVER = ''; process.env.DATABASE_URL = ''; process.env.PG_URL = ''; delete process.env.DB_PORT; };
  it('按连接串 scheme 推断', () => {
    reset(); process.env.DATABASE_URL = 'mysql://u:p@h:3306/db';
    expect(guessProtocol()).toBe('mysql');
    process.env.DATABASE_URL = 'postgres://u:p@h:5432/db';
    expect(guessProtocol()).toBe('pg');
    process.env.DATABASE_URL = ''; process.env.PG_URL = 'kingbase://h:54321/db';
    expect(guessProtocol()).toBe('pg');
  });
  it('按端口推断', () => {
    reset(); process.env.DB_PORT = '3306';
    expect(guessProtocol()).toBe('mysql');
    process.env.DB_PORT = '54321';
    expect(guessProtocol()).toBe('pg');
    process.env.DB_PORT = '5236';
    expect(guessProtocol()).toBe('pg');
  });
  Object.assign(process.env, saved);
});

describe('启动自检', () => {
  it('PG 方言冒烟全部走兼容层转换，失败时明确报出探测 SQL', async () => {
    const executed = [];
    const dataSource = {
      execute: async (sql, params) => { executed.push(sql); return [[], {}]; },
    };
    const result = await runStartupCheck(dataSource, 'postgres', transformSql);
    expect(result.ok).toBe(true);
    expect(result.checks).toContain('upsert');
    expect(result.checks).toContain('pagination');
    // upsert 探测 SQL 必须已被改写为 ON CONFLICT
    const upsertSql = executed.find((s) => s.includes('ON CONFLICT'));
    expect(upsertSql).toContain('app_configs');
  });

  it('某条 SQL 执行失败时抛出含方言与 SQL 的错误', async () => {
    const dataSource = {
      execute: async (sql) => { if (sql.includes('version()')) throw new Error('function not exists'); return [[], {}]; },
    };
    await expect(runStartupCheck(dataSource, 'kingbase', transformSql)).rejects.toThrow(/kingbase.*version\(\)/s);
  });

  it('MySQL 驱动无需方言自检', async () => {
    const result = await runStartupCheck({ execute: async () => {} }, 'mysql');
    expect(result.ok).toBe(true);
    expect(result.checks).toContain('native-mysql');
  });
});

describe('驱动解析', () => {
  it('显式配置优先，不触发探测', async () => {
    process.env.DB_DRIVER = 'postgres';
    const r = await resolveDriver();
    expect(r.driver).toBe('postgres');
    expect(r.detected).toBe(false);
  });
});
