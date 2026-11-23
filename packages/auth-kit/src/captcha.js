/**
 * 服务端 SVG 验证码（纯逻辑，无 Express 依赖）
 *
 * 设计：后端生成随机码 + 一次性 token（默认 5 分钟有效），登录时后端比对。
 * 存储默认用内存 Map（单实例 fork 部署安全）；多实例部署请传入自定义 store（如 Redis 适配器）。
 */
import { randomBytes } from 'crypto';

const DEFAULT_COLORS = ['#1E5AA8', '#2E6FB8', '#2E9E83', '#C0392B', '#B77410', '#5B8FC9'];

function genCode(len = 4) {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去除易混字符 0/O/1/l/I
  let s = '';
  for (let i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** 生成 SVG 文本（纯字符串，无原生依赖） */
export function genCaptchaSvg(code, opts = {}) {
  const { width = 110, height = 42, colors = DEFAULT_COLORS, background = '#f3f6fb' } = opts;
  const W = width, H = height;
  let noise = '';
  for (let i = 0; i < 4; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    const x1 = (Math.random() * W).toFixed(1), y1 = (Math.random() * H).toFixed(1);
    const x2 = (Math.random() * W).toFixed(1), y2 = (Math.random() * H).toFixed(1);
    noise += `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="${c}" stroke-width="1" opacity="0.45"/>`;
  }
  for (let i = 0; i < 22; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    noise += `<circle cx="${(Math.random() * W).toFixed(1)}" cy="${(Math.random() * H).toFixed(1)}" r="1" fill="${c}" opacity="0.5"/>`;
  }
  const cw = W / code.length;
  let chars = '';
  for (let i = 0; i < code.length; i++) {
    const c = colors[Math.floor(Math.random() * colors.length)];
    const x = (cw * i + cw / 2).toFixed(1);
    const y = (H / 2 + (Math.random() - 0.5) * 8).toFixed(1);
    const rot = ((Math.random() - 0.5) * 40).toFixed(1);
    const fs = (20 + Math.random() * 8).toFixed(1);
    chars += `<text x="${x}" y="${(parseFloat(y) + parseFloat(fs) / 3).toFixed(1)}" font-family="Arial,Helvetica,sans-serif" font-size="${fs}" font-weight="bold" fill="${c}" text-anchor="middle" transform="rotate(${rot} ${x} ${y})">${code[i]}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
    `<rect width="${W}" height="${H}" fill="${background}"/>` +
    `<path d="M0 ${H / 2} Q${W / 4} ${H / 4} ${W / 2} ${H / 2} T${W} ${H / 2}" stroke="#cdd9e8" stroke-width="1" fill="none"/>` +
    `${noise}${chars}</svg>`;
}

/** 默认内存存储适配器 */
function memoryStore(ttl) {
  const data = new Map();
  return {
    set(token, code) {
      data.set(token, { code, expires: Date.now() + ttl });
      if (Math.random() < 0.05) {
        for (const [k, v] of data) if (v.expires < Date.now()) data.delete(k);
      }
    },
    /** 校验成功后自动消费（一次性，防重放） */
    consume(token, input) {
      const item = data.get(token);
      if (!item || item.expires < Date.now()) { data.delete(token); return 'expired'; }
      if (String(item.code).toLowerCase() !== String(input || '').toLowerCase()) { data.delete(token); return 'wrong'; }
      data.delete(token);
      return 'ok';
    }
  };
}

/**
 * 创建验证码服务。
 * @param {object} [config]
 * @param {number} [config.ttl=300000] 有效期毫秒
 * @param {number} [config.length=4] 字符数
 * @param {object} [config.store] 自定义存储，需实现 set(token,code) 与 consume(token,input)->'ok'|'wrong'|'expired'
 * @param {object} [config.svgOpts] 传给 genCaptchaSvg 的样式选项
 */
export function createCaptcha(config = {}) {
  const ttl = config.ttl ?? 5 * 60 * 1000;
  const length = config.length ?? 4;
  const store = config.store ?? memoryStore(ttl);
  const svgOpts = config.svgOpts ?? {};

  /** 生成一张验证码，返回 { token, svg }；svg 为 dataURL，直接作为 img src */
  const generate = () => {
    const code = genCode(length);
    const token = randomBytes(16).toString('hex');
    store.set(token, code);
    const svg = genCaptchaSvg(code, svgOpts);
    return { token, svg: `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`, svgRaw: svg };
  };

  /** 校验：返回 'ok' | 'wrong' | 'expired' */
  const verify = (token, input) => store.consume(token, input);

  return { generate, verify };
}

export default { genCaptchaSvg, createCaptcha };
