#!/usr/bin/env node
/**
 * 依赖安全门禁：包装 npm audit，按严重度阈值决定通过/失败，供 CI 调用。
 * 与 SECURITY.md 的基线记录配套：可临时用 --allow-list 豁免已知且已评估的漏洞。
 *
 * 用法：
 *   node scripts/check-audit.mjs                          # 默认：high 及以上失败
 *   node scripts/check-audit.mjs --level critical         # 仅 critical 失败
 *   node scripts/check-audit.mjs --level moderate         # moderate 及以上失败（更严）
 *   node scripts/check-audit.mjs --allow-list xlsx        # 豁免指定包名（逗号分隔）
 *   node scripts/check-audit.mjs --omit dev               # 只查生产依赖（等价 --omit=dev）
 *
 * 说明：直接调用系统 npm（非包装脚本），通过 spawnSync 执行；不改动任何安全配置。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };
const LEVEL = arg('level', 'high');
const ALLOW = arg('allow-list', '').split(',').map((s) => s.trim()).filter(Boolean);
const OMIT = argv.includes('--omit') ? arg('omit', 'dev') : '';
const ORDER = { low: 1, moderate: 2, high: 3, critical: 4 };
if (!ORDER[LEVEL]) { console.error(`[失败] --level 仅支持 low/moderate/high/critical`); process.exit(1); }

// 用 npm 原生命令生成 JSON 报告（npm 自身决定审计逻辑，本脚本只做阈值判定）
const npmArgs = ['audit', '--json', '--audit-level=low'];
if (OMIT) npmArgs.push(`--omit=${OMIT}`);
const r = spawnSync('npm', npmArgs, { cwd: SERVER, encoding: 'utf8', timeout: 120000 });
if (r.error) {
  console.error('[失败] 无法执行 npm audit：' + r.error.message);
  process.exit(1);
}
let report;
try { report = JSON.parse(r.stdout || '{}'); }
catch {
  console.error('[失败] npm audit 输出无法解析为 JSON');
  console.error((r.stderr || r.stdout || '').slice(0, 500));
  process.exit(1);
}

const vulnerabilities = report.vulnerabilities || report.advisories || {};
const rows = [];
for (const [name, v] of Object.entries(vulnerabilities)) {
  if (ALLOW.includes(name)) continue;
  const sev = String(v.severity ?? '').toLowerCase() || 'unknown';
  const rank = ORDER[sev] || 0;
  if (rank >= ORDER[LEVEL]) rows.push({ name, severity: sev, via: (v.via || []).length });
}
rows.sort((a, b) => (ORDER[b.severity] || 0) - (ORDER[a.severity] || 0));

console.log('=== 依赖安全门禁 ===');
console.log(`审计范围：${OMIT ? '仅生产依赖' : '全部依赖'}；阈值：${LEVEL} 及以上；豁免：${ALLOW.join(', ') || '无'}`);
const meta = report.metadata?.vulnerabilities || {};
console.log(`npm 报告合计：critical=${meta.critical ?? 0} high=${meta.high ?? 0} moderate=${meta.moderate ?? 0} low=${meta.low ?? 0}`);
if (rows.length) {
  for (const x of rows) console.log(`  ✗ ${x.severity.padEnd(8)} ${x.name}（${x.via} 条公告）`);
  console.log(`\n✗ ${rows.length} 个依赖达到失败阈值`);
  process.exit(1);
}
console.log('✓ 无依赖达到失败阈值');
