#!/usr/bin/env node
/**
 * 一致性门禁：把"新增菜单忘了同步导览 / 字典漏 key / 路由悬挂"这类人工约定变成自动检查。
 *
 * 检查项：
 *   1) SIDE_MENUS 的 path 在 router.ts 中存在对应路由（悬挂菜单）
 *   2) SIDE_MENUS 与 LOGIN_MODULES 的功能项同步（避开"工作台/消息中心"等专属页）
 *   3) zh-CN / en-US 字典 key 集合一致（防 _ctx.t is not a function 白屏）
 *   4) 源码中 t('xxx') / $t('xxx') 引用的 key 在字典中有定义
 *   5) router.ts 里 import 的 .vue 文件真实存在
 *
 * 用法：node scripts/check-consistency.mjs [--json]
 * 退出码：0=全通过；1=有 ERROR；有 WARN 但无 ERROR 仍返回 0。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');
const CONFIG = path.join(WEB_SRC, 'config.ts');
const ROUTER = path.join(WEB_SRC, 'router.ts');
const I18N = path.join(WEB_SRC, 'i18n', 'index.ts');
const AS_JSON = process.argv.includes('--json');

const errors = [];
const warns = [];
const err = (msg) => errors.push(msg);
const warn = (msg) => warns.push(msg);

/** 提取 export const NAME = [...] 的顶层数组文本（按方括号配平，跳过字符串内括号） */
function extractArray(text, name) {
  const m = text.match(new RegExp(`export\\s+const\\s+${name}\\s*=\\s*\\[`));
  if (!m) throw new Error(`未找到 export const ${name}`);
  let i = m.index + m[0].length - 1;
  let depth = 0, quote = null;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (depth === 0) return text.slice(m.index + m[0].length - 1, i + 1); }
  }
  throw new Error(`${name} 数组未闭合`);
}

/** 从数组文本中提取对象字段（宽松匹配，适合 TS 对象字面量） */
function extractObjects(arrText) {
  const out = [];
  // 每个顶层 { ... } 为一个对象
  let depth = 0, quote = null, start = -1;
  for (let i = 0; i < arrText.length; i++) {
    const ch = arrText[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) { out.push(arrText.slice(start, i + 1)); start = -1; }
    }
  }
  return out.map((s) => {
    const obj = {};
    for (const key of ['name', 'path', 'title', 'id']) {
      const km = s.match(new RegExp(`(?:^|[,{]\\s*)${key}\\s*:\\s*['"]([^'"]+)['"]`));
      if (km) obj[key] = km[1];
    }
    return obj;
  }).filter((o) => Object.keys(o).length);
}

/** 从 i18n 的某个 locale 块提取字典 key */
function extractDictKeys(text, locale) {
  const m = text.match(new RegExp(`['"]${locale}['"]\\s*:\\s*\\{`));
  if (!m) throw new Error(`i18n 缺少语言块 ${locale}`);
  let i = m.index + m[0].length - 1;
  let depth = 0, quote = null;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(m.index + m[0].length - 1, i + 1); }
  }
  throw new Error(`${locale} 字典块未闭合`);
}

const keyRe = /['"]([^'"]+)['"]\s*:/g;
function keysOf(block) {
  const keys = new Set(); let m;
  keyRe.lastIndex = 0;
  while ((m = keyRe.exec(block))) keys.add(m[1]);
  return keys;
}

/** 递归收集前端源码文件（排除 node_modules/dist） */
function collect(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) collect(full, out);
    else if (/\.(ts|vue)$/.test(name)) out.push(full);
  }
  return out;
}

