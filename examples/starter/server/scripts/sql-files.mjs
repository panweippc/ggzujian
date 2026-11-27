/**
 * SQL 文件的依赖顺序（唯一数据源）
 * migrate.mjs（版本化迁移）与 bundle-sql.mjs（生成一次性导入合集）共用，
 * 避免两边顺序/清单漂移。
 *
 * 顺序不可随意调整：enterprise.sql 里有 CREATE TABLE ... LIKE operation_logs，必须晚于 db.sql。
 */
export const SQL_FILES = [
  'db.sql',
  'db-extend-system.sql',
  'db-extend-common.sql',
  'db-extend-enterprise.sql',
  'db-extend-platform.sql',
  'db-extend-signature.sql',
  'db-extend-data-security.sql',
];

export const BUNDLE_FILE = 'db-all.sql';
