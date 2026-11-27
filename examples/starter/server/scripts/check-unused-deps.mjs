#!/usr/bin/env node
/**
 * 未使用依赖扫描（零依赖）：比对 package.json 声明与源码 import/require，找出可清理的依赖。
 *
 * 规则：
 *   1) 包在 dependencies/devDependencies 声明但源码无 import/require → warn
 *   2) 常见运行时/CLI 依赖（dotenv、@panweippc/*、vitest、vite 等）在白名单中 → pass
 *   3) 源码 import 了但未声明的包 → critical（缺依赖，干净目录安装会失败）
 *
 * 用法：node scripts/check-unused-deps.mjs [--json] [--strict]
 * 说明：动态 require、插件式加载可能误报；清理前请确认无运行时动态引用。
 */
import fs from 'node:fs';
import path from 'node:path';
import { SERVER, ROOT, WEB, parseArgs, walk, readOr, finish } from './_check-utils.mjs';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

// 白名单：运行时配置加载、测试/构建工具、本地 file: 包、类型声明
const ALLOW = /^(?:@panweippc\/|@types\/|dotenv|vitest|vite|supertest|tsx|typescript|eslint|@vitest\/)/;
// Node 内置模块（源码里常写 from 'fs' 而非 'node:fs'）
const NODE_BUILTIN = new Set(['assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram', 'dns', 'events', 'fs', 'http', 'http2', 'https', 'module', 'net', 'os', 'path', 'perf_hooks', 'process', 'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'worker_threads', 'zlib']);
const normalizePkg = (p) => p.startsWith('@') ? p.split('/').slice(0, 2).join('/') : p.split('/')[0];

for (const [dir, label] of [[SERVER, 'server'], [WEB, 'web']]) {
  const pkg = JSON.parse(readOr(path.join(dir, 'package.json'), '{}'));
  const declared = new Set([...(Object.keys(pkg.dependencies || {})), ...(Object.keys(pkg.devDependencies || {}))]);
  const srcDirs = [path.join(dir, 'src'), path.join(dir, 'routes'), path.join(dir, 'middleware'), path.join(dir, 'services'), path.join(dir, 'scripts')]
    .filter((d) => fs.existsSync(d));
  const files = srcDirs.flatMap((d) => walk(d, { exts: ['.js', '.mjs', '.ts', '.vue'], skip: ['node_modules', 'dist'] }));
  for (const extra of ['server.js', 'vitest.config.js', 'vite.config.ts']) {
    if (fs.existsSync(path.join(dir, extra))) files.push(path.join(dir, extra));
  }
  const used = new Set();
  const dynamic = new Set();
  for (const file of files) {
    const codeLines = readOr(file).split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)); // 注释中的 import 示例不算引用
    for (const line of codeLines) {
      for (const m of line.matchAll(/(?:from\s+|require\(\s*)['"]([^'"]+)['"]/g)) {
        const p = normalizePkg(m[1]);
        if (p.startsWith('node:') || p.startsWith('.') || NODE_BUILTIN.has(p)) continue;
        used.add(p);
      }
      for (const m of line.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const p = normalizePkg(m[1]);
        if (p.startsWith('node:') || p.startsWith('.') || NODE_BUILTIN.has(p)) continue;
        used.add(p);
        dynamic.add(p);
      }
    }
  }
  for (const p of used) {
    if (declared.has(p) || ALLOW.test(p)) continue;
    if (dynamic.has(p)) add('warn', `${label} 动态导入 ${p} 但未声明依赖（启用该适配器前需安装）`, `${label}/package.json`);
    else add('critical', `${label} 静态引用 ${p} 但 package.json 未声明`, `${label}/package.json`);
  }
  for (const p of declared) {
    if (ALLOW.test(p)) { add('pass', `${label} ${p} 属白名单（工具/运行时/本地包）`, `${label}/package.json`); continue; }
    if (!used.has(p)) add('warn', `${label} 声明了 ${p} 但源码无静态引用（确认是否动态使用）`, `${label}/package.json`);
    else add('pass', `${label} ${p} 已被源码引用`, `${label}/package.json`);
  }
}

finish('未使用依赖扫描', {
  scope: ['server', 'web'],
  note: '静态 import/require 分析，动态加载需人工确认',
}, findings, args, {
  disclaimer: '插件式/动态 require 会误报；删除依赖前请运行全量测试确认',
});
