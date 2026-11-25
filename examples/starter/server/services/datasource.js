/**
 * 统一数据接入层（底座：Unified Data Access）
 * 对上层路由屏蔽底层存储差异：业务只见 query/execute/transaction 三个方法。
 *
 * DB_DRIVER 切换驱动：
 *   - mysql（默认）：mysql2/promise 真实实现
 *   - postgres / dameng / kingbase / opengauss：预留适配器接口（国产库多兼容 PG 协议，
 *     装对应驱动后在此实现 createPgLikeAdapter 即可），未接入时启动即明确报错，不静默降级
 *   - mongodb / influxdb：预留接口（NoSQL / 时序），同上
 *
 * 方言层：分页/标识符引号等差异统一在 dialect 中，业务 SQL 保持可移植写法。
 */
import mysql from 'mysql2/promise';

const DRIVER = (process.env.DB_DRIVER || 'mysql').toLowerCase();

/** 每种驱动的 SQL 方言（分页写法、标识符引号） */
const DIALECTS = {
  mysql: { name: 'mysql', quote: (s) => `\`${s}\``, placeholder: '?' },
  postgres: { name: 'postgres', quote: (s) => `"${s}"`, placeholder: '$1' },
  dameng: { name: 'dameng', quote: (s) => `"${s}"`, placeholder: '?' },   // 达梦：类 Oracle/PG
  kingbase: { name: 'kingbase', quote: (s) => `"${s}"`, placeholder: '$1' }, // 人大金仓：兼容 PG
  opengauss: { name: 'opengauss', quote: (s) => `"${s}"`, placeholder: '$1' }, // openGauss：兼容 PG
  mongodb: { name: 'mongodb', quote: (s) => s, placeholder: null },
  influxdb: { name: 'influxdb', quote: (s) => s, placeholder: null },
};

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
    raw: pool, // 需要驱动专有能力时可从这里拿原生 pool（骨架内已有路由直接用 pool.execute，保持兼容）
    ping: async () => { const [r] = await pool.execute('SELECT 1 AS ok'); return r?.[0]?.ok === 1; },
  };
}

/** 预留适配器：明确报错，避免"配了却静默走 MySQL"的假兼容 */
function createPlaceholderAdapter(driver) {
  const msg = `DB_DRIVER=${driver} 的适配器尚未接入。请安装对应驱动并在 server/services/datasource.js 的 ADAPTERS 中实现后重试（国产库多兼容 PostgreSQL 协议，可参考 createMysqlAdapter 包装 pg 客户端）。`;
  const fail = () => { throw new Error(msg); };
  return {
    driver,
    dialect: DIALECTS[driver] || { name: driver, quote: (s) => s, placeholder: '?' },
    query: fail, execute: fail, transaction: fail, raw: null,
    ping: async () => { throw new Error(msg); },
    __placeholder: true, __message: msg,
  };
}

export function createDataSource() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: +(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
  });

  let adapter;
  if (DRIVER === 'mysql') adapter = createMysqlAdapter(pool);
  else if (DIALECTS[DRIVER]) adapter = createPlaceholderAdapter(DRIVER);
  else throw new Error(`未知 DB_DRIVER=${DRIVER}，支持：${Object.keys(DIALECTS).join(', ')}`);

  return adapter;
}

export const SUPPORTED_DRIVERS = Object.keys(DIALECTS);
export default createDataSource;
