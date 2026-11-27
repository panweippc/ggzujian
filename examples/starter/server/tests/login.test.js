/**
 * 关键路径 1/3：登录
 * server.js 的 /api/login 内联在入口文件（未导出 app），这里对登录路径依赖的四个纯能力做组合测试：
 *   验证码 → 密码校验 → 改密指纹 → token 签发/验证 → 会话版本
 * 覆盖：成功 / 验证码错误·过期 / 密码错误·明文兼容 / 改密后旧 token 失效 / 换设备失效 / 密钥轮换
 */
import { describe, it, expect } from 'vitest';
import {
  createCaptcha, createSecurity, verifyPassword, pwdFingerprint,
  hashPassword, buildLoginPayload, validatePassword
} from '@panweippc/auth-kit';

const SECRET = 'test-secret-for-login-path-only';
const security = createSecurity({ secret: SECRET, previousSecret: 'old-secret', expires: '1h' });

describe('登录路径 · 验证码', () => {
  it('正确验证码一次性消费成功，二次复用失败', () => {
    const captcha = createCaptcha({ ttl: 60_000 });
    const { token, svgRaw } = captcha.generate();
    const code = Array.from(svgRaw.matchAll(/<text[^>]*>([^<]+)<\/text>/g)).map(m => m[1]).join('');
    expect(code.length).toBeGreaterThan(0);
    expect(captcha.verify(token, code)).toBe('ok');
    expect(captcha.verify(token, code)).not.toBe('ok'); // 一次性消费，防重放（存储删除后返回 expired/wrong）
  });

  it('验证码错误返回 wrong，过期返回 expired', () => {
    const captcha = createCaptcha({ ttl: -1 });
    const { token } = captcha.generate();
    expect(captcha.verify(token, '0000')).toBe('expired');
    const normal = createCaptcha({ ttl: 60_000 });
    const g = normal.generate();
    expect(normal.verify(g.token, 'not-the-code')).toBe('wrong');
  });
});

describe('登录路径 · 密码校验', () => {
  it('bcrypt 正确密码通过，错误密码拒绝', () => {
    const hash = hashPassword('Test@2026pass', 8);
    expect(verifyPassword('Test@2026pass', hash)).toBe(true);
    expect(verifyPassword('bad-password', hash)).toBe(false);
  });

  it('存量明文密码兼容（verifyPassword 直接比对）', () => {
    expect(verifyPassword('legacyplain', 'legacyplain')).toBe(true);
  });

  it('改密后密码指纹变化 → 旧 token 401 拦截依据成立', () => {
    const before = pwdFingerprint(hashPassword('Old@2026pass', 8));
    const after = pwdFingerprint(hashPassword('New@2026pass', 8));
    expect(before).not.toBe(after);
  });

  it('弱密码被拒绝（与登录改密规则一致）', () => {
    expect(validatePassword('short', 'someone')).toMatch(/长度/);
    expect(validatePassword('Abcdefgh1!', 'someone')).toBeNull();
  });
});

describe('登录路径 · token 签发与会话', () => {
  const user = { id: 7, username: 'alice', password: hashPassword('Test@2026pass', 8), roleName: 'user', tokenVersion: 2 };

  it('签发 token 含正确 payload 且可验证', () => {
    const payload = buildLoginPayload(user);
    const token = security.signToken(payload);
    const decoded = security.verifyToken(token);
    expect(decoded.username).toBe('alice');
    expect(decoded.role).toBe('user');
    expect(decoded.ver).toBe(2);
    expect(decoded.pwd).toBe(pwdFingerprint(user.password));
  });

  it('篡改 token 被拒绝', () => {
    const token = security.signToken(buildLoginPayload(user));
    expect(() => security.verifyToken(token + 'tampered')).toThrow();
  });

  it('上一把密钥签发的 token 在轮换期内仍可验证（无感轮换）', () => {
    const old = createSecurity({ secret: 'old-secret', expires: '1h' });
    const token = old.signToken(buildLoginPayload(user));
    expect(security.verifyToken(token).username).toBe('alice');
  });

  it('改密/换设备后 payload 指纹或版本不一致 → 中间件可识别', () => {
    const oldPayload = buildLoginPayload(user);
    const changed = buildLoginPayload({ ...user, password: hashPassword('New@2026pass', 8), tokenVersion: 3 });
    expect(changed.pwd).not.toBe(oldPayload.pwd);
    expect(changed.ver).not.toBe(oldPayload.ver);
  });
});
