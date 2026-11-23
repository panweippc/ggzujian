/**
 * 安全告警工具（配置化落盘路径 + 可选 Webhook 推送）
 *
 * 设计变更（相对 qygl 原版）：
 *  1. 日志目录通过 config.logDir 注入，不再用 __dirname 反推（包安装到 node_modules 后路径会错）。
 *  2. 邮件推送（nodemailer）属于可选能力，改为 onHighRisk 回调注入，避免包强依赖 nodemailer。
 *  3. Webhook（企业微信/钉钉）用内置 fetch 实现，零第三方依赖。
 */
import fs from 'fs';
import path from 'path';

const PAD = (n) => String(n).padStart(2, '0');
const fmtTime = (d = new Date()) =>
  `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())} ${PAD(d.getHours())}:${PAD(d.getMinutes())}:${PAD(d.getSeconds())}`;

/** 内置 Webhook 推送（企业微信/钉钉，零依赖） */
export async function pushWebhook({ url, type, title = '安全告警', content = '', level = 'WARN' }) {
  if (!url) return false;
  let kind = (type || '').toLowerCase();
  if (!kind) kind = url.includes('qyapi.weixin.qq.com') ? 'wecom' : url.includes('oapi.dingtalk.com') ? 'dingtalk' : '';
  if (!kind) return false;
  const text = `【${level}】${title}\n${content}`;
  const payload = { msgtype: 'text', text: { content: text } };
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000)
    });
    const data = await resp.json();
    return !data || data.errcode === 0 || data.errcode === undefined;
  } catch {
    return false;
  }
}

/**
 * 创建安全告警实例。
 * @param {object} config
 * @param {string} config.logDir 告警日志目录（建议传业务项目根目录/logs）
 * @param {string} [config.filename='security-alert.log'] 日志文件名
 * @param {string} [config.webhookUrl] 高危事件 webhook 地址
 * @param {string} [config.webhookType] wecom|dingtalk（可选，自动识别）
 * @param {function} [config.onHighRisk] 高危事件额外回调（如邮件通知）
 * @param {function} [config.onError] 错误回调
 */
export function createSecurityAlert(config = {}) {
  if (!config.logDir) throw new Error('createSecurityAlert: 必须提供 logDir');
  const alertFile = path.join(config.logDir, config.filename || 'security-alert.log');
  const onError = config.onError ?? ((m) => console.log(m));
  try { fs.mkdirSync(config.logDir, { recursive: true }); } catch { /* 忽略 */ }

  /**
   * 写安全告警（JSON 行）。高危事件额外推送 webhook + onHighRisk 回调。
   * @param {object} data { level, type, username, ip, detail }
   */
  function writeSecurityAlert({ level = 'WARN', type = 'generic', username = '', ip = '', detail = '' } = {}) {
    try {
      const line = JSON.stringify({ time: fmtTime(), level, type, username, ip, detail });
      fs.appendFileSync(alertFile, line + '\n', 'utf8');
      if (level === 'HIGH' || level === 'CRITICAL') {
        const content = `${detail || ''}${username ? `\n操作人: ${username}` : ''}${ip ? `\nIP: ${ip}` : ''}`;
        if (config.webhookUrl) {
          pushWebhook({ url: config.webhookUrl, type: config.webhookType, title: `安全告警（${type}）`, content, level }).catch(() => {});
        }
        if (config.onHighRisk) {
          try { config.onHighRisk({ type, title: `安全告警（${type}）`, content, level }); } catch { /* 忽略 */ }
        }
      }
    } catch (e) {
      onError('写入安全告警日志失败: ' + e.message);
    }
  }

  return { writeSecurityAlert, alertFile };
}

export default { pushWebhook, createSecurityAlert };
