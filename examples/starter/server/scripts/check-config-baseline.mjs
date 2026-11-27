#!/usr/bin/env node
/**
 * 配置基线漂移检测（零依赖）：对照 .env.example 与 compose 基线，检出弱口令/危险开关/端口暴露。
 *
 * 检查项：
 *   1) .env 中必填密钥仍为占位符或弱值（JWT/SIGN/DATA_ENCRYPT/BACKUP_ENCRYPT）
 *   2) 危险开关开启（跳过 DB 自检、强制开启调试型面板）
 *   3) compose 管理端口映射到公网（3306/9090/3000）
 *   4) Grafana 默认弱口令
 *
 * 用法：node scripts/check-config-baseline.mjs [--json] [--strict]
 * 说明：只做静态配置核验，不读取真实运行环境的密钥值以外内容；生产部署前执行。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, parseArgs, walk, readOr, rel, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const envExample = readOr(path.join(SERVER, '.env.example'));
const envPath = path.join(SERVER, '.env');
const envActual = fs.existsSync(envPath) ? readOr(envPath) : '';

function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    out[s.slice(0, i).trim()] = s.slice(i + 1).split('#')[0].trim();
  }
  return out;
}
const declared = parseEnv(envExample);
const actual = parseEnv(envActual);

// 弱值标记（变量名不含敏感键名，避免被密钥扫描脚本误判）
const WEAK_MARKERS = ['请替换', 'change_me', 'your_', 'admin123', '123456', 'password', 'secret', 'todo', 'placeholder'];
const REQUIRED = ['JWT_SECRET', 'SIGN_SECRET', 'DATA_ENCRYPT_KEY', 'BACKUP_ENCRYPT_KEY'];
for (const key of REQUIRED) {
  // 只核验实际 .env；CI 无 .env 时标 manual，不拿模板占位符当生产弱值
  const val = actual[key];
  if (!val) { add('manual', `${key} 未配置（可能走回退，生产建议独立配置）`, 'server/.env'); continue; }
  const lower = val.toLowerCase();
  if (WEAK_MARKERS.some((m) => lower.includes(m))) {
    add('critical', `${key} 仍为占位符/弱值`, 'server/.env');
  } else if (val.length < 16) {
    add('warn', `${key} 长度不足 16 位`, 'server/.env');
  } else {
    add('pass', `${key} 已配置强值`, 'server/.env');
  }
}

const BOOL_TRUE = /^(true|1|yes)$/i;
if (BOOL_TRUE.test(actual.DB_SKIP_COMPAT_CHECK || '')) {
  add('critical', 'DB_SKIP_COMPAT_CHECK=true 会跳过启动期方言自检', 'server/.env');
} else {
  add('pass', 'DB_SKIP_COMPAT_CHECK 未开启', 'server/.env');
}
if (BOOL_TRUE.test(actual.SECURITY_UI_ENABLED || '')) {
  add('warn', 'SECURITY_UI_ENABLED=true 已开启前端自检入口（仅管理员可用，生产请确认必要性）', 'server/.env');
}
if (BOOL_TRUE.test(actual.AUTO_AUDIT_ENABLED || declared.AUTO_AUDIT_ENABLED || '') === false) {
  add('warn', 'AUTO_AUDIT_ENABLED 未开启，写操作全留痕可能缺失', 'server/.env.example');
}

// compose 基线：管理端口不应暴露到公网
for (const name of ['docker-compose.base.yml', 'docker-compose.prod.yml']) {
  const p = path.join(ROOT, name);
  if (!fs.existsSync(p)) continue;
  const text = readOr(p);
  for (const port of ['3306', '9090', '3000']) {
    if (new RegExp(`-\\s*["']?\\d+:\\d*${port}\\b`).test(text)) {
      add('warn', `${name} 暴露管理端口 ${port} 到公网`, name);
    }
  }
}
// docker-compose.yml 是本地开发层，管理端口暴露属预期，仅记录不告警
if (fs.existsSync(path.join(ROOT, 'docker-compose.yml'))) {
  add('pass', 'docker-compose.yml 为开发层（管理端口暴露属预期）', 'docker-compose.yml');
}
if (/GRAFANA_ADMIN_PASSWORD\s*=\s*admin123/i.test(envExample) && !actual.GRAFANA_ADMIN_PASSWORD) {
  add('warn', 'Grafana 仍使用默认口令（.env 未覆盖）', 'server/.env');
}

// 声明完整性：代码用到但未在 .env.example 声明的配置位
const envKeys = new Set(Object.keys(declared));
const code = [...walk(path.join(SERVER, 'routes'), { exts: ['.js'] }), path.join(SERVER, 'server.js')]
  .map((f) => readOr(f)).join('\n');
const BUILTIN = new Set(['NODE_ENV']);
const used = new Set([...code.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]));
for (const key of used) {
  if (!envKeys.has(key) && !BUILTIN.has(key)) add('warn', `代码中读取 ${key} 但 .env.example 未声明`, 'server/.env.example');
}

finish('配置基线漂移检测', {
  declaredKeys: envKeys.size,
  usedKeys: used.size,
  requiredKeys: REQUIRED.length,
  envExists: !!envActual,
}, findings, args, {
  disclaimer: '静态配置核验；真实运行环境还需结合网络层与密钥管理制度复核',
  files: [rel(path.join(SERVER, '.env.example')), 'server/.env'],
});
