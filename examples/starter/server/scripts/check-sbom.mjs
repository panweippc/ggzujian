#!/usr/bin/env node
/**
 * SBOM + 许可证合规扫描（零依赖）：生成 CycloneDX 组件清单并检出高风险许可证。
 *
 * 检查项：
 *   1) 从 server/package-lock.json + server/web node_modules 汇总组件与许可证
 *   2) AGPL/GPL/SSPL/CC-BY-NC → critical；LGPL/MPL/EPL → warn
 *   3) UNLICENSED / 缺许可证 → warn
 *   4) --out <file> 落盘 CycloneDX 1.5 JSON（默认只报告，不写文件）
 *
 * 用法：node scripts/check-sbom.mjs [--json] [--strict] [--out sbom.json]
 * 说明：许可证字段来自包自身声明，最终合规结论仍需法务/制度复核。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, WEB, parseArgs, readOr, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });
const components = new Map();

function addComponent(pkg, source) {
  if (!pkg?.name || !pkg?.version) return;
  const key = `${pkg.name}@${pkg.version}`;
  if (!components.has(key)) {
    components.set(key, { name: pkg.name, version: pkg.version, license: pkg.license || null, source });
  }
}

// 1) lockfile（server）
try {
  const lock = JSON.parse(readOr(path.join(SERVER, 'package-lock.json'), '{}'));
  for (const [p, v] of Object.entries(lock.packages || {})) {
    if (!p.startsWith('node_modules/')) continue;
    addComponent({ name: v.name || p.slice('node_modules/'.length), version: v.version, license: v.license }, 'server-lock');
  }
} catch (e) {
  add('warn', `server/package-lock.json 解析失败：${e.message}`, 'server/package-lock.json');
}

// 2) 实际安装的包（补全 lock 中缺 license 的项，并覆盖 web 依赖）
for (const [dir, source] of [[SERVER, 'server'], [WEB, 'web']]) {
  const nm = path.join(dir, 'node_modules');
  if (!fs.existsSync(nm)) continue;
  for (const entry of fs.readdirSync(nm)) {
    if (entry.startsWith('.')) continue;
    const targets = entry.startsWith('@')
      ? fs.readdirSync(path.join(nm, entry)).map((x) => path.join(nm, entry, x))
      : [path.join(nm, entry)];
    for (const t of targets) {
      const pj = path.join(t, 'package.json');
      if (!fs.existsSync(pj)) continue;
      try {
        const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
        const key = `${j.name}@${j.version}`;
        if (components.has(key) && !components.get(key).license && j.license) components.get(key).license = j.license;
        else addComponent(j, source);
      } catch { /* 单个包解析失败不影响整体 */ }
    }
  }
}

const HIGH_RISK = /(AGPL|(?<!LGPL)\bGPL[- ]?[123]\b|SSPL|CC[- ]BY[- ]NC|Business Source License)/i;
const PERMISSIVE_WARN = /(LGPL|MPL|EPL|CDDL)/i;
for (const c of components.values()) {
  const lic = String(c.license || '');
  if (!lic || /UNLICENSED/i.test(lic)) {
    add('warn', `${c.name}@${c.version} 未声明许可证`, c.source);
  } else if (HIGH_RISK.test(lic)) {
    add('critical', `${c.name}@${c.version} 使用高风险许可证 ${lic}`, c.source);
  } else if (PERMISSIVE_WARN.test(lic) && !/\bOR\s+(Apache|MIT|BSD)/i.test(lic)) {
    add('warn', `${c.name}@${c.version} 使用弱 Copyleft 许可证 ${lic}（需确认分发合规）`, c.source);
  } else {
    add('pass', `${c.name}@${c.version} 许可证 ${lic} 可接受`, c.source);
  }
}

// CycloneDX 1.5（可选落盘）
const out = args.val('out', '');
if (out) {
  const target = path.isAbsolute(out) ? out : path.join(ROOT, out);
  const sbom = {
    bomFormat: 'CycloneDX', specVersion: '1.5', version: 1,
    metadata: { component: { type: 'application', name: 'starter', version: '1.0.0' } },
    components: [...components.values()].map((c) => ({
      type: 'library', name: c.name, version: c.version,
      licenses: c.license ? [{ license: { id: c.license } }] : [],
    })),
  };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(sbom, null, 2));
    add('pass', `SBOM 已写入 ${out}`);
  } catch (e) {
    add('warn', `SBOM 写入失败：${e.message}`);
  }
}

finish('SBOM 与许可证合规', {
  components: components.length,
  highRiskLicenses: findings.filter((f) => f.level === 'critical').length,
  missingLicenses: findings.filter((f) => /未声明许可证/.test(f.message)).length,
  sbomWritten: !!out,
}, findings, args, {
  disclaimer: '许可证来自包声明，不构成法律意见；正式合规需法务与制度复核',
});
