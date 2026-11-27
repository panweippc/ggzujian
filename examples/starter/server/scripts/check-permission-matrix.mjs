#!/usr/bin/env node
/**
 * 权限矩阵一致性（零依赖）：交叉比对前端路由白名单、前端 API 调用与后端 adminOnly 覆盖。
 *
 * 检查项：
 *   1) router.ts PUBLIC_AUTH_PATHS 包含管理类页面 → critical（普通用户可绕过）
 *   2) 前端调用的管理类 API 在后端未见 adminOnly → warn（确认是否仅需登录）
 *   3) 菜单未在 router.ts 注册 → warn
 *
 * 用法：node scripts/check-permission-matrix.mjs [--json] [--strict]
 * 说明：静态交叉校验，全局 app.use('/api', requireAuth) 已保证登录态；这里查的是"管理员专属"口径。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, WEB, parseArgs, walk, readOr, rel, finish, extractArray } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const routerSrc = readOr(path.join(WEB, 'src', 'router.ts'));
const configSrc = readOr(path.join(WEB, 'src', 'config.ts'));
const apiSrc = readOr(path.join(WEB, 'src', 'services', 'api.ts'));

const ADMIN_PAGE = /(?:^|\/)(system|security|config|logs|tasks|files|monitor|base-data|platform|ai-ops|low-code|security-check)(?:\/|$)/i;
const publicBlock = routerSrc.match(/PUBLIC_AUTH_PATHS\s*=\s*\[([^\]]+)\]/);
const publicPaths = publicBlock
  ? [...publicBlock[1].matchAll(/['"]([^'"]+)['"]/g)].map((m) => m[1].replace(/^\//, ''))
  : [];
for (const p of publicPaths) {
  if (ADMIN_PAGE.test(p)) add('critical', `管理页面 ${p} 在 PUBLIC_AUTH_PATHS 中（免 RBAC 校验）`, 'web/src/router.ts');
  else add('pass', `${p} 免权限路由属个人/引导页`, 'web/src/router.ts');
}

// 后端管理类路由是否声明 adminOnly
const ADMIN_API = /(?:^|\/)(users|roles|permissions|menus|configs|backup|system|audit|logs|security|sessions|ip-whitelist|dict|data-export\/approvals|signature\/revoke)(?:\/|$)/i;
const SELF_OR_BUSINESS = /(?:^|\/)(me|messages|observability|profile)(?:\/|$)/i;
const backend = new Map();
const routeFiles = [...walk(path.join(SERVER, 'routes'), { exts: ['.js'], skip: ['node_modules'] }), path.join(SERVER, 'server.js')];
for (const file of routeFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/g)) {
    const tail = src.slice(m.index + m[0].length, m.index + m[0].length + 320);
    backend.set(m[2].replace(/^\/api\//, '').replace(/^\//, ''), /adminOnly/.test(tail));
  }
}
// 前端模板字符串路径被截断为前缀（如 /configs/${key}），按前缀归一匹配
function findBackend(p) {
  if (backend.has(p)) return backend.get(p);
  const base = p.replace(/\/$/, '');
  for (const [bp, admin] of backend) {
    if (bp === base || bp.startsWith(base + '/') || bp.startsWith(p)) return admin;
  }
  return undefined;
}
const frontendCalls = [...apiSrc.matchAll(/api\.(get|post|put|delete)\s*\(\s*[`'"](\/[^`'"?$]+)/g)]
  .map((m) => ({ method: m[1].toUpperCase(), path: m[2].replace(/^\//, '') }));
for (const call of frontendCalls) {
  if (!ADMIN_API.test(call.path) || SELF_OR_BUSINESS.test(call.path)) continue;
  const admin = findBackend(call.path);
  if (admin === undefined) {
    add('warn', `前端调用 ${call.method} /${call.path}，后端未匹配到显式路由`, 'web/src/services/api.ts');
    continue;
  }
  if (admin) add('pass', `${call.method} /${call.path} 前后端均按管理员接口`, 'web/src/services/api.ts');
  else add('warn', `${call.method} /${call.path} 后端未见 adminOnly`, 'web/src/services/api.ts');
}

// 菜单路径是否在 router 中注册
const menus = extractArray(configSrc, 'SIDE_MENUS');
for (const m of menus.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g)) {
  const p = m[1].replace(/^\//, '');
  if (p && !routerSrc.includes(`path: '${p}'`) && !routerSrc.includes(`path: "${p}"`)) {
    add('warn', `菜单 /${p} 在 router.ts 中未注册`, 'web/src/config.ts');
  }
}

finish('权限矩阵一致性', {
  publicAuthPaths: publicPaths.length,
  backendAdminRoutes: [...backend.values()].filter(Boolean).length,
  frontendAdminCalls: frontendCalls.filter((c) => ADMIN_API.test(c.path) && !SELF_OR_BUSINESS.test(c.path)).length,
  backendRoutes: backend.size,
}, findings, args, {
  disclaimer: '静态交叉校验；全局 requireAuth 已保证登录态，adminOnly 缺失项需结合业务确认',
});
