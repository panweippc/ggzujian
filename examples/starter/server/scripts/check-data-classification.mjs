#!/usr/bin/env node
/**
 * 数据分类分级扫描（零依赖）：从建表脚本识别疑似 PII 字段，对照敏感字段注册表找漏登记项。
 *
 * 检查项：
 *   1) 解析 db-all.sql 的表与列（含 COMMENT）
 *   2) 字段名/注释命中 PII 模式（手机/身份证/邮箱/地址/银行卡/姓名...）
 *   3) 未登记到 SENSITIVE_FIELDS 的字段 → warn（需人工确认是否敏感）
 *   4) 已登记字段有 mask 策略 → pass；无 mask → warn
 *
 * 用法：node scripts/check-data-classification.mjs [--json] [--strict]
 * 说明：按命名启发式识别，误报需人工排除；注册表是运行时加密/脱敏的唯一入口，漏登记意味着不生效。
 */
import path from 'node:path';
import { SERVER, parseArgs, readOr, finish } from './_check-utils.mjs';
import { SENSITIVE_FIELDS } from '../services/sensitive-fields.js';

const args = parseArgs();
const findings = [];
const add = (level, message, file = '') => findings.push({ level, message, file });

const sql = readOr(path.join(SERVER, 'db-all.sql'));
const tableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?\s*\(([\s\S]*?)\n\)\s*(?:ENGINE|;)/gi;
const PII = /(phone|mobile|id_?card|identity|email|e_mail|address|bank_?card|real_?name|emergency|birth|姓名|手机|身份证|邮箱|地址|银行卡)/i;
const SKIP_TABLE = /^(schema_migrations|operation_logs|operation_logs_archive|migrations|scheduled_tasks|audit)/i;

let tableCount = 0, columnCount = 0, sensitiveCount = 0, registered = 0;
for (const m of sql.matchAll(tableRe)) {
  const table = m[1];
  tableCount++;
  if (SKIP_TABLE.test(table)) continue;
  const reg = SENSITIVE_FIELDS[table] || {};
  for (const line of m[2].split(/\r?\n/)) {
    const cm = line.match(/^\s*`?([A-Za-z_][\w]*)`?\s+\w/);
    if (!cm) continue;
    columnCount++;
    const col = cm[1];
    const comment = (line.match(/COMMENT\s+'([^']*)'/i) || [])[1] || '';
    if (!PII.test(col) && !PII.test(comment)) continue;
    sensitiveCount++;
    if (reg[col]) {
      registered++;
      if (reg[col].mask && reg[col].mask !== 'none') {
        add('pass', `${table}.${col} 已登记且配置脱敏（${reg[col].mask}）`, 'server/services/sensitive-fields.js');
      } else {
        add('warn', `${table}.${col} 已登记但未配置脱敏策略`, 'server/services/sensitive-fields.js');
      }
    } else {
      add('warn', `${table}.${col} 疑似 PII（${comment || col}）但未登记到 SENSITIVE_FIELDS`, 'server/db-all.sql');
    }
  }
}
if (!tableCount) add('warn', 'db-all.sql 未解析到 CREATE TABLE，跳过字段扫描', 'server/db-all.sql');

finish('数据分类分级扫描', {
  tables: tableCount, columns: columnCount,
  suspectedPii: sensitiveCount, registered,
  unregistered: sensitiveCount - registered,
}, findings, args, {
  disclaimer: '命名启发式识别；注册表是运行时加密/脱敏的唯一入口，漏登记则保护不生效',
});
