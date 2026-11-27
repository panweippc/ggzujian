/**
 * 前端一键安全自检 API
 *
 *   GET  /api/security/checks  列出可执行的检测项
 *   POST /api/security/run     执行选中的检测（管理员专属）
 *
 * 安全约束：
 *   1) 检测项与脚本路径固定映射，请求只能传白名单 id；不接收路径/参数字符串
 *   2) execFile(process.execPath, [脚本, ...固定参数]) 直接起子进程，不经过 shell，杜绝命令注入
 *   3) 生产环境默认关闭（SECURITY_UI_ENABLED=true 才开），开发环境默认开启
 *   4) 用户+IP 限频、全局单并发、单次超时与输出上限；stderr 不回传前端
 *   5) 执行结果写操作审计（security 模块），便于追溯谁在什么时候跑了自检
 *
 * 与 CI 门禁的关系：这里是"按需自查入口"，不替代 CI 的阻断门禁；
 * 检测脚本本身与 CI 完全共用，结果口径一致（同一份 --json 输出）。
 */
import { Router } from 'express';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { adminOnly } from '../middleware/role.js';
import { writeAudit } from '../middleware/audit.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..');
const SCRIPTS_DIR = path.join(SERVER_DIR, 'scripts');

/** 检测项白名单：id → 固定脚本与固定参数（前端无法覆盖） */
export const CHECKS = Object.freeze([
  {
    id: 'secrets',
    name: '硬编码密钥扫描',
    description: '检出写进源码的私钥、云厂商 AK、令牌字面量与高熵赋值',
    script: 'check-secrets.mjs',
    args: ['--json'],
    result: '高危项阻断，可疑项仅告警',
  },
  {
    id: 'quality',
    name: '冗余代码审查',
    description: '重复代码块、超长文件/函数、无引用导出、待办标记、调试输出（启发式）',
    script: 'check-code-quality.mjs',
    args: ['--json'],
    result: '默认仅告警，结论需人工确认',
  },
  {
    id: 'compliance',
    name: '等保合规自查',
    description: '等保 2.0 技术控制点自查，区分自动通过 / 缺失 / 需人工',
    script: 'check-compliance.mjs',
    args: ['--json'],
    result: '技术项自查，不构成测评结论',
    acceptsLevel: true,
  },
  {
    id: 'api-exposure', name: 'API 暴露面自查',
    description: '公开端点与管理接口鉴权覆盖，检出应鉴权却裸露的接口',
    script: 'check-api-exposure.mjs', args: ['--json'], result: '静态分析，全局鉴权顺序需复核', timeout: 30000,
  },
  {
    id: 'config-baseline', name: '配置基线漂移检测',
    description: '弱口令占位符、危险开关、compose 管理端口暴露',
    script: 'check-config-baseline.mjs', args: ['--json'], result: '静态配置核验', timeout: 30000,
  },
  {
    id: 'sql-safety', name: 'SQL 危险拼接扫描',
    description: '请求对象插值进入 SQL、字符串拼接注入风险',
    script: 'check-sql-safety.mjs', args: ['--json'], result: '启发式，告警需人工确认', timeout: 30000,
  },
  {
    id: 'coverage', name: '测试覆盖率门禁',
    description: '模块被测试引用比例与 coverage 配置完备性',
    script: 'check-coverage.mjs', args: ['--json'], result: '启发式比例，非语句覆盖率', timeout: 30000,
  },
  {
    id: 'sbom', name: 'SBOM 与许可证合规',
    description: '组件清单（CycloneDX）与 GPL/AGPL 等高风险许可证检出',
    script: 'check-sbom.mjs', args: ['--json'], result: '许可证来自包声明，非法律意见', timeout: 60000,
  },
  {
    id: 'data-classification', name: '数据分类分级扫描',
    description: 'PII 字段与敏感字段注册表对照，找漏登记字段',
    script: 'check-data-classification.mjs', args: ['--json'], result: '命名启发式，需人工排除误报', timeout: 30000,
  },
  {
    id: 'permission-matrix', name: '权限矩阵一致性',
    description: '前端路由白名单 / API 调用与后端 adminOnly 交叉校验',
    script: 'check-permission-matrix.mjs', args: ['--json'], result: '静态交叉校验', timeout: 30000,
  },
  {
    id: 'backup-drill', name: '备份可恢复性演练',
    description: 'manifest 完整性、加密解密演练、异地副本存在性',
    script: 'check-backup-drill.mjs', args: ['--json'], result: '文件级演练，不等价真实恢复', timeout: 60000,
  },
  {
    id: 'complexity', name: '圈复杂度门禁',
    description: '高分支函数识别（与超长函数互补）',
    script: 'check-complexity.mjs', args: ['--json'], result: '启发式估算，历史基线仅提示', timeout: 60000,
  },
  {
    id: 'unused-deps', name: '未使用依赖扫描',
    description: '声明但未引用 / 引用但未声明的依赖',
    script: 'check-unused-deps.mjs', args: ['--json'], result: '动态加载需人工确认', timeout: 30000,
  },
  {
    id: 'ts-strict', name: 'TypeScript 严格度门禁',
    description: 'tsconfig 严格开关与显式 any 密度',
    script: 'check-ts-strict.mjs', args: ['--json'], result: '类型安全仍需 tsc --noEmit', timeout: 30000,
  },
  {
    id: 'api-contract', name: '前后端接口契约校验',
    description: '前端 API 调用路径对照后端实际路由',
    script: 'check-api-contract.mjs', args: ['--json'], result: '仅路径存在性，不含字段校验', timeout: 30000,
  },
]);
const BY_ID = new Map(CHECKS.map((c) => [c.id, c]));
export const CHECK_IDS = [...BY_ID.keys()];
export const LEVELS = ['三级', '二级'];

