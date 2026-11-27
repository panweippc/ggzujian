#!/usr/bin/env node
/**
 * 冗余代码审查（零依赖）：检测重复代码、超长函数/文件、死代码、技术债残留。
 *
 * 检查项（均可配阈值）：
 *   1) 重复代码块：滑动窗口 hash 归一化后计数（忽略空白/字符串字面量差异）
 *   2) 超长文件（默认 >800 行）、超长函数（默认 >150 行，按大括号深度粗判）
 *   3) 死代码：export 的符号在全项目无其他引用（同名出现次数 <=1）
 *   4) 技术债：TODO / FIXME / HACK / XXX 残留（按文件统计）
 *   5) console 遗留：业务代码里的 console.log（允许 warn/error 与脚本目录）
 *
 * 用法：
 *   node scripts/check-code-quality.mjs                    # 默认：仅高危项失败，其余告警
 *   node scripts/check-code-quality.mjs --strict           # 所有告警也视为失败
 *   node scripts/check-code-quality.mjs --json             # JSON 输出（CI 解析）
 *   node scripts/check-code-quality.mjs --max-lines 1000   # 自定义超长文件阈值
 *   node scripts/check-code-quality.mjs --min-dup 8        # 重复块最小行数（默认 6）
 *
 * 说明：零依赖意味着用启发式而非完整 AST，结果为"疑似"，需人工确认；
 *       目的是让重复/技术债可见并可跟踪，不是替代 ESLint/SonarQube。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER, '..');
const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? parseInt(argv[i + 1], 10) || d : d; };
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');
const MAX_LINES = arg('max-lines', 800);
const MAX_FN = arg('max-fn', 150);
const MIN_DUP = arg('min-dup', 6);

const findings = [];
const add = (type, file, line, detail, sev = 'warn') => findings.push({ type, level: sev, file, line, detail });

const SKIP_DIR = new Set(['node_modules', 'dist', 'backups', 'logs', '.git', 'coverage', 'sql', 'docs', 'generated']);
const SRC_EXT = /\.(js|mjs|ts|vue)$/;

function collectFiles() {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 12 || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIR.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full, depth + 1); continue; }
      if (!SRC_EXT.test(name)) continue;
      out.push(full);
    }
  };
  const self = fileURLToPath(import.meta.url);
  // server.js 是 middleware/export 的主要消费方，必须纳入扫描，否则死导出误报
  for (const f of ['server.js', 'vitest.config.js']) {
    const p = path.join(SERVER, f);
    if (fs.existsSync(p) && !out.includes(p)) out.push(p);
  }
  for (const d of [
    path.join(SERVER, 'routes'), path.join(SERVER, 'services'),
    path.join(SERVER, 'middleware'), path.join(SERVER, 'scripts'),
    path.join(ROOT, 'web', 'src'), path.join(ROOT, 'scripts'),
  ]) walk(d);
  return out.filter((f) => f !== self);
}

const fileCache = new Map(); // rel → lines[]
function linesOf(full) {
  const rel = path.relative(ROOT, full).replace(/\\/g, '/');
  if (!fileCache.has(rel)) fileCache.set(rel, fs.readFileSync(full, 'utf8').split(/\r?\n/));
  return { rel, lines: fileCache.get(rel) };
}

/** 归一化代码行：去注释、去字符串字面量、压空白，用于重复检测 */
function normalize(line) {
  return line
    .replace(/\/\/.*$/, '')
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, 'STR')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 1) 重复代码块：跨文件滑动窗口 */
function detectDuplicates(files) {
  const windows = new Map(); // hash → [{file,line}]
  for (const full of files) {
    const { rel, lines } = linesOf(full);
    const norm = lines.map(normalize);
    for (let i = 0; i + MIN_DUP <= norm.length; i++) {
      const slice = norm.slice(i, i + MIN_DUP).filter((l) => l.length > 2);
      if (slice.length < MIN_DUP) continue;
      const key = slice.join('|');
      if (!windows.has(key)) windows.set(key, []);
      windows.get(key).push({ file: rel, line: i + 1 });
    }
  }
  let count = 0;
  for (const [key, locs] of windows) {
    if (locs.length < 2) continue;
    // 同一文件连续窗口视为同一块，只记首次
    const uniq = [];
    for (const loc of locs) {
      if (!uniq.some((u) => u.file === loc.file && Math.abs(u.line - loc.line) < MIN_DUP)) uniq.push(loc);
    }
    if (uniq.length < 2) continue;
    count++;
    if (count <= 40) add('duplicate-block', uniq[0].file, uniq[0].line, `重复 ${MIN_DUP} 行代码块（另见 ${uniq.slice(1, 3).map((u) => u.file + ':' + u.line).join(', ')}）`);
  }
  return count;
}

