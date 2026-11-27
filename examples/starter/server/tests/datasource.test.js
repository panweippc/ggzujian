/**
 * 多数据库方案 A：PostgreSQL 真适配器（含国产库 PG 兼容模式）
 */
import { describe, it, expect } from 'vitest';
import { transformSql, escapePg, createPgCompatPool, PG_DRIVERS } from '../services/pg-compat.js';
import { createDataSource, SUPPORTED_DRIVERS } from '../services/datasource.js';

describe('SQL 方言转换', () => {
  it('? → $N 且反引号标识符 → 双引号', () => {
    const r = transformSql('SELECT `id`, `name` FROM `users` WHERE id = ? AND name = ?', [1, '张三']);
    expect(r.text).toBe('SELECT "id", "name" FROM "users" WHERE id = $1 AND name = $2');
    expect(r.values).toEqual([1, '张三']);
    expect(r.placeholders).toBe(2);
  });

  it('字符串字面量内的 ? 和反引号不动', () => {
    const r = transformSql("SELECT * FROM t WHERE note = '什么? `x`' AND id = ?", [3]);
    expect(r.text).toBe("SELECT * FROM t WHERE note = '什么? `x`' AND id = $1");
  });

  it('DATABASE() / IFNULL() 转 PG 等价写法', () => {
    const r = transformSql('SELECT DATABASE(), IFNULL(a, 0) FROM t');
    expect(r.text).toContain('current_database()');
    expect(r.text).toContain('COALESCE(');
  });

  it('INSERT 自动补 RETURNING * 以提取 insertId', () => {
    expect(transformSql('INSERT INTO users (name) VALUES (?)', ['a']).text)
      .toMatch(/RETURNING \*$/);
    expect(transformSql('INSERT INTO users (name) VALUES (?) RETURNING id', ['a']).text.match(/RETURNING/g))
      .toHaveLength(1);
  });

  it('真正无法改写的 MySQL 专有语法仍明确拒绝', () => {
    expect(() => transformSql('SHOW CREATE TABLE users')).toThrow(/不支持 MySQL 专有语法/);
    expect(() => transformSql('SELECT STRAIGHT_JOIN * FROM a')).toThrow(/不支持/);
  });

  it('ON DUPLICATE KEY UPDATE 自动改写为 ON CONFLICT … DO UPDATE', () => {
    const r = transformSql(
      'INSERT INTO dict_item_i18n (dictItemId, lang, label) VALUES (?,?,?) ON DUPLICATE KEY UPDATE label=VALUES(label)',
      [1, 'zh', '你好']
    );
    expect(r.text).toBe(
      'INSERT INTO dict_item_i18n (dictItemId, lang, label) VALUES ($1,$2,$3) ON CONFLICT (dictitemid, lang) DO UPDATE SET label=EXCLUDED.label RETURNING *'
    );
    expect(r.values).toEqual([1, 'zh', '你好']);
  });

  it('多列 SET 与表达式保留（version=version+1）', () => {
    const r = transformSql(
      'INSERT INTO app_configs (configKey, configValue, env, version) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE configValue=VALUES(configValue), version=version+1'
    );
    expect(r.text).toContain('ON CONFLICT (configkey, env) DO UPDATE SET');
    expect(r.text).toContain('configvalue=EXCLUDED.configvalue');
    expect(r.text).toContain('version=version+1');
  });

  it('INSERT IGNORE 自动改写为 ON CONFLICT DO NOTHING', () => {
    const r = transformSql('INSERT IGNORE INTO idempotency_keys (idempotencyKey, endpoint) VALUES (?,?)');
    expect(r.text).toBe('INSERT INTO idempotency_keys (idempotencyKey, endpoint) VALUES ($1,$2) ON CONFLICT DO NOTHING RETURNING *');
  });

  it('未登记唯一键的表明确报错，提示补登记而非静默降级', () => {
    expect(() => transformSql('INSERT INTO unknown_t (id) VALUES (1) ON DUPLICATE KEY UPDATE id=2'))
      .toThrow(/UPSERT_KEYS/);
  });

  it('GROUP_CONCAT 按方言改写', () => {
    expect(transformSql('SELECT GROUP_CONCAT(name) FROM t').text).toContain('STRING_AGG(name, \',\')');
    expect(transformSql('SELECT GROUP_CONCAT(name) FROM t', [], 'dameng').text).toContain('LISTAGG');
  });

  it('escapePg 正确转义引号、NULL、布尔、Buffer', () => {
    expect(escapePg("O'Brien")).toBe("'O''Brien'");
    expect(escapePg(null)).toBe('NULL');
    expect(escapePg(true)).toBe('TRUE');
    expect(escapePg(Buffer.from('ab', 'hex'))).toBe("decode('ab', 'hex')");
  });
});