const TIMEOUT_MS = Math.max(5000, Number(process.env.SECURITY_UI_TIMEOUT_MS) || 45000);
const RATE_WINDOW_MS = Math.max(1000, Number(process.env.SECURITY_UI_RATE_WINDOW_MS) || 60000);
const RATE_MAX = Math.max(1, Number(process.env.SECURITY_UI_RATE_MAX) || 5);

/** 生产默认关闭；显式配置优先 */
export function isUiEnabled(env = process.env) {
  const raw = String(env.SECURITY_UI_ENABLED ?? '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return env.NODE_ENV !== 'production';
}

/** 只接受白名单 id，去重且拒绝未知项 */
export function pickChecks(input) {
  const list = Array.isArray(input) ? input : (input ? [input] : CHECK_IDS);
  const seen = new Set();
  const out = [];
  for (const id of list) {
    if (typeof id !== 'string' || !BY_ID.has(id)) {
      return { error: `不支持的检测项：${String(id).slice(0, 40)}` };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(BY_ID.get(id));
  }
  if (!out.length) return { error: '请至少选择一项检测' };
  return { checks: out };
}

export function normalizeLevel(input) {
  const level = String(input ?? '三级');
  return LEVELS.includes(level) ? level : null;
}

function normalizeSecrets(data) {
  const critical = Array.isArray(data.critical) ? data.critical : [];
  const suspicious = Array.isArray(data.suspicious) ? data.suspicious : [];
  return {
    ok: !!data.ok,
    status: critical.length ? 'fail' : suspicious.length ? 'warn' : 'pass',
    summary: { 高危: critical.length, 可疑: suspicious.length },
    findings: [...critical, ...suspicious].slice(0, 80).map((x) => ({
      level: x.level || 'suspicious', file: x.file || '', line: x.line || 0,
      message: x.msg || '', detail: x.snippet || '',
    })),
  };
}

function normalizeQuality(data) {
  const s = data.summary || {};
  const findings = (Array.isArray(data.findings) ? data.findings : []).slice(0, 80).map((x) => ({
    level: x.level || 'warn', file: x.file || '', line: x.line || 0,
    message: x.detail || x.type || '', detail: x.type || '',
  }));
  return {
    ok: !!data.ok,
    status: findings.length ? 'warn' : 'pass',
    summary: {
      扫描文件: s.files || 0, 重复块: s.duplicateBlocks || 0, 超长文件: s.longFiles || 0,
      超长函数: s.longFns || 0, 无引用导出: s.deadExports || 0, 待办: s.todo || 0, 调试输出: s.consoleLogs || 0,
    },
    findings,
    note: data.note || '启发式检测结果，需人工确认',
  };
}

function normalizeCompliance(data) {
  const s = data.summary || {};
  const findings = (Array.isArray(data.results) ? data.results : [])
    .filter((r) => r.status !== 'pass')
    .slice(0, 80)
    .map((r) => ({ level: r.status, file: r.domain || '', line: 0, message: r.name || '', detail: r.evidence || '' }));
  return {
    ok: !!data.ok,
    status: s.missing ? 'fail' : s.manual ? 'warn' : 'pass',
    summary: { 通过: s.pass || 0, 缺失: s.missing || 0, 需人工: s.manual || 0, 合计: s.total || 0 },
    findings,
    level: data.level,
    disclaimer: data.disclaimer || '自查预检，非等级保护测评结论',
  };
}

/** 12 项扩展检测共用 _check-utils.finish 输出：{ ok, summary, counts, findings } */
function normalizeGeneric(data) {
  const findings = (Array.isArray(data.findings) ? data.findings : []).slice(0, 80).map((f) => ({
    level: f.level || 'warn', file: f.file || '', line: f.line || 0,
    message: f.message || '', detail: f.detail || '',
  }));
  const counts = data.counts || {};
  return {
    ok: !!data.ok,
    status: counts.critical ? 'fail' : (counts.warn || counts.manual) ? 'warn' : 'pass',
    summary: data.summary || counts,
    findings,
    ...(data.disclaimer ? { disclaimer: data.disclaimer } : {}),
  };
}

const NORMALIZERS = { secrets: normalizeSecrets, quality: normalizeQuality, compliance: normalizeCompliance };

/** 把各脚本的 JSON 输出归一为前端统一结构（未登记的 id 走通用格式） */
export function normalizeResult(id, data) {
  const base = { id, ok: false, status: 'error', summary: {}, findings: [] };
  if (!data || typeof data !== 'object') return base;
  const fn = NORMALIZERS[id];
  return { ...base, ...(fn ? fn(data) : normalizeGeneric(data)) };
}

/** 单个检测：脚本退出码 1 代表"发现问题"，不是执行失败，仍按 JSON 结果展示 */
function runOne(check, level) {
  return new Promise((resolve) => {
    const started = Date.now();
    const args = [path.join(SCRIPTS_DIR, check.script), ...check.args];
    if (check.acceptsLevel) args.push('--level', level);
    const meta = { id: check.id, name: check.name, ranAt: new Date().toISOString() };
    const timeout = check.timeout || TIMEOUT_MS;

    execFile(process.execPath, args, {
      cwd: SERVER_DIR,
      timeout,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
      // 外部注入的 NODE_OPTIONS 可能改变子进程行为，这里显式清空
      env: { ...process.env, NODE_OPTIONS: '' },
    }, (error, stdout) => {
      const durationMs = Date.now() - started;
      if (error?.killed) {
        return resolve({ ...meta, ...normalizeResult(check.id, null), error: `检测超时（${timeout}ms）`, durationMs });
      }
      if (error && !stdout) {
        console.error('[security-check] 子进程启动失败', check.id, error.message);
        return resolve({ ...meta, ...normalizeResult(check.id, null), error: '检测进程启动失败', durationMs });
      }
      let data;
      try { data = JSON.parse(String(stdout).trim()); }
      catch {
        return resolve({ ...meta, ...normalizeResult(check.id, null), error: '检测结果解析失败（非 JSON 输出）', durationMs });
      }
      resolve({ ...meta, ...normalizeResult(check.id, data), durationMs });
    });
  });
}

const rateHits = new Map();
function takeRateSlot(key) {
  const now = Date.now();
  let rec = rateHits.get(key);
  if (!rec || rec.resetAt <= now) {
    rec = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateHits.set(key, rec);
  }
  if (rec.count >= RATE_MAX) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((rec.resetAt - now) / 1000)) };
  }
  rec.count += 1;
  return { ok: true };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of rateHits) if (v.resetAt <= now) rateHits.delete(k);
}, RATE_WINDOW_MS).unref?.();

