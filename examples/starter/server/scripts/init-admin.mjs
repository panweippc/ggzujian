#!/usr/bin/env node
/**
 * 管理员一键初始化：替代 README 里"生成哈希 → 手动填 SQL → 手动执行"三步。
 *
 * 用法：
 *   ADMIN_INIT_PASSWORD='强密码' node scripts/init-admin.mjs
 *   node scripts/init-admin.mjs --username admin          # 自定义用户名（默认 admin）
 *   node scripts/init-admin.mjs --dry-run                 # 只打印将执行的操作，不连库
 *   node scripts/init-admin.mjs --force-reset             # 已存在时强制重置密码并踢下线
 *
 * 密码来源优先级：--password 参数 > 环境变量 ADMIN_INIT_PASSWORD。
 * 幂等：用户已存在且未加 --force-reset 时跳过（不覆盖现有密码）。
 * 前置：需先导入建表 SQL（db-all.sql / migrate.mjs），并确保 .env 已配置数据库连接。
 */
import 'dotenv/config';
import crypto from 'node:crypto';

const argv = process.argv.slice(2);
const arg = (name, def = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] || '') : def;
};
const has = (name) => argv.includes('--' + name);
const DRY = has('dry-run');
const FORCE = has('force-reset');
const USERNAME = arg('username', 'admin');
const PASSWORD = arg('password', '') || process.env.ADMIN_INIT_PASSWORD || '';
const ROLE = arg('role', 'admin');

if (!PASSWORD) {
  console.error('[失败] 未提供密码。请设置 ADMIN_INIT_PASSWORD 环境变量或用 --password 传入。');
  process.exit(1);
}
if (PASSWORD.length < 8) {
  console.error('[失败] 密码长度不足 8 位，请使用强密码。');
  process.exit(1);
}
if (!/^[A-Za-z0-9_-]{1,64}$/.test(USERNAME)) {
  console.error('[失败] 用户名仅允许字母/数字/下划线/连字符（1-64 位）。');
  process.exit(1);
}

/** 密码哈希：优先用项目自带 auth-kit，降级用 node crypto（bcrypt 不可用时的兜底提示） */
async function hashPassword(pwd) {
  try {
    const kit = await import('@panweippc/auth-kit');
    if (typeof kit.hashPassword === 'function') return await kit.hashPassword(pwd);
  } catch { /* 下方统一报错 */ }
  throw new Error('无法加载 @panweippc/auth-kit 的 hashPassword，请先 cd server && npm i');
}

async function main() {
  const hash = await hashPassword(PASSWORD);
  if (DRY) {
    console.log('=== DRY RUN（不连库、不写库）===');
    console.log(`目标用户: ${USERNAME}  角色: ${ROLE}  密码: ${'*'.repeat(PASSWORD.length)}`);
    console.log(`密码哈希: ${hash}`);
    console.log(FORCE ? '策略: 已存在则强制重置密码并 +1 token_version' : '策略: 已存在则跳过（幂等）');
    console.log('\n提示：正式执行去掉 --dry-run；密码建议从 ADMIN_INIT_PASSWORD 读取而非命令行参数。');
    return;
  }

  // 跳过启动自检（此时可能尚未建表），只借数据源工厂做驱动识别与连接
  process.env.DB_SKIP_COMPAT_CHECK = 'true';
  const { prepareDatabase } = await import('../services/db-compat-check.js');
  const { createDataSource } = await import('../services/datasource.js');
  const { dataSource, driver } = await prepareDatabase(createDataSource);

  try {
    const [rows] = await dataSource.execute('SELECT id, role FROM users WHERE username = ?', [USERNAME]);
    const exists = rows[0];

    if (exists && !FORCE) {
      console.log(`✓ 用户 ${USERNAME} 已存在（id=${exists.id}, role=${exists.role}），跳过。`);
      console.log('  如需重置密码，请加 --force-reset（会同时使该用户所有旧 token 失效）。');
      return;
    }

    if (exists) {
      await dataSource.execute(
        'UPDATE users SET password = ?, role = ?, token_version = token_version + 1 WHERE username = ?',
        [hash, ROLE, USERNAME]
      );
      console.log(`✓ 已强制重置用户 ${USERNAME} 的密码，role=${ROLE}，旧 token 已失效。`);
    } else {
      await dataSource.execute(
        'INSERT INTO users (username, password, role, token_version) VALUES (?, ?, ?, 0)',
        [USERNAME, hash, ROLE]
      );
      console.log(`✓ 已创建管理员 ${USERNAME}，role=${ROLE}。`);
    }
    console.log(`  驱动=${driver}；请妥善保存密码，勿提交 .env。`);
  } finally {
    await dataSource.end?.();
  }
}

main().catch((e) => {
  console.error('[初始化失败]', e.message);
  process.exit(1);
});
