#!/usr/bin/env node
/**
 * 密钥统一轮换协调器：把散落的密钥轮换动作收口成一条可预演的命令。
 *
 * 背景：
 *   - JWT_SECRET / JWT_SECRET_PREVIOUS：改密后旧 token 靠 PREVIOUS 平滑过渡
 *   - SIGN_SECRET：签章密钥，轮换后旧签章验签会失败（需业务决定是否保留旧值）
 *   - DATA_ENCRYPT_KEY / DATA_ENCRYPT_KEY_PREVIOUS：字段密文靠 PREVIOUS 解密后重加密
 *   - BACKUP_ENCRYPT_KEY：变更会导致旧加密备份无法解密（高危，需专门流程）
 *
 * 本脚本做三件事：
 *   1) 生成新密钥（crypto 强随机）并打印建议的 .env 变更（--dry-run 只做这一步）
 *   2) 若 --apply-field-rotate，调用 migrate-encrypt-fields.mjs --rotate 迁移字段密文
 *   3) 对备份密钥变更给出明确风险提示，不自动改（避免旧备份变砖）
 *
 * 用法：
 *   node scripts/rotate-secrets.mjs                       # 预演：生成新密钥 + 打印变更计划
 *   node scripts/rotate-secrets.mjs --key jwt             # 只轮换 JWT（默认全部）
 *   node scripts/rotate-secrets.mjs --apply-field-rotate  # 实际执行字段密文迁移（需先配好新旧密钥）
 *
 * 注意：本脚本不直接改 .env（避免误操作），只打印建议值；字段密文迁移需你先把新密钥
 *       写入 .env 的 *_PREVIOUS 与主密钥位后再执行。
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };
const has = (n) => argv.includes('--' + n);
const KEY = arg('key', 'all');
const APPLY_FIELD = has('apply-field-rotate');
const newKey = () => crypto.randomBytes(32).toString('base64url');

const ALL = ['jwt', 'sign', 'data', 'backup'];
const targets = KEY === 'all' ? ALL : [KEY];
if (!ALL.includes(KEY)) {
  console.error(`[失败] --key 仅支持：${ALL.join(' / ')} / all`);
  process.exit(1);
}

console.log('=== 密钥轮换计划 ===');
console.log('以下为新密钥建议值（请写入 server/.env 对应位置，勿提交）：\n');
const generated = {};
for (const k of targets) {
  if (k === 'jwt') {
    generated.JWT_SECRET_PREVIOUS = process.env.JWT_SECRET || '(原 JWT_SECRET)';
    generated.JWT_SECRET = newKey();
    console.log(`JWT_SECRET_PREVIOUS=${generated.JWT_SECRET_PREVIOUS}`);
    console.log(`JWT_SECRET=${generated.JWT_SECRET}`);
    console.log('  → 旧 token 靠 PREVIOUS 平滑验证；确认无旧 token 后再清空 PREVIOUS。\n');
  } else if (k === 'sign') {
    generated.SIGN_SECRET = newKey();
    console.log(`SIGN_SECRET=${generated.SIGN_SECRET}`);
    console.log('  → 轮换后旧签章验签失败；如需保留旧签章，请业务侧先归档。\n');
  } else if (k === 'data') {
    generated.DATA_ENCRYPT_KEY_PREVIOUS = process.env.DATA_ENCRYPT_KEY || process.env.SECRETS_MASTER_KEY || process.env.JWT_SECRET || '(原主密钥)';
    generated.DATA_ENCRYPT_KEY = newKey();
    console.log(`DATA_ENCRYPT_KEY_PREVIOUS=${generated.DATA_ENCRYPT_KEY_PREVIOUS}`);
    console.log(`DATA_ENCRYPT_KEY=${generated.DATA_ENCRYPT_KEY}`);
    console.log('  → 写入后执行：node scripts/migrate-encrypt-fields.mjs --rotate（把旧密钥密文迁到新密钥）。\n');
  } else if (k === 'backup') {
    generated.BACKUP_ENCRYPT_KEY = newKey();
    console.log(`BACKUP_ENCRYPT_KEY=${generated.BACKUP_ENCRYPT_KEY}`);
    console.log('  → 高危：变更后所有旧加密备份无法解密！建议先解密归档旧备份，或保留旧密钥。\n');
  }
}

if (!APPLY_FIELD) {
  console.log('=== 预演完成（未改 .env、未迁移数据）===');
  console.log('正式流程：① 把上面新值写入 .env → ② 若是 data，加 --apply-field-rotate 重加密 → ③ 重启服务。');
  process.exit(0);
}

if (!targets.includes('data')) {
  console.log('[提示] --apply-field-rotate 仅对 data 密钥有效，本次未包含 data，跳过迁移。');
  process.exit(0);
}

// 实际执行字段密文迁移：用同一个 Node 运行迁移脚本（迁移脚本会读 .env 里的新旧密钥）
console.log('\n=== 执行字段密文迁移 ===');
console.log('请先确认 .env 已写入上面的 DATA_ENCRYPT_KEY / DATA_ENCRYPT_KEY_PREVIOUS。');
const node = process.execPath;
const script = path.join(__dirname, 'migrate-encrypt-fields.mjs');
const r = spawnSync(node, [script, '--rotate'], { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
if (r.status !== 0) {
  console.error('[失败] 字段密文迁移未成功，请检查 .env 密钥配置后重试。');
  process.exit(r.status || 1);
}
console.log('✓ 字段密文迁移完成。');
