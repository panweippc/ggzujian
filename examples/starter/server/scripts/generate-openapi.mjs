#!/usr/bin/env node
/**
 * 离线 OpenAPI 3.0 生成器：从 Express 路由源码抽取接口清单，产出可导入 Swagger UI 的 JSON。
 * 与运行时 /api/api-docs.json 互补：运行时版反映"实际挂载"的路由，离线版可纳入版本管理与 CI。
 *
 * 用法：
 *   node scripts/generate-openapi.mjs                # 生成到 ../docs/openapi.json
 *   node scripts/generate-openapi.mjs --out <path>   # 指定输出
 *   node scripts/generate-openapi.mjs --check        # 只校验是否过期（CI 用，不写文件）
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const ROUTES = path.join(SERVER, 'routes');
const DEFAULT_OUT = path.resolve(SERVER, '..', 'docs', 'openapi.json');
const argv = process.argv.slice(2);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };
const CHECK = argv.includes('--check');
const OUT = arg('out', DEFAULT_OUT);

/** 从路由文件抽取 router.get/post/put/delete('/path', ...) */
function scanRoutes() {
  const out = [];
  if (!fs.existsSync(ROUTES)) return out;
  for (const name of fs.readdirSync(ROUTES)) {
    if (!name.endsWith('.js')) continue;
    const file = path.join(ROUTES, name);
    const text = fs.readFileSync(file, 'utf8');
    const re = /router\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/g;
    for (const m of text.matchAll(re)) {
      const method = m[1].toUpperCase();
      const routePath = m[2];
      // 只保留 /api 语义的路径：router 内多为相对路径，统一加 /api 前缀
      const full = routePath.startsWith('/') ? routePath : '/api/' + routePath.replace(/^\//, '');
      out.push({ method, path: full, source: name });
    }
  }
  return out;
}

function buildSpec(routes) {
  const paths = {};
  for (const r of routes) {
    paths[r.path] ||= {};
    // 把 :id / :key 转成 OpenAPI {id} / {key}
    const opPath = r.path.replace(/:([A-Za-z_]\w*)/g, '{$1}');
    if (opPath !== r.path) {
      paths[opPath] ||= {};
      delete paths[r.path];
    }
    const params = [...opPath.matchAll(/\{([^}]+)\}/g)].map((m) => ({
      name: m[1], in: 'path', required: true, schema: { type: 'string' },
    }));
    paths[opPath][r.method.toLowerCase()] = {
      summary: `${r.method} ${opPath}`,
      tags: [r.source.replace(/\.js$/, '')],
      ...(params.length ? { parameters: params } : {}),
      responses: {
        200: { description: '成功' },
        400: { description: '请求参数错误' },
        401: { description: '未认证' },
        500: { description: '服务端错误' },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'starter API',
      version: '1.0.0',
      description: '由 scripts/generate-openapi.mjs 从路由源码自动生成，请勿手改',
    },
    servers: [{ url: 'http://localhost:3011', description: '本地开发' }],
    paths,
  };
}

const routes = scanRoutes();
const spec = buildSpec(routes);
const content = JSON.stringify(spec, null, 2) + '\n';
const count = Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0);

if (CHECK) {
  if (!fs.existsSync(OUT)) {
    console.error(`[check 失败] 未找到 ${OUT}，请先运行 node scripts/generate-openapi.mjs`);
    process.exit(1);
  }
  if (fs.readFileSync(OUT, 'utf8') !== content) {
    console.error(`[check 失败] ${path.relative(SERVER, OUT)} 与源码不同步，请重新生成`);
    process.exit(1);
  }
  console.log(`✓ OpenAPI 文档与源码同步（${count} 个操作）`);
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, content, 'utf8');
  console.log(`✓ 已生成 ${path.relative(SERVER, OUT)}：${Object.keys(spec.paths).length} 条路径 / ${count} 个操作`);
}
