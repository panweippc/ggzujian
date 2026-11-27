/**
 * 检测脚本公共工具（零依赖）：参数解析、文件收集、统一输出与退出码。
 * 12 项自动化检测共用本模块，保证 --json / --strict / 退出码口径一致。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVER = path.resolve(HERE, '..');
export const ROOT = path.resolve(SERVER, '..');
export const WEB = path.join(ROOT, 'web');

/** 解析 process.argv：--json / --strict / --key value */
export function parseArgs(argv = process.argv.slice(2)) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) values[argv[i].slice(2)] = next;
  }
  return {
    json: flags.has('--json'),
    strict: flags.has('--strict'),
    dryRun: flags.has('--dry-run'),
    has: (k) => flags.has('--' + k),
    val: (k, d) => values[k] ?? d,
    num: (k, d) => Number(values[k]) || d,
  };
}

/** 递归收集文件 */
export function walk(dir, { exts, skip = [], maxDepth = 12 } = {}) {
  const out = [];
  const go = (d, depth) => {
    if (depth > maxDepth || !fs.existsSync(d)) return;
    for (const name of fs.readdirSync(d)) {
      if (skip.includes(name)) continue;
      const full = path.join(d, name);
      if (fs.statSync(full).isDirectory()) { go(full, depth + 1); continue; }
      if (exts && !exts.some((e) => name.endsWith(e))) continue;
      out.push(full);
    }
  };
  go(dir, 0);
  return out;
}

export const rel = (p) => path.relative(ROOT, p).replace(/\\/g, '/');
export const readOr = (p, fallback = '') => {
  try { return fs.readFileSync(p, 'utf8'); } catch { return fallback; }
};

/**
 * 统一结果输出与退出码。
 * findings: { level: 'critical'|'warn'|'manual'|'pass', ... }
 * 默认仅 critical 失败；--strict 时 warn/manual 也失败。
 */
export function finish(name, summary, findings, args, extra = {}) {
  const counts = findings.reduce((a, f) => { a[f.level] = (a[f.level] || 0) + 1; return a; }, {});
  const failed = (counts.critical || 0) > 0 || (args.strict && ((counts.warn || 0) + (counts.manual || 0)) > 0);
  const payload = { name, ok: !failed, summary, counts, findings, ...extra };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(`=== ${name} ===`);
    console.log(`critical ${counts.critical || 0} / warn ${counts.warn || 0} / manual ${counts.manual || 0} / pass ${counts.pass || 0}`);
    for (const f of findings) {
      const mark = { critical: '✗', warn: '⚠', manual: '?', pass: '✓' }[f.level] || ' ';
      const where = f.file ? `${f.file}${f.line ? ':' + f.line : ''} ` : '';
      console.log(`  ${mark} ${where}${f.message || ''}`);
    }
    if (!failed) console.log(args.strict ? '✓ 严格模式通过' : '✓ 检查完成（默认仅 critical 阻断，--strict 连告警也阻断）');
  }
  // 不用 process.exit()：管道输出未刷新时会被截断，导致上游 JSON 解析失败
  process.exitCode = failed ? 1 : 0;
}

/** 从源码中抽取 SOME_CONST = [...] 的顶层数组文本 */
export function extractArray(text, name) {
  const m = text.match(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[`));
  if (!m) return '';
  let i = m.index + m[0].length - 1;
  let depth = 0, quote = null;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quote) { if (ch === '\\') { i++; continue; } if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth++;
    else if (ch === ']') { depth--; if (!depth) return text.slice(m.index, i + 1); }
  }
  return '';
}
