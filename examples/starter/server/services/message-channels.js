/**
 * 统一消息通道（底座第 5 部分：Message Service）
 * 业务系统只调 sendMessage({ channel, to, title, content })，不关心底层渠道。
 *
 * 四通道：
 *   inapp  站内信 —— 已实现，写 notifications 表（WebSocket 轮询由前端铃铛完成）
 *   email  邮件   —— 预留：配置了 SMTP_* 则发真实邮件，否则控制台适配器（打印日志）
 *   sms    短信   —— 预留：配置了 SMS_* 则调服务商，否则控制台适配器
 *   wechat 微信   —— 预留：配置了 WECHAT_* 则调公众号/企微，否则控制台适配器
 *
 * "有配置走真实通道，无配置走控制台" = 后续有外部资源时填 .env 即可直接用，无需改代码。
 */
import fs from 'fs';
import path from 'path';

const logDir = path.join(process.cwd(), 'logs');
fs.mkdirSync(logDir, { recursive: true });
const LOG_FILE = path.join(logDir, 'message-center.log');

function logLine(entry) {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
  console.log('[消息中心]', entry.channel, '→', entry.to, entry.mode || '');
}

/** 站内信：写 notifications 表（复用现有体系，广播 recipient='*'） */
async function sendInApp(pool, { to = '*', type = 'system', title, content = '', link = null }) {
  if (!title) throw new Error('站内信标题必填');
  await pool.execute(
    'INSERT INTO notifications (recipient, type, title, content, link, isRead, createdAt) VALUES (?,?,?,?,?,0,NOW())',
    [to, type, title, content, link]
  );
  return { channel: 'inapp', to, mode: 'db', ok: true };
}

/** 邮件：有 SMTP 配置走 nodemailer（若已安装），否则控制台 */
async function sendEmail({ to, title, content }) {
  const host = process.env.SMTP_HOST;
  if (host) {
    try {
      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host, port: +(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({
        from: process.env.SMTP_FROM || process.env.SMTP_USER,
        to, subject: title, text: content,
      });
      return { channel: 'email', to, mode: 'smtp', ok: true };
    } catch (e) {
      return { channel: 'email', to, mode: 'smtp', ok: false, error: e.message };
    }
  }
  return { channel: 'email', to, mode: 'console', ok: true, note: '未配置 SMTP_HOST，已写入消息日志（控制台适配器）' };
}

/** 短信：预留服务商接口，有 SMS_API_URL 走 HTTP，否则控制台 */
async function sendSms({ to, content }) {
  if (process.env.SMS_API_URL) {
    try {
      const resp = await fetch(process.env.SMS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.SMS_API_KEY || ''}` },
        body: JSON.stringify({ phone: to, content, sign: process.env.SMS_SIGN || '' }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error('upstream ' + resp.status);
      return { channel: 'sms', to, mode: 'provider', ok: true };
    } catch (e) {
      return { channel: 'sms', to, mode: 'provider', ok: false, error: e.message };
    }
  }
  return { channel: 'sms', to, mode: 'console', ok: true, note: '未配置 SMS_API_URL，已写入消息日志（控制台适配器）' };
}

/** 微信：预留公众号/企微接口，有 WECHAT_WEBHOOK 走推送，否则控制台 */
async function sendWechat({ to, title, content }) {
  if (process.env.WECHAT_WEBHOOK) {
    try {
      const resp = await fetch(process.env.WECHAT_WEBHOOK, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msgtype: 'text', text: { content: `${title}\n${content}`, mentioned_list: to ? [to] : [] } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!resp.ok) throw new Error('upstream ' + resp.status);
      return { channel: 'wechat', to, mode: 'webhook', ok: true };
    } catch (e) {
      return { channel: 'wechat', to, mode: 'webhook', ok: false, error: e.message };
    }
  }
  return { channel: 'wechat', to, mode: 'console', ok: true, note: '未配置 WECHAT_WEBHOOK，已写入消息日志（控制台适配器）' };
}

/**
 * 统一入口：业务系统只需调这个函数
 * @param {object} pool mysql2 连接池
 * @param {object} opts { channel: 'inapp'|'email'|'sms'|'wechat', to, title, content, link, type }
 */
export async function sendMessage(pool, opts) {
  const channel = opts.channel || 'inapp';
  let result;
  switch (channel) {
    case 'inapp': result = await sendInApp(pool, opts); break;
    case 'email': result = await sendEmail(opts); break;
    case 'sms': result = await sendSms(opts); break;
    case 'wechat': result = await sendWechat(opts); break;
    default: throw new Error(`未知消息通道: ${channel}`);
  }
  logLine({ channel, to: opts.to, title: opts.title, ...result });
  return result;
}

/** 通道配置状态（前端展示哪些通道已就绪） */
export function channelStatus() {
  return {
    inapp: { ready: true, mode: 'db', note: '站内信，已实现' },
    email: { ready: !!process.env.SMTP_HOST, mode: process.env.SMTP_HOST ? 'smtp' : 'console', note: process.env.SMTP_HOST ? 'SMTP 已配置' : '控制台适配器（填 SMTP_* 启用）' },
    sms: { ready: !!process.env.SMS_API_URL, mode: process.env.SMS_API_URL ? 'provider' : 'console', note: process.env.SMS_API_URL ? '短信服务商已配置' : '控制台适配器（填 SMS_* 启用）' },
    wechat: { ready: !!process.env.WECHAT_WEBHOOK, mode: process.env.WECHAT_WEBHOOK ? 'webhook' : 'console', note: process.env.WECHAT_WEBHOOK ? '企微机器人已配置' : '控制台适配器（填 WECHAT_WEBHOOK 启用）' },
  };
}

/** 读取最近消息日志（管理端可查） */
export function readMessageLog(limit = 50) {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    return fs.readFileSync(LOG_FILE, 'utf8').trim().split('\n').filter(Boolean)
      .slice(-limit).reverse().map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  } catch { return []; }
}
