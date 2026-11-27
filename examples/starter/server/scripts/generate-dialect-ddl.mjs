/**
 * 国产库 DDL 生成器
 *
 * 从 MySQL 源脚本（SQL_FILES 顺序）自动生成 PG 协议栈四种方言的建库脚本：
 *   sql/dialect/postgres.sql、kingbase.sql、opengauss.sql、dameng.sql
 *
 * 转换规则（MySQL → PG 系通用）：
 *   - `ident`        → ident（去掉反引号；PG 裸标识符折叠小写，与 pg-compat 策略一致）
 *   - INT AUTO_INCREMENT PRIMARY KEY → 方言自增（GENERATED … AS IDENTITY / IDENTITY(1,1)）
 *   - DATETIME       → TIMESTAMP
 *   - TINYINT(1)     → BOOLEAN；TINYINT → SMALLINT
 *   - JSON           → JSONB（达梦用 TEXT）
 *   - COMMENT 'xxx'  → 收集为 COMMENT ON 语句
 *   - ENGINE=… CHARSET=… COLLATE=… → 剥离
 *   - INDEX/UNIQUE KEY 内联 → 拆为独立 CREATE INDEX / ALTER TABLE ADD CONSTRAINT
 *   - SET @…/PREPARE/EXECUTE 幂等补列 → 整段转为 TODO 注释（需真机人工转写）
 *
 * ⚠️ 生成器只覆盖项目实际用到的 MySQL 语法子集；生成后需按目标库真机校验（用户当前无真机）。
 *
 * 用法：node scripts/generate-dialect-ddl.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SQL_FILES } from './sql-files.mjs';
import { getDialect, PG_DRIVERS } from '../services/dialects.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, '..');
const outDir = path.join(serverDir, 'sql', 'dialect');
const checkOnly = process.argv.includes('--check');

/** 转换单行里的类型/选项（不含 CREATE TABLE 结构处理） */
function convertLine(line, dialect) {
  let s = line.replace(/`/g, '').replace(/\b(INT|INTEGER|BIGINT|TINYINT|SMALLINT)\s+UNSIGNED\b/gi, (_, typ) => typ);
  if (/\bAUTO_INCREMENT\b/i.test(s)) {
    s = s.replace(/\b(INT|INTEGER|BIGINT)\s+AUTO_INCREMENT\s+PRIMARY\s+KEY\b/gi,
        (_, typ) => `${typ} PRIMARY KEY ${dialect.autoIncrement}`)
      .replace(/\b(INT|INTEGER|BIGINT)\s+NOT\s+NULL\s+AUTO_INCREMENT\b/gi,
        (_, typ) => `${typ} NOT NULL ${dialect.autoIncrement}`)
      .replace(/\b(INT|INTEGER|BIGINT)\s+AUTO_INCREMENT\b/gi,
        (_, typ) => `${typ} ${dialect.autoIncrement}`);
  }
  s = s.replace(/\bTINYINT\s*\(\s*1\s*\)/gi, 'BOOLEAN')
       .replace(/\bTINYINT\b/gi, 'SMALLINT')
       .replace(/\bDATETIME\b/gi, 'TIMESTAMP')
       .replace(/\bJSON\b/gi, dialect.name === 'dameng' ? 'TEXT' : 'JSONB');
  // 去掉列内 COMMENT（收集在 convertCreateTable 里做）
  s = s.replace(/\s+COMMENT\s+'[^']*'/gi, '');
  return s;
}

/** 逐行转换一份脚本 */
export function convertScript(sqlText, dialect) {
  const srcLines = sqlText.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const trailing = []; // 索引/约束/注释，最后统一追加
  let inCreate = null;
  let inIdempotentNote = false;

  for (let i = 0; i < srcLines.length; i += 1) {
    const raw = srcLines[i];

    // ---- CREATE TABLE 状态机 ----
    if (inCreate) {
      const trimmed = raw.trim();
      if (/^\)\s*ENGINE=|^\)\s*;/i.test(trimmed) || trimmed === ')') {
        // 去掉最后一列的尾随逗号（PG 不接受 CREATE TABLE 尾逗号）
        const last = out.length - 1;
        if (last >= 0 && inCreate) out[last] = out[last].replace(/,\s*$/, '');
        out.push(');');
        for (const d of inCreate.defs) trailing.push(d);
        inCreate = null;
        continue;
      }
      // 内联 INDEX / UNIQUE KEY / KEY
      const idx = trimmed.match(/^(UNIQUE\s+)?(?:KEY|INDEX)\s+(\w+)\s*\(([^)]+)\)/i);
      if (idx) {
        const cols = idx[3].split(',').map((c) => c.trim().replace(/`/g, '').toLowerCase()).join(', ');
        if (idx[1]) trailing.push(`ALTER TABLE ${inCreate.table} ADD CONSTRAINT ${idx[2]} UNIQUE (${cols});`);
        else trailing.push(`CREATE INDEX ${idx[2]} ON ${inCreate.table} (${cols});`);
        continue;
      }
      // 列注释收集
      const cm = trimmed.match(/^([\w]+)\s+[^\n]+?\s+COMMENT\s+'([^']*)'/i);
      if (cm) trailing.push(`COMMENT ON COLUMN ${inCreate.table}.${cm[1].toLowerCase()} IS '${cm[2].replace(/'/g, "''")}';`);
      const converted = convertLine(raw, dialect).replace(/,+$/, '').trimEnd();
      if (converted) out.push(converted + ',');
      continue;
    }

    const createMatch = raw.match(/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w.]+)\s*\(\s*$/i);
    if (createMatch) {
      inCreate = { table: createMatch[1], defs: [] };
      out.push(raw.replace(/`/g, '').replace(/^(CREATE\s+TABLE\s+)/i, '$1'));
      continue;
    }

    // ---- MySQL 幂等补列整段（SET @ … PREPARE/EXECUTE）→ TODO ----
    if (/^\s*(SET\s+@|PREPARE\s|EXECUTE\s|DEALLOCATE\s)/i.test(raw)) {
      if (!inIdempotentNote) {
        out.push(`-- TODO(真机校验): 以下 MySQL 幂等补列脚本需人工转写为 ${dialect.name} 方言`);
        inIdempotentNote = true;
      }
      out.push(`-- ${raw}`);
      continue;
    }
    inIdempotentNote = false;

    // ---- 纯注释：mysql 客户端命令提示改写为目标库 ----
    if (/^\s*--/.test(raw)) {
      const c = raw.replace(/mysql\s+-u\s+root\s+-p\s+--default-character-set=utf8mb4\s+\w+\s*<\s*\S+/gi,
        `psql -d <database> -f sql/dialect/${dialect.name}.sql`);
      out.push(c);
      continue;
    }

    // ---- 普通行（INSERT / ALTER / 空行等）----
    out.push(convertLine(raw, dialect));
  }

  // CREATE TABLE 未正常闭合（源脚本异常）时兜底
  if (inCreate) out.push(');');

  const result = [...out, '', `-- ===== ${dialect.name} 索引/约束/注释 =====`, ...trailing].join('\n');
  return result.replace(/\n{3,}/g, '\n\n') + '\n';
}

/** 生成一种方言的完整建库脚本 */
export function generateDialectSql(driver) {
  const dialect = getDialect(driver);
  if (!dialect || !PG_DRIVERS.includes(driver)) throw new Error(`不支持生成 ${driver} 的 DDL`);
  const parts = [
    `-- starter 建库脚本（${dialect.name} / ${dialect.note || 'PG 兼容'}）`,
    '-- 由 scripts/generate-dialect-ddl.mjs 自动生成，请勿手工编辑；修改源脚本后重新生成。',
    '-- ⚠️ 未经真机验证，执行前请先在小库演练。\n',
  ];
  for (const file of SQL_FILES) {
    const src = fs.readFileSync(path.join(serverDir, file), 'utf8');
    parts.push(`-- ===== ${file} =====`);
    parts.push(convertScript(src, dialect).trim());
  }
  return parts.join('\n\n') + '\n';
}

function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const generated = {};
  for (const driver of PG_DRIVERS) {
    generated[driver] = generateDialectSql(driver);
    if (!checkOnly) fs.writeFileSync(path.join(outDir, `${driver}.sql`), generated[driver], 'utf8');
  }
  if (checkOnly) {
    let ok = true;
    for (const driver of PG_DRIVERS) {
      const target = path.join(outDir, `${driver}.sql`);
      const existing = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
      if (existing !== generated[driver]) {
        console.error(`[check] ${driver}.sql 与源脚本不一致，请运行 node scripts/generate-dialect-ddl.mjs`);
        ok = false;
      }
    }
    if (ok) console.log('[check] 所有方言 DDL 与源脚本一致');
    else process.exitCode = 1;
  } else {
    for (const driver of PG_DRIVERS) console.log(`[generated] sql/dialect/${driver}.sql`);
  }
}

// 仅在直接执行时生成；被测试/其他模块 import 时不产生写文件副作用
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run();
}

export default generateDialectSql;
