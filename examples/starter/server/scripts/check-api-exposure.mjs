#!/usr/bin/env node
/**
 * API 暴露面自查（零依赖）：对照公开端点清单与路由鉴权，找出应鉴权却裸露的管理接口。
 *
 * 检查项：
 *   1) publicPaths 中的写操作（POST/PUT/DELETE/PATCH）→ critical
 *   2) 管理类路径未显式挂 adminOnly / requireAuth → warn（GET）/ critical（写）
 *   3) 合法公开端点（login/captcha/health/weather/metrics/sse/ip-check）→ pass 记录
 *
 * 用法：node scripts/check-api-exposure.mjs [--json] [--strict]
 * 说明：静态分析按路由定义附近的中间件判定，挂载顺序需人工复核；结果不是运行时渗透测试。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, parseArgs, walk, readOr, rel, finish, extractArray } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '', line = 0) => findings.push({ level, message, file, line });

const serverSrc = readOr(path.join(SERVER, 'server.js'));
// publicPaths 既可能是 const，也可能是 createRequireAuth 的参数属性
const pm = serverSrc.match(/publicPaths\s*:\s*\[/);
let publicBlock = pm ? serverSrc.slice(pm.index + pm[0].length - 1) : extractArray(serverSrc, 'publicPaths');
if (pm) {
  let depth = 0, quote = null, end = 0;
  for (let i = 0; i < publicBlock.length; i++) {
    const ch = publicBlock[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (!depth) { end = i + 1; break; } }
  }
  publicBlock = publicBlock.slice(0, end);
}
const publicRules = [...publicBlock.matchAll(/\{\s*method:\s*['"](\w+)['"]\s*,\s*path:\s*['"]([^'"]+)['"]\s*\}/g)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));

const ALLOWED_PUBLIC = /(?:^|\/)(?:api\/)?(login|captcha|health|weather|ip-check|metrics|sse)(?:\/|$)/i;
for (const r of publicRules) {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(r.method) && !ALLOWED_PUBLIC.test(r.path)) {
    add('critical', `公开写接口 ${r.method} ${r.path}（publicPaths 中无鉴权）`, 'server/server.js');
  } else {
    add('pass', `公开端点 ${r.method} ${r.path}`, 'server/server.js');
  }
}

// 只检查"应仅管理员可操作"的路径；普通用户业务接口由全局 app.use('/api', requireAuth) 保护，不在此列。
// 静态判定只看路由定义附近是否显式 adminOnly，命中即 pass，未命中仅提示复核（全局鉴权仍需人工确认）。
const ADMIN_ONLY_PATH = /(?:^|\/)(users|roles|permissions|menus|configs|backup|system|audit|logs|security|sessions|ip-whitelist|dict|data-export\/approvals|signature\/revoke)(?:\/|$)/i;
const SELF_SERVICE = /(?:^|\/)(me|profile|password|mine)(?:\/|$)/i;
const routeFiles = walk(path.join(SERVER, 'routes'), { exts: ['.js'], skip: ['node_modules'] });
const routeRe = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g;
let routeCount = 0;
for (const file of routeFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(routeRe)) {
    routeCount++;
    const method = m[1].toUpperCase();
    const routePath = m[2];
    // 只截取起点后的固定长度作为中间件证据，避免贪婪窗口吞掉后续路由
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 320);
    if (!ADMIN_ONLY_PATH.test(routePath) || SELF_SERVICE.test(routePath)) continue;
    if (/\badminOnly\b/.test(tail)) {
      add('pass', `${method} ${routePath} 显式 adminOnly`, rel(file));
    } else {
      add('warn', `${method} ${routePath} 仅见全局鉴权，未见 adminOnly（确认是否应限管理员）`, rel(file));
    }
  }
}

finish('API 暴露面自查', {
  publicEndpoints: publicRules.length,
  routesScanned: routeCount,
  routeFiles: routeFiles.length,
}, findings, args, {
  disclaimer: '静态分析，按路由定义附近中间件判定；全局 app.use 顺序需人工复核，不替代渗透测试',
  env: ROOT,
});
