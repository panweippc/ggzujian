#!/usr/bin/env node
/**
 * CRUD 代码生成器 —— 填表名（或实体定义）→ 生成 API + 页面
 *
 * 用法：
 *   node scripts/generate-crud.mjs --sql ../server/db.sql --table products
 *   node scripts/generate-crud.mjs --config entities/product.json
 *   node scripts/generate-crud.mjs --config entities/product.json --dry-run
 *   node scripts/generate-crud.mjs --config entities/product.json --register   # 生成并自动注册接线
 *
 * 从 SQL 的 CREATE TABLE 解析字段类型/注释，自动生成：
 *   server/routes/generated/<entity>.js   后端 CRUD 路由（adminOnly + 审计 + 分页）
 *   web/src/views/generated/<Entity>View.vue  前端页面（基于 admin-ui CrudPanel）
 *   server/sql/generated/<entity>.sql    建表 SQL（--config 模式）
 * 加 --register 会自动完成 4 处接线（server.js / router.ts / config.ts SIDE_MENUS+LOGIN_MODULES /
 * excel.js SCHEMAS），并保证菜单与导览同步。不加则只生成文件并打印手动注册片段。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER = path.join(ROOT, 'server');
const WEB = path.join(ROOT, 'web', 'src');

// ---------- CLI ----------
const argv = process.argv.slice(2);
const arg = (name, def = '') => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? (argv[i + 1] || '') : def;
};
const has = (name) => argv.includes('--' + name);
const DRY = has('dry-run');
const REGISTER = has('register');
const SQL_FILE = arg('sql');
const TABLE = arg('table');
const CONFIG_FILE = arg('config');

if ((!SQL_FILE && !CONFIG_FILE) || (!TABLE && !CONFIG_FILE)) {
  console.error(`用法示例：
  node scripts/generate-crud.mjs --sql ../server/db.sql --table products
  node scripts/generate-crud.mjs --config entities/product.json [--dry-run]`);
  process.exit(1);
}

// ---------- 工具 ----------
const pascal = (s) => s.replace(/(^|_|-)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase()).replace(/^./, c => c.toUpperCase());
const camel = (s) => { const p = pascal(s); return p[0].toLowerCase() + p.slice(1); };
const plural = (s) => s.endsWith('s') ? s : s + 's';
const snake = (s) => s.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '');

/** SQL 类型 → 前端字段类型 */
function fieldType(sqlType) {
  const t = String(sqlType || '').toUpperCase();
  if (/TEXT|LONGTEXT|MEDIUMTEXT/.test(t)) return 'textarea';
  if (/DATE|TIME/.test(t)) return 'date';
  if (/INT|DECIMAL|DOUBLE|FLOAT|NUMERIC|BIGINT/.test(t)) return 'number';
  if (/ENUM|SET/.test(t)) return 'select';
  if (/JSON/.test(t)) return 'textarea';
  return 'text';
}

