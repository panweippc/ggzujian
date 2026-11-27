/**
 * Cron 可视化辅助（纯函数，零依赖）：标准 5 段「分 时 日 月 周」
 * 提供：人类可读描述 describe() + 下次执行时间 nextRun() + 字段解析 parse()
 * 供前端可视化编辑器通过 /api/cron/* 调用，保证前后端口径一致。
 */

export function parse(expr) {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('Cron 需为 5 段：分 时 日 月 周');
  const [min, hour, day, month, week] = parts;
  const num = (s, minV, maxV, name) => {
    if (!/^\d+$/.test(s)) throw new Error(`${name} 段不支持复杂表达式：${s}`);
    const n = +s;
    if (n < minV || n > maxV) throw new Error(`${name} 超出范围 ${minV}-${maxV}：${s}`);
    return n;
  };
  return {
    minute: min === '*' ? '*' : num(min, 0, 59, '分钟'),
    hour: hour === '*' ? '*' : num(hour, 0, 23, '小时'),
    day: day === '*' ? '*' : num(day, 1, 31, '日'),
    month: month === '*' ? '*' : num(month, 1, 12, '月'),
    week: week === '*' ? '*' : num(week, 0, 7, '周'),
    raw: parts,
  };
}

/** 人类可读描述（覆盖常见模式，复杂表达式给出结构说明） */
export function describe(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5) return { ok: false, text: 'Cron 需为 5 段：分 时 日 月 周' };
  if (f.some(seg => !/^(\d+|\*|\*\/\d+)$/.test(seg))) {
    return { ok: false, text: '含不支持的表达式段（仅支持数字、*、*/n）' };
  }
  const [min, hour, day, month, week] = f;
  const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
  if (f.join(' ') === '* * * * *') return { ok: true, text: '每分钟执行一次' };
  if (/^\*\/\d+$/.test(min) && hour === '*' && day === '*' && month === '*' && week === '*') {
    return { ok: true, text: `每 ${min.slice(2)} 分钟执行一次` };
  }
  if (/^\*\/\d+$/.test(hour) && min === '0' && day === '*' && month === '*' && week === '*') {
    return { ok: true, text: `每 ${hour.slice(2)} 小时执行一次（整点）` };
  }
  if (min !== '*' && hour !== '*' && day === '*' && month === '*' && week === '*') {
    return { ok: true, text: `每天 ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} 执行` };
  }
  if (min !== '*' && hour !== '*' && day === '*' && month === '*' && week !== '*') {
    const w = +week % 7;
    return { ok: true, text: `每周${WEEK[w]} ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} 执行` };
  }
  if (min !== '*' && hour !== '*' && day !== '*' && month === '*') {
    return { ok: true, text: `每月 ${day} 日 ${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')} 执行` };
  }
  return { ok: true, text: `按表达式执行（分=${min} 时=${hour} 日=${day} 月=${month} 周=${week}）` };
}

/**
 * 下次执行时间（简化算法：仅支持固定数字段与每分钟/每小时/每天模式；
 * 复杂步长表达式返回 null 让前端显示「请手动确认」）
 */
export function nextRun(expr, from = new Date()) {
  let p;
  try { p = parse(expr); } catch { return null; }
  const [min, hour, day, month, week] = p.raw;
  const d = new Date(from);
  d.setSeconds(0, 0);

  if (min === '*' && hour === '*' && day === '*' && month === '*' && week === '*') {
    d.setMinutes(d.getMinutes() + 1); return d;
  }
  if (/^\*\/\d+$/.test(min) && hour === '*') {
    const step = +min.slice(2); d.setMinutes(Math.ceil((d.getMinutes() + 1) / step) * step); return d;
  }
  if (min !== '*' && hour !== '*' && day === '*' && month === '*' && week === '*') {
    d.setHours(+hour, +min, 0, 0);
    if (d <= from) d.setDate(d.getDate() + 1);
    return d;
  }
  if (min !== '*' && hour !== '*' && day === '*' && month === '*' && week !== '*') {
    const target = +week % 7;
    d.setHours(+hour, +min, 0, 0);
    for (let i = 0; i < 8 && (d.getDay() !== target || d <= from); i++) d.setDate(d.getDate() + 1);
    return d;
  }
  if (min !== '*' && hour !== '*' && day !== '*') {
    d.setDate(+day); d.setHours(+hour, +min, 0, 0);
    if (d <= from) d.setMonth(d.getMonth() + 1);
    return d;
  }
  return null;
}

export default { parse, describe, nextRun };
