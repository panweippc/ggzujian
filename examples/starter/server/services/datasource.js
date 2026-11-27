/**
 * 统一数据接入层（底座：Unified Data Access）
 * 对上层路由屏蔽底层存储差异：业务只见 query/execute/transaction 三个方法。
 *
 * DB_DRIVER 切换驱动：
 *   - mysql：mysql2/promise 真实实现（默认）
 *   - postgres：pg 真实适配器（经 pg-compat 兼容层，现有路由零改动）
 *   - kingbase / opengauss / dameng：复用 PostgreSQL 协议栈（国产库 PG 兼容模式），
 *     连接参数用 PG_URL 或 DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME
 *   - mongodb / influxdb：预留适配器接口，未接入时启动即明确报错，不静默降级
 *
 * 方言层：分页/标识符引号差异统一在 dialect 中；pg-compat 负责 ` → " 与 ? → $N。
 */
import mysql from 'mysql2/promise';
import pg from 'pg';
import { createPgCompatPool, PG_DRIVERS } from './pg-compat.js';
import { DIALECTS } from './dialects.js';

const DRIVER = (process.env.DB_DRIVER || 'mysql').toLowerCase();

/** MySQL 适配器：把 mysql2 pool 包成统一接口 */
function createMysqlAdapter(pool) {
  return {
    driver: 'mysql',
    dialect: DIALECTS.mysql,
    query: (sql, params = []) => pool.execute(sql, params),
    execute: (sql, params = []) => pool.execute(sql, params),
    transaction: async (handler) => {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const result = await handler({
          query: (sql, params = []) => conn.execute(sql, params),
          execute: (sql, params = []) => conn.execute(sql, params),
        });
        await conn.commit();
        return result;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
    raw: pool,
    ping: async () => { const [r] = await pool.execute('SELECT 1 AS ok'); return r?.[0]?.ok === 1; },
  };
}

/** PostgreSQL 协议栈适配器（含国产库 PG 兼容模式） */
function createPgDataSource(driver) {
  const pgPool = new pg.Pool({
    connectionString: process.env.PG_URL || process.env.DATABASE_URL || undefined,
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 5432),
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    max: +(process.env.DB_POOL_MAX || 10),
    ssl: process.env.PG_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
  });
  const adapter = createPgCompatPool(pgPool, { driver });
  adapter.dialect = DIALECTS[driver]; // transaction / getConnection 由 pg-compat 统一提供
  return adapter;
}

/** 预留适配器：明确报错，避免"配了却静默走 MySQL"的假兼容 */
function createPlaceholderAdapter(driver) {
  const msg = `DB_DRIVER=${driver} 的适配器尚未接入。请安装对应驱动并实现后重试（PostgreSQL 协议栈已支持：${PG_DRIVERS.join(', ')}）。`;
  const fail = () => { throw new Error(msg); };
  return {
    driver,
    dialect: DIALECTS[driver] || { name: driver, quote: (s) => s, placeholder: '?' },
    query: fail, execute: fail, transaction: fail, raw: null,
    ping: async () => { throw new Error(msg); },
    __placeholder: true, __message: msg,
  };
}

export function createDataSource(overrides = {}) {
  const driver = String(overrides.driver || DRIVER).toLowerCase();

  if (driver === 'mysql') {
    return createMysqlAdapter(mysql.createPool({
      host: process.env.DB_HOST || '127.0.0.1',
      port: +(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
    }));
  }
  if (PG_DRIVERS.includes(driver)) return createPgDataSource(driver);
  if (DIALECTS[driver]) return createPlaceholderAdapter(driver);
  throw new Error(`未知 DB_DRIVER=${driver}，支持：${Object.keys(DIALECTS).join(', ')}`);
}

export { DIALECTS };
export const SUPPORTED_DRIVERS = Object.keys(DIALECTS);
export default createDataSource;