let running = false;

/** @param {{ pool?: object }} options 注入连接池用于写审计；不传则只跑检测不落库 */
export function createSecurityCheckRouter({ pool } = {}) {
  const router = Router();

  router.get('/security/checks', adminOnly, (req, res) => {
    if (!isUiEnabled()) {
      return res.status(403).json({ success: false, message: '安全自检已关闭（生产默认关闭，设置 SECURITY_UI_ENABLED=true 可开启）' });
    }
    res.json({
      success: true,
      enabled: true,
      levels: LEVELS,
      data: CHECKS.map(({ id, name, description, result, acceptsLevel }) => ({
        id, name, description, result, acceptsLevel: !!acceptsLevel,
      })),
    });
  });

  router.post('/security/run', adminOnly, async (req, res) => {
    if (!isUiEnabled()) {
      return res.status(403).json({ success: false, message: '安全自检已关闭（生产默认关闭，设置 SECURITY_UI_ENABLED=true 可开启）' });
    }
    const rateKey = `${req.user?.username || req.user?.id || 'anon'}|${req.ip || ''}`;
    const slot = takeRateSlot(rateKey);
    if (!slot.ok) {
      return res.status(429).json({ success: false, message: `操作过于频繁，请 ${slot.retryAfterSec} 秒后重试`, retryAfterSec: slot.retryAfterSec });
    }
    if (running) {
      return res.status(409).json({ success: false, message: '已有检测任务执行中，请稍后再试' });
    }

    const picked = pickChecks(req.body?.checks);
    if (picked.error) return res.status(400).json({ success: false, message: picked.error });
    const level = normalizeLevel(req.body?.level);
    if (!level) return res.status(400).json({ success: false, message: '等级仅支持 二级 / 三级' });

    running = true;
    try {
      const results = [];
      for (const check of picked.checks) results.push(await runOne(check, level));
      const summary = results.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1;
        return acc;
      }, {});
      const ranAt = new Date().toISOString();

      if (pool) {
        try {
          await writeAudit(pool, req, {
            action: 'security_check', module: 'security',
            targetName: picked.checks.map((c) => c.id).join(','),
            detail: `一键安全自检：${picked.checks.map((c) => c.name).join('、')}（${level}）`,
          });
        } catch (e) {
          console.warn('[security-check] 审计写入失败：', e.message);
        }
      }
      res.json({
        success: true,
        data: {
          ranAt, level, summary, results,
          disclaimer: '技术项自查，不构成等级保护测评结论；正式测评须由有资质机构出具',
        },
      });
    } finally {
      running = false;
    }
  });

  return router;
}

export default createSecurityCheckRouter;