function main() {
  const configText = fs.readFileSync(CONFIG, 'utf8');
  const routerText = fs.readFileSync(ROUTER, 'utf8');
  const i18nText = fs.readFileSync(I18N, 'utf8');

  const menus = extractObjects(extractArray(configText, 'SIDE_MENUS'));
  const loginModules = extractObjects(extractArray(configText, 'LOGIN_MODULES'));

  // ---- 1) 菜单 path ↔ 路由 ----
  // 收集 children 里的 path（相对路径拼到根 '/'），以及顶层路由 path
  const routePaths = new Set(['/']);
  const allRoutePaths = [...routerText.matchAll(/path\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
  for (const p of allRoutePaths) {
    if (p.startsWith('/')) routePaths.add(p);
    else routePaths.add('/' + p.replace(/^\//, ''));
  }
  // 重定向路由（如 system/users）也视为存在
  for (const menu of menus) {
    if (!menu.path) { warn(`SIDE_MENUS 存在无 path 项：${JSON.stringify(menu)}`); continue; }
    if (!routePaths.has(menu.path)) err(`SIDE_MENUS 菜单 "${menu.name}" 的 path=${menu.path} 在 router.ts 中无对应路由（悬挂菜单）`);
  }

  // ---- 2) 菜单 ↔ 导览同步 ----
  // 约定：新增"功能菜单"必须同步 LOGIN_MODULES。用 tomato 集合排除明显的专属/个人页。
  const EXEMPT_MENU_NAMES = new Set(['工作台', '消息中心', '操作日志', '个人中心', '修改密码', '安全设置', '公共组件', '系统监控', '配置中心', '定时任务', '接口文档', '文件服务', '消息通道', '基础数据', '组件文档', '系统管理']);
  const loginNames = new Set(loginModules.map((x) => x.name));
  for (const menu of menus) {
    if (!menu.name || EXEMPT_MENU_NAMES.has(menu.name)) continue;
    if (!loginNames.has(menu.name)) err(`SIDE_MENUS 新增菜单 "${menu.name}" 未同步到 LOGIN_MODULES（项目约定：新增功能菜单必须同步登录页导览）`);
  }
  // 说明：LOGIN_MODULES 是"平台能力导览"，名称是能力描述（如"用户管理/角色权限"），
  // 与 SIDE_MENUS 的路由名本就不一一对应，故不做反向逐项比对（否则全是误报）。

  // ---- 3) 字典 key 一致性 ----
  const zh = keysOf(extractDictKeys(i18nText, 'zh-CN'));
  const en = keysOf(extractDictKeys(i18nText, 'en-US'));
  for (const k of zh) if (!en.has(k)) err(`i18n en-US 缺少 key "${k}"`);
  for (const k of en) if (!zh.has(k)) err(`i18n zh-CN 缺少 key "${k}"`);

  // ---- 4) t() 引用 key 有定义 ----
  const tRefs = new Map(); // key -> [file]
  const tRe = /(?:^|[^.])\b(?:t|\$t)\(\s*['"]([^'"]+)['"]/g;
  for (const file of collect(WEB_SRC)) {
    if (file === I18N) continue;
    const txt = fs.readFileSync(file, 'utf8');
    let m;
    tRe.lastIndex = 0;
    while ((m = tRe.exec(txt))) {
      if (!tRefs.has(m[1])) tRefs.set(m[1], []);
      tRefs.get(m[1]).push(path.relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
  for (const [key, files] of tRefs) {
    if (!zh.has(key) && !en.has(key)) err(`源码引用了未定义的 i18n key "${key}"（${[...new Set(files)].slice(0, 3).join(', ')}）`);
  }

  // ---- 5) router 导入的 .vue 存在 ----
  const importRe = /import\s+\w+\s+from\s+['"](\.[^'"]+\.vue)['"]/g;
  for (const m of routerText.matchAll(importRe)) {
    const target = path.resolve(path.dirname(ROUTER), m[1]);
    if (!fs.existsSync(target)) err(`router.ts 导入的组件不存在：${m[1]}`);
  }

  return { menus: menus.length, loginModules: loginModules.length, i18nKeys: zh.size, tRefs: tRefs.size };
}

let stats;
try { stats = main(); }
catch (e) { err(`检查脚本执行失败：${e.message}`); }

if (AS_JSON) {
  console.log(JSON.stringify({ ok: errors.length === 0, errors, warns, stats }, null, 2));
} else {
  console.log('=== 一致性门禁 ===');
  if (stats) console.log(`菜单 ${stats.menus} / 导览 ${stats.loginModules} / i18n key ${stats.i18nKeys} / t() 引用 ${stats.tRefs}`);
  for (const w of warns) console.log('  ⚠ WARN  ' + w);
  for (const e of errors) console.log('  ✗ ERROR ' + e);
  if (!errors.length) console.log('✓ 全部通过（菜单/导览同步、路由悬挂、i18n key、t() 引用、组件导入）');
}
process.exit(errors.length ? 1 : 0);