describe('pg 兼容层', () => {
  const makePool = () => {
    const calls = [];
    const client = {
      query: async (text, values) => { calls.push({ text, values, client: true }); return { rows: [], rowCount: 0 }; },
      release: () => calls.push({ text: 'RELEASE' }),
    };
    const pgPool = {
      query: async (text, values) => {
        calls.push({ text, values });
        if (/SELECT\s+1\s+AS\s+ok/i.test(text)) return { rows: [{ ok: 1 }], rowCount: 1 };
        return { rows: [{ id: 7, name: 'x' }], rowCount: 1 };
      },
      connect: async () => client,
    };
    return { pgPool, calls };
  };

  it('SELECT 返回 [rows, meta]（mysql2 形态）', async () => {
    const { pgPool, calls } = makePool();
    const ds = createPgCompatPool(pgPool, { driver: 'postgres' });
    const [rows, meta] = await ds.execute('SELECT `id` FROM `users` WHERE id = ?', [7]);
    expect(rows[0].id).toBe(7);
    expect(meta.rowCount).toBe(1);
    expect(calls[0].text).toContain('$1');
  });

  it('INSERT 返回 insertId', async () => {
    const { pgPool } = makePool();
    const ds = createPgCompatPool(pgPool);
    const [r] = await ds.execute('INSERT INTO users (name) VALUES (?)', ['x']);
    expect(r.insertId).toBe(7);
    expect(r.affectedRows).toBe(1);
  });

  it('事务走 BEGIN / COMMIT / ROLLBACK 且释放连接', async () => {
    const { pgPool, calls } = makePool();
    const ds = createPgCompatPool(pgPool);
    await ds.transaction(async (ctx) => { await ctx.execute('UPDATE t SET a=?', [1]); });
    expect(calls.map((c) => c.text)).toEqual(['BEGIN', 'UPDATE t SET a=$1', 'COMMIT', 'RELEASE']);

    calls.length = 0;
    await expect(ds.transaction(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(calls.map((c) => c.text)).toEqual(['BEGIN', 'ROLLBACK', 'RELEASE']);
  });

  it('ping 可用', async () => {
    const { pgPool } = makePool();
    expect(await createPgCompatPool(pgPool).ping()).toBe(true);
  });
});

describe('驱动工厂', () => {
  it('postgres / 国产库走真 PG 适配器（非占位）', async () => {
    for (const driver of PG_DRIVERS) {
      const ds = createDataSource({ driver });
      expect(ds.__pg).toBe(true);
      expect(ds.__placeholder).toBeFalsy();
      expect(ds.driver).toBe(driver);
      await ds.end();
    }
  });

  it('mongodb / influxdb 仍是明确报错的占位适配器', () => {
    for (const driver of ['mongodb', 'influxdb']) {
      const ds = createDataSource({ driver });
      expect(ds.__placeholder).toBe(true);
      expect(() => ds.query('SELECT 1')).toThrow(/尚未接入/);
    }
  });

  it('支持清单包含 mysql 与全部 PG 系驱动', () => {
    expect(SUPPORTED_DRIVERS).toEqual(expect.arrayContaining(['mysql', ...PG_DRIVERS]));
  });
});