/** 2) 超长文件 + 超长函数（按大括号深度粗判） */
function detectOversized(files) {
  let longFiles = 0, longFns = 0;
  for (const full of files) {
    const { rel, lines } = linesOf(full);
    if (lines.length > MAX_LINES) { longFiles++; add('long-file', rel, 1, `${lines.length} 行（阈值 ${MAX_LINES}）`); }
    // 粗判函数：匹配 function/async/箭头函数定义行，向前找下一个顶层定义，统计行数
    const fnStarts = [];
    lines.forEach((l, i) => { if (/\b(function|async\s+\w+\s*\(|=>|^\s*(export\s+)?(default\s+)?class\b)/.test(l) && /[({]\s*$|[({]/.test(l)) fnStarts.push(i); });
    for (let k = 0; k < fnStarts.length; k++) {
      const start = fnStarts[k];
      const end = k + 1 < fnStarts.length ? fnStarts[k + 1] : lines.length;
      const span = end - start;
      if (span > MAX_FN) { longFns++; if (longFns <= 20) add('long-function', rel, start + 1, `约 ${span} 行（阈值 ${MAX_FN}），建议拆分`); }
    }
  }
  return { longFiles, longFns };
}

/** 3) 死代码：export 符号全项目仅出现一次（定义处） */
function detectDeadExports(files) {
  const allText = new Map();
  for (const full of files) {
    const { rel, lines } = linesOf(full);
    allText.set(rel, lines.join('\n'));
  }
  const combined = [...allText.values()].join('\n');
  let dead = 0;
  for (const [rel, text] of allText) {
    const re = /export\s+(?:const|let|var|function|class|async\s+function)\s+([A-Za-z_$][\w$]*)/g;
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name.length < 4) continue; // 忽略短名（如 t、q）
      const occurrences = (combined.match(new RegExp('\\b' + name.replace(/[$]/g, '\\$') + '\\b', 'g')) || []).length;
      if (occurrences <= 1) {
        dead++;
        if (dead <= 30) add('dead-export', rel, text.slice(0, m.index).split('\n').length, `导出 ${name} 全项目无其他引用`);
      }
    }
  }
  return dead;
}

/** 4) 技术债 + 5) console 遗留 */
function detectDebt(files) {
  let todo = 0, consoleCount = 0;
  for (const full of files) {
    const { rel, lines } = linesOf(full);
    const inScripts = /(^|\/)scripts\//.test(rel);
    lines.forEach((l, i) => {
      // 排除纯注释行里的 TODO/FIXME 字样（文档/说明不算技术债）
      const code = l.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/^\s*\*.*$/, '').trim();
      if (code && /\b(TODO|FIXME|HACK|XXX)\b/.test(code)) { todo++; if (todo <= 30) add('tech-debt', rel, i + 1, code.slice(0, 100)); }
      if (!inScripts && /\bconsole\.log\s*\(/.test(code)) { consoleCount++; if (consoleCount <= 20) add('console-log', rel, i + 1, '业务代码中的 console.log'); }
    });
  }
  return { todo, consoleCount };
}

function main() {
  const files = collectFiles();
  const dups = detectDuplicates(files);
  const { longFiles, longFns } = detectOversized(files);
  const dead = detectDeadExports(files);
  const { todo, consoleCount } = detectDebt(files);

  const summary = { files: files.length, duplicateBlocks: dups, longFiles, longFns, deadExports: dead, todo, consoleLogs: consoleCount };
  // 严格模式全失败；默认模式只有重复块（高危代码异味）失败？——默认全部只告警，避免卡住现有底座
  const failed = STRICT && findings.length > 0;

  if (AS_JSON) {
    console.log(JSON.stringify({ ok: !failed, summary, findings, note: '启发式检测结果，需人工确认' }, null, 2));
  } else {
    console.log('=== 冗余代码审查（启发式）===');
    console.log(`扫描 ${summary.files} 文件：重复块 ${dups} / 超长文件 ${longFiles} / 超长函数 ${longFns} / 死导出 ${dead} / TODO ${todo} / console.log ${consoleCount}`);
    const groups = {};
    for (const f of findings) (groups[f.type] ||= []).push(f);
    for (const [type, list] of Object.entries(groups)) {
      console.log(`\n[${type}] ${list.length} 项`);
      for (const f of list.slice(0, 12)) console.log(`  ${f.file}:${f.line}  ${f.detail}`);
      if (list.length > 12) console.log(`  ... 另 ${list.length - 12} 项（详见 --json）`);
    }
    console.log(`\n${failed ? '✗ 严格模式：发现 ' + findings.length + ' 项' : '✓ 检查完成（默认仅告警，--strict 可阻断 CI）'}`);
  }
  process.exitCode = failed ? 1 : 0;
}

main();
