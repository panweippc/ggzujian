#!/usr/bin/env node
/**
 * 前后端接口契约交叉校验（零依赖）：前端 api.ts 调用路径对照后端实际路由。
 *
 * 检查项：
 *   1) 前端 api.get/post/put/delete 的静态路径在后端有对应路由
 *   2) 动态路径（/users/${id}）按前缀归一匹配（后端 :id）
 *   3) 前端路径含 /api 前缀但未归一 → warn
 *
 * 用法：node scripts/check-api-contract.mjs [--json] [--strict]
 * 说明：只校验路径存在性，不校验请求/响应字段；生成式路由需人工确认。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, WEB, parseArgs, walk, readOr, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const backend = new Set();
const routeFiles = [
  ...walk(path.join(SERVER, 'routes'), { exts: ['.js'], skip: ['node_modules', 'generated'] }),
  path.join(SERVER, 'server.js'),
];
for (const file of routeFiles) {
  const src = readOr(file);
  for (const m of src.matchAll(/(?:router|app)\.(?:get|post|put|delete|patch|use)\s*\(\s*['"]([^'"]+)['"]/g)) {
    let p = m[1].replace(/^\/api\//, '').replace(/^\//, '');
    if (p) backend.add(p.replace(/:[\w]+/g, '*').replace(/\/$/, ''));
  }
}
function matchBackend(p) {
  const base = p.replace(/\/$/, '');
  if (backend.has(base)) return true;
  for (const b of backend) {
    if (b.endsWith('*') && base.startsWith(b.slice(0, -1))) return true;
    if (base.startsWith(b + '/') && b !== '') return true;
  }
  return false;
}

const apiSrc = readOr(path.join(WEB, 'src', 'services', 'api.ts'));
const calls = [...apiSrc.matchAll(/api\.(get|post|put|delete)\s*\(\s*[`'"](\/[^`'"?$]+)/g)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));

const seen = new Set();
for (const call of calls) {
  const key = call.method + ' ' + call.path;
  if (seen.has(key)) continue;
  seen.add(key);
  const normalized = call.path.replace(/^\/api\//, '/').replace(/\/$/, '');
  if (call.path.startsWith('/api/')) add('warn', `${key} 前端重复写 /api 前缀`, 'web/src/services/api.ts');
  if (matchBackend(normalized.replace(/^\//, ''))) {
    add('pass', `${key} 后端存在对应路由`, 'web/src/services/api.ts');
  } else {
    add('warn', `${key} 后端未找到对应路由（确认是否为代理/生成接口）`, 'web/src/services/api.ts');
  }
}

finish('前后端接口契约校验', {
  backendRoutes: backend.size,
  frontendCalls: seen.size,
  missing: findings.filter((f) => /未找到对应路由/.test(f.message)).length,
}, findings, args, {
  disclaimer: '仅校验路径存在性，不覆盖请求/响应字段与 HTTP 方法语义',
});
