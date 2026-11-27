#!/usr/bin/env node
/**
 * 测试覆盖率门禁（零依赖启发式）：不依赖 coverage provider 也能给出模块被测试引用的比例。
 *
 * 检查项：
 *   1) vitest.config.js 是否声明 coverage.thresholds（有则 pass）
 *   2) 是否安装 @vitest/coverage-v8（有则可跑真实覆盖率）
 *   3) 模块被测试 import 覆盖比例（启发式：tests/*.test.js 的相对 import → 业务模块）
 *
 * 用法：node scripts/check-coverage.mjs [--json] [--strict] [--min 0.4]
 * 说明：启发式比例不等于语句/分支覆盖率；安装 provider 并配置 thresholds 后可升级为真实门禁。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, parseArgs, walk, readOr, rel, finish } from './_check-utils.mjs';

const args = parseArgs();
const minRatio = args.num('min', 0.35);
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const vitestCfg = readOr(path.join(SERVER, 'vitest.config.js'));
const pkg = JSON.parse(readOr(path.join(SERVER, 'package.json'), '{}'));
const hasProvider = !!(pkg.devDependencies?.['@vitest/coverage-v8'] || pkg.dependencies?.['@vitest/coverage-v8']);
const hasThresholds = /thresholds\s*:/.test(vitestCfg) && /lines|statements|functions|branches/.test(vitestCfg);

if (hasProvider && hasThresholds) {
  add('pass', '已配置 coverage provider 与 thresholds', 'server/vitest.config.js');
} else if (!hasProvider) {
  add('manual', '缺少 @vitest/coverage-v8，当前只能用启发式覆盖比例；安装后可启用真实覆盖率门禁', 'server/package.json');
} else {
  add('warn', 'vitest.config.js 未配置 coverage.thresholds', 'server/vitest.config.js');
}

const modDirs = ['middleware', 'services', 'routes'].map((d) => path.join(SERVER, d));
const modules = [...modDirs.flatMap((d) => walk(d, { exts: ['.js'], skip: ['node_modules'] })), path.join(SERVER, 'server.js')];
const testFiles = walk(path.join(SERVER, 'tests'), { exts: ['.test.js'] });
const covered = new Set();
let importCount = 0;
for (const file of testFiles) {
  const src = readOr(file);
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+\.js)['"]/g)) {
    importCount++;
    const target = path.resolve(path.dirname(file), m[1]);
    if (modules.includes(target)) covered.add(target);
  }
}
const ratio = modules.length ? covered.size / modules.length : 0;
if (ratio < minRatio) {
  add('warn', `模块被测试引用比例 ${(ratio * 100).toFixed(1)}% 低于阈值 ${(minRatio * 100).toFixed(0)}%`, 'server/tests');
} else {
  add('pass', `模块被测试引用比例 ${(ratio * 100).toFixed(1)}%（阈值 ${(minRatio * 100).toFixed(0)}%）`, 'server/tests');
}

finish('测试覆盖率门禁', {
  modules: modules.length,
  coveredModules: covered.size,
  ratio: Number(ratio.toFixed(4)),
  threshold: minRatio,
  testFiles: testFiles.length,
  testImports: importCount,
  realCoverage: hasProvider && hasThresholds,
}, findings, args, {
  disclaimer: '启发式比例不等于语句/分支覆盖率；真实覆盖率需 @vitest/coverage-v8 + thresholds',
  command: 'npm i -D @vitest/coverage-v8（需在有网络与安装权限的环境执行）',
});