/** 从 SQL 文件解析 CREATE TABLE `name` (...) */
function parseTableFromSql(sqlText, table) {
  const re = new RegExp('CREATE\\s+TABLE(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+[`"]?' + table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[`"]?\\s*\\(([\\s\\S]*?)\\)\\s*ENGINE', 'i');
  const m = sqlText.match(re);
  if (!m) throw new Error(`在 SQL 中未找到表 ${table}（需匹配 ... ENGINE= 结尾的 CREATE TABLE）`);
  const fields = [];
  for (const line of m[1].split('\n')) {
    const s = line.trim();
    if (!s || /^(PRIMARY|UNIQUE|KEY|INDEX|CONSTRAINT|FOREIGN|FULLTEXT)`?/i.test(s)) continue;
    const fm = s.match(/^[`"]?(\w+)[`"]?\s+([A-Za-z]+(?:\([^)]*\))?)/);
    if (!fm) continue;
    const name = fm[1];
    const rawType = fm[2];
    if (['id', 'createdAt', 'updatedAt', 'created_at', 'updated_at'].includes(name)) continue;
    const comment = (s.match(/COMMENT\s+'([^']*)'/i) || [])[1] || '';
    fields.push({
      name,
      label: comment || name,
      type: fieldType(rawType),
      required: /NOT\s+NULL/i.test(s),
      sqlType: rawType,
    });
  }
  return { table, fields };
}

/** 实体定义归一化 */
function normalize(entity) {
  const table = entity.table || TABLE;
  if (!table) throw new Error('缺少 table');
  const fields = (entity.fields || []).map(f => ({
    name: f.name,
    label: f.label || f.name,
    type: f.type || 'text',
    required: !!f.required,
    options: f.options || [],
    sqlType: f.sqlType || 'VARCHAR(255)',
  }));
  return {
    table,
    entity: entity.entity || camel(table),
    Entity: entity.Entity || pascal(table),
    route: entity.route || plural(camel(table)),
    title: entity.title || pascal(table),
    icon: entity.icon || 'Document',
    fields,
  };
}

// ---------- 模板 ----------
function renderServer(e) {
  const cols = e.fields.map(f => `    { name: '${f.name}', label: '${f.label}' }`).join(',\n');
  return `/**
 * 【生成文件】${e.title} CRUD —— 由 scripts/generate-crud.mjs 生成，可自由修改
 * 路由前缀：/api/${e.route}（需在 server.js 用 app.use('/api', ${e.entity}Router) 注册）
 */
import express from 'express';
import { getOperator } from '@panweippc/auth-kit';
import { writeAudit } from '../middleware/audit.js';
import { adminOnly } from '../middleware/role.js';

const router = express.Router();
const poolOf = (req) => req.app.locals.pool;
const TABLE = '${e.table}';
const FIELDS = [
${cols}
];
const EDITABLE = FIELDS.map(f => f.name);
const audit = (req, action, detail, targetName = '') =>
  writeAudit(poolOf(req), req, {
    userId: String(req.user?.id || ''), username: getOperator(req), ip: req.ip,
    action, module: '${e.entity}', detail, targetName
  }).catch(() => {});

// 列表（分页 + 关键词模糊搜索）
router.get('/${e.route}', adminOnly, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize) || 20));
    const q = String(req.query.q || '').trim();
    const where = q ? 'WHERE ' + FIELDS.map(f => '\`'+f.name+'\` LIKE ?').join(' OR ') : '';
    const args = q ? FIELDS.map(() => '%' + q + '%') : [];
    const [count] = await poolOf(req).execute('SELECT COUNT(*) AS total FROM ' + TABLE + ' ' + where, args);
    const [rows] = await poolOf(req).execute(
      'SELECT * FROM ' + TABLE + ' ' + where + ' ORDER BY id DESC LIMIT ? OFFSET ?',
      [...args, pageSize, (page - 1) * pageSize]
    );
    res.json({ success: true, data: rows, total: count[0].total });
  } catch (e) { res.status(500).json({ success: false, message: '读取${e.title}失败' }); }
});

// 详情
router.get('/${e.route}/:id', adminOnly, async (req, res) => {
  try {
    const [rows] = await poolOf(req).execute('SELECT * FROM ' + TABLE + ' WHERE id=?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ success: false, message: '记录不存在' });
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(500).json({ success: false, message: '读取详情失败' }); }
});

// 新增
router.post('/${e.route}', adminOnly, async (req, res) => {
  const body = {};
  for (const k of EDITABLE) if (req.body[k] !== undefined) body[k] = req.body[k];
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ success: false, message: '无有效字段' });
  try {
    const cols = keys.map(k => '\`' + k + '\`').join(', ');
    const marks = keys.map(() => '?').join(', ');
    const [r] = await poolOf(req).execute(
      'INSERT INTO ' + TABLE + ' (' + cols + ') VALUES (' + marks + ')',
      keys.map(k => body[k])
    );
    await audit(req, 'create', '新增${e.title} id=' + r.insertId, String(body[EDITABLE[0]] || ''));
    res.json({ success: true, data: { id: r.insertId } });
  } catch (e) { res.status(500).json({ success: false, message: '新增失败' }); }
});

// 更新
router.put('/${e.route}/:id', adminOnly, async (req, res) => {
  const body = {};
  for (const k of EDITABLE) if (req.body[k] !== undefined) body[k] = req.body[k];
  const keys = Object.keys(body);
  if (!keys.length) return res.status(400).json({ success: false, message: '无有效字段' });
  try {
    const sets = keys.map(k => '\`' + k + '\`=?').join(', ');
    await poolOf(req).execute('UPDATE ' + TABLE + ' SET ' + sets + ' WHERE id=?', [...keys.map(k => body[k]), req.params.id]);
    await audit(req, 'update', '更新${e.title} id=' + req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '更新失败' }); }
});

// 删除
router.delete('/${e.route}/:id', adminOnly, async (req, res) => {
  try {
    await poolOf(req).execute('DELETE FROM ' + TABLE + ' WHERE id=?', [req.params.id]);
    await audit(req, 'delete', '删除${e.title} id=' + req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: '删除失败' }); }
});

export default router;
`;
}

function renderVue(e) {
  const columns = e.fields.map(f => `{ prop: '${f.name}', label: '${f.label}', minWidth: 120 }`).join(',\n    ');
  const formFields = e.fields.map(f => {
    let s = `{ prop: '${f.name}', label: '${f.label}'`;
    if (f.type === 'number') s += ", type: 'number'";
    else if (f.type === 'textarea') s += ", type: 'textarea'";
    else if (f.type === 'date') s += ", type: 'date'";
    else if (f.type === 'select' && f.options?.length) s += `, type: 'select', options: ${JSON.stringify(f.options)}`;
    return s + ' }';
  }).join(',\n    ');
  return `<script setup lang="ts">
/**
 * 【生成文件】${e.title} 管理页 —— 由 scripts/generate-crud.mjs 生成，可自由修改
 * 需在 router.ts 注册：{ path: '${e.route}', name: '${e.entity}', component: ${e.Entity}View, meta: { title: '${e.title}' } }
 * 需在 config.ts 的 SIDE_MENUS / LOGIN_MODULES 同步加菜单项（新增菜单必须同步登录页导览）
 */
import { CrudPanel } from '@panweippc/admin-ui';
import axios from 'axios';

const config = {
  columns: [
    ${columns}
  ],
  formFields: [
    ${formFields}
  ],
  list: async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const r = await axios.get('/api/${e.route}', { params: { page, pageSize } });
    return { data: r.data.data || [], total: r.data.total || 0 };
  },
  create: (form: any) => axios.post('/api/${e.route}', form).then(r => r.data),
  update: (id: any, form: any) => axios.put('/api/${e.route}/' + id, form).then(r => r.data),
  remove: (id: any) => axios.delete('/api/${e.route}/' + id).then(r => r.data),
};
</script>

<template>
  <div class="generated-page">
    <el-page-header title="${e.title}管理" content="增删改查（生成页面）" />
    <CrudPanel :config="config" />
  </div>
</template>

<style scoped>
.generated-page { padding: 16px; }
</style>
`;
}

function renderSql(e) {
  const defs = e.fields.map(f => `  \`${f.name}\` ${f.sqlType}${f.required ? ' NOT NULL' : ''} COMMENT '${f.label}',`).join('\n');
  return `-- 【生成文件】${e.title} 建表 SQL
CREATE TABLE IF NOT EXISTS \`${e.table}\` (
  \`id\` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
${defs}
  \`createdAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updatedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='${e.title}';
`;
}

// ---------- 主流程 ----------
let entity;
if (CONFIG_FILE) {
  const p = path.isAbsolute(CONFIG_FILE) ? CONFIG_FILE : path.resolve(process.cwd(), CONFIG_FILE);
  entity = normalize(JSON.parse(fs.readFileSync(p, 'utf8')));
} else {
  const sqlPath = path.isAbsolute(SQL_FILE) ? SQL_FILE : path.resolve(process.cwd(), SQL_FILE);
  entity = normalize(parseTableFromSql(fs.readFileSync(sqlPath, 'utf8'), TABLE));
  entity.Entity = pascal(TABLE) + 'View';
}

if (!entity.fields.length) throw new Error('未解析到任何字段');

const outputs = [
  { path: path.join(SERVER, 'routes', 'generated', entity.entity + '.js'), content: renderServer(entity) },
  { path: path.join(WEB, 'views', 'generated', entity.Entity.replace(/View$/, '') + 'View.vue'), content: renderVue(entity) },
];
if (CONFIG_FILE) {
  outputs.push({ path: path.join(SERVER, 'sql', 'generated', entity.table + '.sql'), content: renderSql(entity) });
}

console.log(`生成 ${entity.title}：${entity.fields.length} 个字段，表=${entity.table}，路由=/api/${entity.route}`);
if (DRY) {
  for (const o of outputs) console.log('\n--- DRY RUN: ' + path.relative(ROOT, o.path) + ' (' + o.content.length + ' bytes) ---');
  console.log('\n[DRY RUN] 未写文件');
} else {
  for (const o of outputs) {
    fs.mkdirSync(path.dirname(o.path), { recursive: true });
    fs.writeFileSync(o.path, o.content, 'utf8');
    console.log('  写入', path.relative(ROOT, o.path));
  }
}

// ---------- 自动接线（--register）----------
/** 幂等插入：若文件已含 marker 则跳过，否则在锚点后插入一段文本（兼容 CRLF/LF） */
function insertOnce(file, marker, anchor, block, label, where = 'after') {
  let text = fs.readFileSync(file, 'utf8');
  if (text.includes(marker)) { console.log('  跳过（已注册）', label); return false; }
  // 把锚点里的换行改成匹配 \r?\n 的正则，逐段转义其余字符
  const re = new RegExp(anchor.split('\n').map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\r?\\n'));
  const m = text.match(re);
  if (!m) throw new Error(`${label}：未找到锚点 ${JSON.stringify(anchor)}，请手动注册`);
  const nl = text.includes('\r\n') ? '\r\n' : '\n';
  const normalized = block.split('\n').join(nl);
  if (where === 'replace') {
    // block 中的 \n 已被统一为 nl；anchor 里的换行也按 nl 归一后长度对齐
    const anchorLen = m[0].length;
    text = text.slice(0, m.index) + normalized + text.slice(m.index + anchorLen);
  } else {
    const at = where === 'before' ? m.index : m.index + m[0].length;
    text = text.slice(0, at) + normalized + text.slice(at);
  }
  fs.writeFileSync(file, text, 'utf8');
  console.log('  已注册', label);
  return true;
}

function autoRegister(e) {
  const serverJs = path.join(SERVER, 'server.js');
  const routerTs = path.join(WEB, 'router.ts');
  const configTs = path.join(WEB, 'config.ts');
  const excelJs = path.join(SERVER, 'routes', 'excel.js');
  const ViewName = e.Entity.replace(/View$/, '') + 'View';

  // 1) server.js：导入 + 挂载（锚点：最后一个 signatureRouter 挂载）
  insertOnce(serverJs, `${e.entity}Router`, "import { createSseRouter } from './routes/sse.js';",
    `\nimport ${e.entity}Router from './routes/generated/${e.entity}.js';`, 'server.js import');
  insertOnce(serverJs, `app.use('/api', ${e.entity}Router)`,
    "// 电子签章（SHA-256 摘要 + HMAC 签名 + 验签 + 撤销）\napp.use('/api', signatureRouter);",
    `\n// 生成实体：${e.title}\napp.use('/api', ${e.entity}Router);`, 'server.js mount');

  // 2) router.ts：import + children 路由
  insertOnce(routerTs, `import ${ViewName}`, "import LowCodeView from './views/LowCodeView.vue';",
    `\nimport ${ViewName} from './views/generated/${ViewName}.vue';`, 'router.ts import');
  insertOnce(routerTs, `path: '${e.route}'`, "    { path: 'low-code', name: 'lowCode', component: LowCodeView, meta: { title: '低代码搭建' } },",
    `\n        { path: '${e.route}', name: '${e.entity}', component: ${ViewName}, meta: { title: '${e.title}' } },`, 'router.ts route');

  // 3) config.ts：SIDE_MENUS + LOGIN_MODULES 同步（项目约定）
  const maxId = [...fs.readFileSync(configTs, 'utf8').matchAll(/\{ id: (\d+), name:/g)].reduce((a, m) => Math.max(a, +m[1]), 0);
  const newId = maxId + 1;
  insertOnce(configTs, `path: '/${e.route}'`, "  { id: 18, name: '低代码搭建', path: '/low-code', icon: 'palette' },",
    `\n  { id: ${newId}, name: '${e.title}', path: '/${e.route}', icon: 'document' },`, 'config.ts SIDE_MENUS');
  // 锚点用「数组闭合 ]; + 空行 + 下一节注释」，把新项插在 ]; 之前（数组内部末尾）。
  // 不能用某项名称前缀作锚点——那会匹配到半行中间，破坏对象字面量。
  const loginItem = `  { name: '${e.title}', bg: 'rgba(59,130,246,.14)', icon: ICON('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8"/>', '#3b82f6') },`;
  const loginAnchor = '];\n\n// ============ 登录页每日寄语';
  insertOnce(configTs, `name: '${e.title}', bg:`, loginAnchor,
    loginItem + '\n' + loginAnchor, 'config.ts LOGIN_MODULES', 'replace');

  // 4) excel.js：SCHEMAS 注册（字段映射）
  const schemaFields = e.fields.map((f) => {
    const type = f.type === 'number' ? 'number' : f.type === 'select' && f.options?.length
      ? `enum', options: ${JSON.stringify(f.options)}` : 'string';
    return `      { key: '${f.name}', label: '${f.label}'${f.required ? ', required: true' : ''}, type: '${type}' },`;
  }).join('\n');
  const schemaBlock = `  ${e.route}: {\n    table: '${e.table}',\n    title: '${e.title}',\n    fields: [\n${schemaFields}\n    ],\n  },\n`;
  if (fs.existsSync(excelJs)) {
    insertOnce(excelJs, `  ${e.route}: {`, 'export const SCHEMAS = {\n', schemaBlock, 'excel.js SCHEMAS');
  } else {
    console.log('  跳过（项目未启用 Excel 底座）excel.js SCHEMAS');
  }
}

if (REGISTER && !DRY) {
  console.log('\n=== 自动接线 ===');
  autoRegister(entity);
  console.log('✓ 接线完成：server.js / router.ts / config.ts(SIDE_MENUS+LOGIN_MODULES) / excel.js');
  console.log('  提示：运行一致性门禁复核 → node scripts/check-consistency.mjs');
} else {
  console.log(`\n=== 手动注册（加 --register 可自动完成 1-3）===
1) server.js 导入并挂载：
   import ${entity.entity}Router from './routes/generated/${entity.entity}.js';
   app.use('/api', ${entity.entity}Router);
2) web/src/router.ts children 加：
   { path: '${entity.route}', name: '${entity.entity}', component: ${entity.Entity.replace(/View$/, '')}View, meta: { title: '${entity.title}' } },
3) web/src/config.ts 的 SIDE_MENUS **和 LOGIN_MODULES** 同步加菜单项（项目约定：新增菜单必须同步登录页导览）
4) 若来自 --config，执行生成的 SQL：server/sql/generated/${entity.table}.sql`);
}
