#!/usr/bin/env node
/**
 * 硬编码密钥扫描（零依赖）：检出源码中写死的口令/令牌/私钥/云密钥，防止密钥入库。
 *
 * 检查项：
 *   1) 高危模式：私钥块、云厂商 AK、JWT/Bearer 硬编码、数据库连接串带明文口令
 *   2) 赋值模式：password/secret/token/key 等变量被赋了字面量（非 process.env / 非占位符）
 *   3) 熵值检测：长随机串（疑似密钥）高熵告警
 *
 * 用法：
 *   node scripts/check-secrets.mjs              # 默认：高危项失败，可疑项仅告警
 *   node scripts/check-secrets.mjs --strict     # 可疑项也失败
 *   node scripts/check-secrets.mjs --json       # JSON 输出（供 CI 解析）
 *   node scripts/check-secrets.mjs --json --strict
 *
 * 设计：与 check-env 互补——check-env 查"配置位是否声明"，本脚本查"代码里是否写死"。
 * 白名单：测试文件、.env.example、占位符（your_/xxx/请替换/change_me）、示例域名。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const ROOT = path.resolve(SERVER, '..');
const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const STRICT = argv.includes('--strict');

const critical = [], suspicious = [];
const crit = (f, l, msg, snippet) => critical.push({ file: f, line: l, level: 'critical', msg, snippet });
const susp = (f, l, msg, snippet) => suspicious.push({ file: f, line: l, level: 'suspicious', msg, snippet });

// 占位符 / 示例值：不算硬编码
const PLACEHOLDER = /^(your[_-]?|xxx+|<.*>|请替换|change[_-]?me|todo|placeholder|example|sample|test[_-]?|dummy|fake|demo|123456|password|secret|admin123|strong[_-]?random|fill[_-]?me|here|key|token|value|string)$/i;
// 排除的目录与文件（自身、依赖、生成物、测试夹具）
const SKIP_DIR = new Set(['node_modules', 'dist', 'backups', 'logs', '.git', 'coverage', 'node_modules']);
const SKIP_FILE = /(^|\/)(tests?|__tests__|fixtures?|specs?)\/|\.test\.|\.spec\.|\.min\.|\.map$|\.env($|\.)|SECURITY\.md|check-secrets\.mjs/i;

/** 计算 Shannon 熵（0-8），用于识别高熵随机串 */
function entropy(s) {
  if (!s) return 0;
  const freq = {};
  for (const c of s) freq[c] = (freq[c] || 0) + 1;
  let h = 0;
  const n = s.length;
  for (const c in freq) { const p = freq[c] / n; h -= p * Math.log2(p); }
  return h;
}

/** 收集待扫描文件（server + web/src + 根目录脚本） */
function collectFiles() {
  const out = [];
  const walk = (dir, depth = 0) => {
    if (depth > 12 || !fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIR.has(name)) continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) { walk(full, depth + 1); continue; }
      const rel = path.relative(ROOT, full).replace(/\\/g, '/');
      if (SKIP_FILE.test(rel)) continue;
      if (!/\.(js|mjs|ts|vue|json|ya?ml|sh|properties)$/i.test(name)) continue;
      out.push(full);
    }
  };
  walk(SERVER);
  walk(path.join(ROOT, 'scripts'));
  walk(path.join(ROOT, '.github'));
  walk(path.join(ROOT, 'ci'));
  return out;
}

const HIGH_RISK = [
  { name: '私钥块', re: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: '阿里云 AK', re: /\bLTAI[A-Za-z0-9]{12,}\b/ },
  { name: 'JWT 字面量', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { name: '带口令的数据库连接串', re: /\b(mysql|postgres(ql)?|mongodb(\+srv)?):\/\/[^:\s/]+:[^@\s/]+@/i },
];

// 赋值模式：捕获「键名」与「字面量值」，键名是否敏感由下方 SENSITIVE_KEY 判定（区分大小写，排除全大写枚举）
const ASSIGN = /\b([A-Za-z][A-Za-z0-9_-]{2,40})\b\s*[:=]\s*['"]([^'"]{4,120})['"]/g;
const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?key|encryption[_-]?key|sign(?:ing)?[_-]?key)/i;
// 上下文白名单：解构/取值/正则/注释/配置读取不算
const SAFE_CONTEXT = /process\.env|import\.meta|\$\{|require\(|getenv|readFile|Buffer\.from|\/.*\/[gimsuy]*$|^\s*(\/\/|\*|#)/;

function scanFile(full) {
  const rel = path.relative(ROOT, full).replace(/\\/g, '/');
  const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    for (const { name, re } of HIGH_RISK) {
      if (re.test(line)) crit(rel, ln, `高危：${name}`, line.trim().slice(0, 160));
    }
    // 赋值模式（去掉注释后再判断更安全，但保留原文作 snippet）
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    for (const m of code.matchAll(ASSIGN)) {
      const key = m[1], val = m[2];
      if (!SENSITIVE_KEY.test(key)) continue;                    // 键名不含敏感词
      if (key === key.toUpperCase() && !key.includes('_')) continue; // 全大写枚举常量（如 SECRET / LEVEL_RISK 值）
      if (PLACEHOLDER.test(val)) continue;
      if (SAFE_CONTEXT.test(line)) continue;
      // 纯数字短值（如 port）不算
      if (/^\d{1,6}$/.test(val)) continue;
      // 高熵长串 → 可疑
      const h = entropy(val);
      if (val.length >= 16 && h >= 3.5) susp(rel, ln, `疑似硬编码 ${key}（熵 ${h.toFixed(1)}）`, line.trim().slice(0, 160));
      else susp(rel, ln, `字面量赋值 ${key}`, line.trim().slice(0, 160));
    }
  });
}

function main() {
  for (const f of collectFiles()) scanFile(f);
  const failed = critical.length > 0 || (STRICT && suspicious.length > 0);
  if (AS_JSON) {
    console.log(JSON.stringify({ ok: !failed, critical, suspicious }, null, 2));
  } else {
    console.log('=== 硬编码密钥扫描 ===');
    console.log(`扫描文件数：${collectFiles().length}；高危 ${critical.length} / 可疑 ${suspicious.length}`);
    for (const x of critical) console.log(`  ✗ ${x.file}:${x.line}  ${x.msg}\n      ${x.snippet}`);
    for (const x of suspicious) console.log(`  ⚠ ${x.file}:${x.line}  ${x.msg}`);
    if (!failed) console.log(`✓ 通过（${STRICT ? '含可疑项' : '仅高危项'}）`);
  }
  process.exitCode = failed ? 1 : 0;
}

main();
