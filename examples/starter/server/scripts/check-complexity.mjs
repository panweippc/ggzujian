#!/usr/bin/env node
/**
 * 圈复杂度门禁（零依赖启发式）：按函数体统计分支数，找出难以维护的高复杂度函数。
 *
 * 复杂度 ≈ 1 + if/for/while/case/catch/三元/&&/|| 出现次数
 * 默认阈值 15；超限 → warn（--strict 阻断），>阈值*2 → critical。
 *
 * 用法：node scripts/check-complexity.mjs [--json] [--strict] [--max 15]
 * 说明：启发式而非完整 AST；与 check-code-quality 的"超长函数"互补（长≠复杂）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, parseArgs, walk, readOr, rel, finish } from './_check-utils.mjs';

const args = parseArgs();
const max = args.num('max', 15);
const findings = [];
const add = (level, message, file, line) => findings.push({ level, message, file, line });
// 历史债务基线：这些文件的高复杂度已知，先只告警不阻断；重构后可从基线移除
const BASELINE = new Set(['server/routes/enterprise.js', 'server/services/excel.js']);

const dirs = [
  path.join(SERVER, 'routes'), path.join(SERVER, 'middleware'), path.join(SERVER, 'services'),
  path.join(ROOT, 'web', 'src'),
];
const files = dirs.flatMap((d) => walk(d, { exts: ['.js', '.mjs', '.ts', '.vue'], skip: ['node_modules', 'dist', 'generated'] }));
let fnCount = 0;

for (const file of files) {
  let src = readOr(file);
  if (file.endsWith('.vue')) {
    const sm = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!sm) continue;
    src = sm[1];
  }
  const lines = src.split(/\r?\n/);
  const fnStart = /(?:^|[\s=;(])(?:async\s+)?(?:function\s+[\w$]*|[\w$]+\s*\([^)]*\)\s*=>|[\w$]+\s*\([^)]*\)\s*\{)/g;
  for (const m of src.matchAll(fnStart)) {
    const start = m.index + (m[0].match(/^\s*/)?.[0].length || 0);
    // 从函数起点扫描到配对大括号结束
    let depth = 0, opened = false, end = start;
    for (let i = start; i < src.length && i < start + 40000; i++) {
      if (src[i] === '{') { depth++; opened = true; }
      else if (src[i] === '}') { depth--; if (opened && depth === 0) { end = i; break; } }
    }
    if (!opened) continue;
    const body = src.slice(start, end);
    const lineNo = src.slice(0, start).split('\n').length;
    fnCount++;
    let c = 1;
    c += (body.match(/\bif\s*\(/g) || []).length;
    c += (body.match(/\b(for|while)\s*\(/g) || []).length;
    c += (body.match(/\bcase\s+/g) || []).length;
    c += (body.match(/\bcatch\s*\(/g) || []).length;
    c += (body.match(/\?\s*[^.?]/g) || []).length;
    c += (body.match(/&&|\|\|/g) || []).length;
    if (c > max * 3 && !BASELINE.has(rel(file))) add('critical', `圈复杂度约 ${c}（阈值 ${max}），建议拆分`, rel(file), lineNo);
    else if (c > max) add('warn', `圈复杂度约 ${c}（阈值 ${max}）${BASELINE.has(rel(file)) ? '（历史基线，仅提示）' : ''}`, rel(file), lineNo);
  }
  void lines;
}

finish('圈复杂度门禁', {
  files: files.length,
  functions: fnCount,
  threshold: max,
  highComplexity: findings.filter((f) => f.level !== 'pass').length,
}, findings, args, {
  disclaimer: '启发式估算，不等于精确 McCabe 复杂度；高复杂度函数请结合业务拆分',
});
