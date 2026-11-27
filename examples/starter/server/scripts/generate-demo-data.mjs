#!/usr/bin/env node
/**
 * 演示数据生成器（零依赖）：从 db-all.sql 解析表结构，按字段名/类型启发式生成 INSERT SQL。
 * 供本地开发/演示快速造数据，不依赖 faker，也不需要连库。
 *
 * 用法：
 *   node scripts/generate-demo-data.mjs --table employees --rows 20
 *   node scripts/generate-demo-data.mjs --table employees,departments --rows 10 --out sql/generated/demo-2026.sql
 *   node scripts/generate-demo-data.mjs --list                       # 列出可生成的业务表
 *   node scripts/generate-demo-data.mjs --table employees --dry-run  # 只看预览不写文件
 *   node scripts/generate-demo-data.mjs --table employees --seed 42  # 固定种子可复现
 *
 * 安全：默认跳过 users / *_logs / schema_migrations / 含 password|secret|token 的敏感表，
 *       避免造出弱口令管理员或污染审计链；需要时用 --force 显式指定表强制生成。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..');
const SQL_FILE = path.join(SERVER, 'db-all.sql');
const argv = process.argv.slice(2);
const has = (n) => argv.includes('--' + n);
const arg = (n, d = '') => { const i = argv.indexOf('--' + n); return i >= 0 ? (argv[i + 1] || '') : d; };

const TABLES = arg('table', '').split(',').map((s) => s.trim()).filter(Boolean);
const ROWS = Math.max(1, Math.min(5000, parseInt(arg('rows', '10'), 10) || 10));
const SEED = parseInt(arg('seed', '20261127'), 10) || 20261127;
const OUT = arg('out', 'sql/generated/demo-data.sql');
const FORCE = has('force');

// 默认跳过的表（系统表/审计表/敏感表）
const SKIP = /^(users|schema_migrations|.*_logs?|audit_.*|operation_logs|login_.*|idempotency_keys|sessions?|user_totp)$/i;
const SENSITIVE_COL = /password|secret|token|hash|encrypt|cipher|signature|api_key/i;

// ---- 可复现伪随机（mulberry32）----
let _s = SEED >>> 0;
const rnd = () => {
  _s |= 0; _s = (_s + 0x6D2B79F5) | 0;
  let t = Math.imul(_s ^ (_s >>> 15), 1 | _s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const int = (min, max) => Math.floor(rnd() * (max - min + 1)) + min;
const resetSeed = () => { _s = SEED >>> 0; };
// 固定基准时间（由种子派生），保证时间字段可复现，不随真实时钟漂移
const BASE_TIME = Date.UTC(2026, 0, 1) + (SEED % 365) * 86400000;
const relativeDate = (daysAgo) => new Date(BASE_TIME - daysAgo * 86400000).toISOString().replace('T', ' ').slice(0, 19);

// ---- 中文演示词典 ----
const SURNAMES = '王李张刘陈杨黄赵吴周徐孙马朱胡郭何高林罗郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘于蒋蔡余杜叶程苏魏吕丁任沈姚卢姜崔钟谭陆汪范金石廖贾夏韦付方白邹孟熊秦邱江尹薛闫段雷侯龙史陶黎贺顾毛郝龚邵万钱严覃武戴莫孔向汤'.split('');
const GIVEN = ['伟','芳','娜','敏','静','秀英','丽','强','磊','军','洋','勇','艳','杰','娟','涛','明','超','秀兰','霞','平','刚','桂英','文','辉','力','俊峰','雪','梅','浩然','子轩','雨桐','思远','嘉怡','宇辰'];
const DEPTS = ['技术部','市场部','销售部','财务部','人力资源部','行政部','运营部','客服部','研发中心','产品部','法务部','采购部'];
const POSITIONS = ['软件工程师','产品经理','UI设计师','测试工程师','销售经理','市场专员','财务主管','人事专员','运营专员','客服代表','架构师','数据分析师'];
const CATEGORIES = ['电子','日用','食品','服饰','图书','家居','美妆','运动'];
const PRODUCT_NAMES = ['无线蓝牙耳机','智能手表','保温杯','便签本','有机咖啡','纯棉T恤','人体工学椅','便携充电宝','笔记本','收纳盒','护肤套装','瑜伽垫'];
const STATUS_YN = ['启用','停用'];
const STATUS_ONOFF = ['on','off'];
const EMP_STATUS = ['在职','试用','离职'];
const EDU = ['本科','硕士','大专','博士','高中'];
const SCOPES = ['all','dept','self'];
const CITIES = ['北京市','上海市','广州市','深圳市','杭州市','成都市','武汉市','南京市','苏州市','重庆市','西安市','长沙市'];

// ---- 表结构解析 ----
function parseTables() {
  const sql = fs.readFileSync(SQL_FILE, 'utf8');
  const re = /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`?([\w]+)`?\s*\(([\s\S]*?)\n\)\s*ENGINE/gi;
  const out = {};
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    const cols = [];
    for (const line of m[2].split('\n')) {
      const t = line.trim().replace(/,$/, '');
      const cm = t.match(/^`?([\w]+)`?\s+(INT|INTEGER|BIGINT|TINYINT|VARCHAR|TEXT|DATETIME|DATE|TIMESTAMP|DECIMAL|DOUBLE|FLOAT|JSON|CHAR)\b/i);
      if (!cm) continue;
      cols.push({
        name: cm[1],
        type: cm[2].toUpperCase(),
        autoInc: /\bAUTO_INCREMENT\b/i.test(t),
        notNull: /\bNOT\s+NULL\b/i.test(t),
        def: (t.match(/DEFAULT\s+'?([^',]+)'?/i) || [])[1]?.trim() || '',
      });
    }
    out[name] = cols;
  }
  return out;
}

// ---- 按列名启发式生成值 ----
function valueFor(col, rowIndex) {
  const n = col.name.toLowerCase();
  // 自增/时间戳交给数据库默认值，不显式插入
  if (col.autoInc) return undefined;

  // 布尔/状态类
  if (/^(status|state)$/.test(n)) {
    if (/employees/i.test(col._table) || n === 'status') return pick(EMP_STATUS);
    return pick([...STATUS_YN, ...STATUS_ONOFF]);
  }
  if (/^(enabled|is_?\w+|has_?\w+|deleted|locked)$/.test(n)) return int(0, 1);
  if (/datascope/.test(n)) return pick(SCOPES);
  if (/gender|sex/.test(n)) return pick(['男', '女']);

  // 名称类
  if (/(^|_)(name|title|label|nickname|realname)$/.test(n) || n === 'name') {
    if (/dept|department/.test(col._table)) return pick(DEPTS);
    if (/product/.test(col._table)) return pick(PRODUCT_NAMES);
    return pick(SURNAMES) + pick(GIVEN);
  }
  if (/username|account/.test(n)) return 'demo_' + pick(SURNAMES).toLowerCase() + int(100, 999);
  if (/employeetype/.test(n)) return pick(['正式员工', '试用期', '实习生', '外包']);
  if (/(^|_)(category|type)$/.test(n)) return pick(CATEGORIES);
  if (/(^|_)department(_name)?$/.test(n)) return pick(DEPTS);
  if (/position|job/.test(n)) return pick(POSITIONS);
  if (/education/.test(n)) return pick(EDU);
  if (/^code$/.test(n) || /_code$/.test(n)) return 'C' + String(int(1000, 9999));
  if (/^key$/.test(n) || /_key$/.test(n)) return 'k_' + int(100000, 999999).toString(36);
  if (/icon/.test(n)) return '';
  if (/component|path|url|link/.test(n)) return '/' + pick(['system', 'demo', 'workflow', 'platform']) + '/' + n;
  if (/remark|description|detail|content|memo|summary/.test(n)) return pick(['演示数据', '用于本地开发测试', '这是一条自动生成的示例内容', '']);
  if (/address/.test(n)) return pick(CITIES) + '高新区科技路' + int(1, 200) + '号';
  if (/ipaddress|ip/.test(n)) return `192.168.${int(1, 20)}.${int(2, 250)}`;

  // 联系类
  if (/email/.test(n)) return 'demo' + int(1000, 9999) + '@example.com';
  if (/phone|mobile|tel/.test(n)) return '1' + pick(['3','5','7','8','9']) + String(int(100000000, 999999999));
  if (/idcard/.test(n)) return '';
  if (/emergencycontact/.test(n)) return pick(SURNAMES) + pick(GIVEN);

  // 人员外键
  if (/^(userid|user_id|operator|creator|updater|createdby|updatedby|recipient)$/.test(n)) return 'admin';
  if (/roleid|role_id/.test(n)) return String(int(1, 5));
  if (/menuid|menu_id/.test(n)) return String(int(1, 40));
  if (/parent.*id|.*parentid/.test(n)) return rowIndex === 0 ? '0' : String(int(1, 20));
  if (/sort|order|seq|version|level/.test(n)) return int(1, 100);

  // 数值类
  if (/price|amount|money|salary|cost|total/.test(n)) return (rnd() * 1000).toFixed(2);
  if (/stock|count|num|quantity|quota/.test(n)) return int(0, 500);
  if (/score|rate|percent|ratio/.test(n)) return int(0, 100);

  // 时间类
  if (/time$|at$|date$/i.test(n) || /^(created|updated|entry|birth|expire|start|end)/.test(n)) {
    if (/birth/.test(n)) return `19${int(70, 99)}-${String(int(1,12)).padStart(2,'0')}-${String(int(1,28)).padStart(2,'0')}`;
    return relativeDate(int(0, 365));
  }

  // 类型兜底
  if (/INT$|TINYINT|BIGINT/.test(col.type)) return int(0, 100);
  if (/DECIMAL|DOUBLE|FLOAT/.test(col.type)) return (rnd() * 100).toFixed(2);
  if (/DATE|TIME/.test(col.type)) return relativeDate(int(0, 365));
  if (/TEXT|JSON/.test(col.type)) return '演示数据';
  if (/VARCHAR|CHAR/.test(col.type)) return pick(['示例', '演示', 'test', 'demo']) + int(1, 99);
  return '';
}

function sqlLiteral(v) {
  if (v === undefined) return 'DEFAULT';
  if (v === null) return 'NULL';
  if (typeof v === 'number') return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function buildInsert(table, cols) {
  for (const c of cols) c._table = table;
  const insertCols = cols.filter((c) => !c.autoInc && !SENSITIVE_COL.test(c.name));
  const header = `INSERT INTO \`${table}\` (${insertCols.map((c) => `\`${c.name}\``).join(', ')}) VALUES`;
  const lines = [];
  for (let i = 0; i < ROWS; i++) {
    const vals = insertCols.map((c) => sqlLiteral(valueFor(c, i)));
    lines.push(`(${vals.join(', ')})`);
  }
  return `-- 演示数据：${table}（${ROWS} 行，seed=${SEED}）\n${header}\n${lines.map((l) => l + ',').join('\n').replace(/,\n$/, ';\n')}`;
}

function main() {
  if (has('list')) {
    const tables = parseTables();
    console.log('可生成的业务表（默认跳过系统/审计/敏感表）：');
    for (const name of Object.keys(tables)) {
      const skipped = SKIP.test(name) ? '  [默认跳过]' : '';
      console.log('  ' + name + skipped);
    }
    return;
  }
  if (!TABLES.length) {
    console.error('请指定 --table（逗号分隔）或用 --list 查看可生成的表');
    process.exit(1);
  }
  const tables = parseTables();
  const chunks = [];
  for (const table of TABLES) {
    if (!tables[table]) { console.error(`[跳过] 表 ${table} 不存在于 db-all.sql`); continue; }
    if (!FORCE && SKIP.test(table)) { console.error(`[跳过] ${table} 是系统/审计/敏感表，如需强制生成加 --force`); continue; }
    resetSeed();
    chunks.push(buildInsert(table, tables[table]));
    console.log(`[生成] ${table} ${ROWS} 行`);
  }
  if (!chunks.length) { console.error('没有可生成的表'); process.exit(1); }
  const banner = `-- 演示数据（自动生成）\n-- 生成时间：${new Date().toISOString()}\n-- 仅用于本地开发，请勿在生产环境执行\n\n`;
  const content = banner + chunks.join('\n\n') + '\n';
  if (has('dry-run')) {
    console.log('\n--- 预览（前 30 行）---\n' + content.split('\n').slice(0, 30).join('\n'));
    return;
  }
  const outPath = path.isAbsolute(OUT) ? OUT : path.join(SERVER, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content, 'utf8');
  console.log(`\n✓ 已写入 ${path.relative(SERVER, outPath)}（${content.length} 字节）`);
}

main();
