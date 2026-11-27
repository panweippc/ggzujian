#!/usr/bin/env node
/**
 * SQL 危险拼接扫描（零依赖）：检出字符串插值/拼接进入 SQL 语句的位置。
 *
 * 检查项：
 *   1) query/execute 调用首参含模板插值 ${...} → critical
 *   2) SQL 关键字字符串与变量用 + 拼接 → critical
 *   3) 动态 ORDER BY / LIMIT（即使有白名单）→ warn，需人工确认白名单完整
 *   4) 使用 ? 占位符的参数化调用 → pass 计数
 *
 * 用法：node scripts/check-sql-safety.mjs [--json] [--strict]
 * 说明：启发式静态扫描，不能替代代码审查；误报可在证据中人工排除。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, parseArgs, walk, rel, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file, line) => findings.push({ level, message, file, line });

const dirs = ['routes', 'middleware', 'services'].map((d) => path.join(SERVER, d));
const files = dirs.flatMap((d) => walk(d, { exts: ['.js'], skip: ['node_modules'] }));
let paramCalls = 0;
let dynamicSort = 0;

for (const file of files) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
    const r = rel(file);
    const ln = i + 1;

    // 插值内容：只有来自请求对象的才阻断；内部常量/固定片段视为可控
    const interpolations = [...line.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
    const fromRequest = interpolations.filter((x) => /\breq\b|\bquery\b|\bparams\b|\bbody\b|input/i.test(x));
    const SAFE_FRAGMENT = /^(?:[A-Z][A-Z0-9_]+|where|orderBy|clauses|sql|tableSql|setClause|fields|columns)$/i;
    const unknownFragment = interpolations.filter((x) => !SAFE_FRAGMENT.test(x));
    if (/\b(query|execute)\s*\(\s*[`'"][^`'"]*\$\{/.test(line)) {
      if (fromRequest.length) {
        add('critical', `SQL 插值来自请求对象：${fromRequest.join(', ')}`, r, ln);
      } else if (unknownFragment.length) {
        add('warn', `SQL 含未知插值：${unknownFragment.join(', ')}（确认来源）`, r, ln);
      } else {
        add('pass', 'SQL 插值为内部常量/固定片段（值走 ? 参数化）', r, ln);
      }
    }
    if (/\b(SELECT|INSERT|UPDATE|DELETE)\b[\s\S]{0,200}\+\s*[A-Za-z_$][\w$]*/.test(line) &&
        /['"`]/.test(line) && !line.includes('//')) {
      const joined = line.match(/\+\s*([A-Za-z_$][\w$]*)/g)?.map((s) => s.replace(/\+\s*/, '')) || [];
      if (joined.some((v) => /\breq\b|query|params|body|input/i.test(v))) {
        add('critical', `SQL 字符串拼接请求对象：${joined.join(', ')}`, r, ln);
      } else {
        add('warn', `SQL 字符串拼接变量：${joined.join(', ')}（确认是否来自白名单）`, r, ln);
      }
    }
    if (/\b(ORDER\s+BY|LIMIT|GROUP\s+BY)\b[\s\S]{0,80}\$\{/.test(line)) {
      dynamicSort++;
      if (fromRequest.length) add('critical', `排序/分页插值来自请求对象：${fromRequest.join(', ')}`, r, ln);
      else add('warn', '动态 ORDER BY / LIMIT，需确认列名/数值来自白名单', r, ln);
    }
    if (/\b(query|execute)\s*\([^)]*\?/.test(line)) paramCalls++;
  });
}

finish('SQL 危险拼接扫描', {
  files: files.length,
  parameterizedCalls: paramCalls,
  dynamicSortOrLimit: dynamicSort,
}, findings, args, {
  disclaimer: '零依赖启发式，无法替代完整 AST 与人工代码审查；误报请结合证据行确认',
});
