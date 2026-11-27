#!/usr/bin/env node
/**
 * TypeScript 严格度门禁（零依赖）：检查 tsconfig 严格开关与源码 any 使用密度。
 *
 * 检查项：
 *   1) web/tsconfig.json 存在且 strict / noImplicitAny / strictNullChecks 开启
 *   2) 源码中显式 : any / as any 的数量（超过 --max-any 阈值告警）
 *   3) 无 tsconfig 时明确标 manual，不静默通过
 *
 * 用法：node scripts/check-ts-strict.mjs [--json] [--strict] [--max-any 40]
 * 说明：本项目使用 Vue3 + TS，未开启严格模式不代表运行错误，但会放大重构风险。
 */
import fs from 'node:fs';
import path from 'node:path';
import { WEB, parseArgs, walk, readOr, finish } from './_check-utils.mjs';

const args = parseArgs();
const maxAny = args.num('max-any', 40);
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const tsconfigPath = path.join(WEB, 'tsconfig.json');
let cfg = null;
if (fs.existsSync(tsconfigPath)) {
  try {
    const raw = readOr(tsconfigPath).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    cfg = JSON.parse(raw);
  } catch (e) {
    add('warn', `tsconfig.json 解析失败：${e.message}`, 'web/tsconfig.json');
  }
  if (cfg) {
    const opts = cfg.compilerOptions || {};
    for (const key of ['strict', 'noImplicitAny', 'strictNullChecks']) {
      if (opts[key]) add('pass', `${key} 已开启`, 'web/tsconfig.json');
      else add(key === 'strict' ? 'warn' : 'manual', `${key} 未开启`, 'web/tsconfig.json');
    }
  }
} else {
  add('manual', 'web/tsconfig.json 不存在，无法核验严格度（Vite 可直接转译 TS，但类型检查缺失）', 'web/tsconfig.json');
}

const files = walk(path.join(WEB, 'src'), { exts: ['.ts', '.vue'], skip: ['node_modules', 'dist'] });
let anyCount = 0, fileWithAny = 0;
for (const file of files) {
  let src = readOr(file);
  if (file.endsWith('.vue')) {
    const sm = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!sm) continue;
    src = sm[1];
  }
  const n = ((src.match(/:\s*any\b/g) || []).length + (src.match(/\bas\s+any\b/g) || []).length);
  if (n) { anyCount += n; fileWithAny++; }
}
if (anyCount > maxAny) add('warn', `显式 any 共 ${anyCount} 处（阈值 ${maxAny}），建议逐步收敛`, 'web/src');
else add('pass', `显式 any ${anyCount} 处（阈值 ${maxAny}）`, 'web/src');

finish('TypeScript 严格度门禁', {
  tsconfigExists: !!cfg,
  files: files.length,
  explicitAny: anyCount,
  filesWithAny: fileWithAny,
  threshold: maxAny,
}, findings, args, {
  disclaimer: '显式 any 计数为启发式；类型安全最终仍需 tsc --noEmit 与严格配置',
});
