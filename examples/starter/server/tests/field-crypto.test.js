/**
 * 数据安全 C3：字段级加解密 / 脱敏 / 导出风险分级
 */
import { describe, it, expect } from 'vitest';
import {
  createFieldCrypto, encryptField, decryptField, rotateField, isEncrypted,
} from '../services/field-crypto.js';
import {
  encryptRow, decryptRow, maskRow, maskValue, riskLevelOf, fieldsOf,
} from '../services/sensitive-fields.js';

const KEY_A = 'master-key-A-2026';
const KEY_B = 'master-key-B-2026';

describe('字段级加解密（AES-256-GCM）', () => {
  it('加解密往返一致', () => {
    const fc = createFieldCrypto({ secret: KEY_A });
    const cipher = fc.encrypt('13800138000');
    expect(isEncrypted(cipher)).toBe(true);
    expect(fc.decrypt(cipher)).toBe('13800138000');
  });

  it('相同明文两次加密结果不同（随机 salt+iv）', () => {
    const a = encryptField('同一明文', KEY_A);
    const b = encryptField('同一明文', KEY_A);
    expect(a).not.toBe(b);
  });

  it('null / 空串 / 已加密值原样返回', () => {
    const fc = createFieldCrypto({ secret: KEY_A });
    expect(fc.encrypt(null)).toBe(null);
    expect(fc.encrypt('')).toBe('');
    const once = fc.encrypt('x');
    expect(fc.encrypt(once)).toBe(once);
  });

  it('明文原样返回（兼容迁移前存量）', () => {
    const fc = createFieldCrypto({ secret: KEY_A });
    expect(fc.decrypt('13800138000')).toBe('13800138000');
  });

  it('篡改密文或认证标签 → 返回 fallback，绝不返回错误明文', () => {
    const fc = createFieldCrypto({ secret: KEY_A });
    const cipher = fc.encrypt('机密数据');
    const parts = cipher.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');
    expect(fc.decrypt(parts.join(':'), 'BAD')).toBe('BAD');
  });

  it('密钥轮换：旧密钥密文可用 新+旧 解密，rotate 后旧密钥单独解不开', () => {
    const oldCipher = encryptField('轮换测试', KEY_A);
    const fc = createFieldCrypto({ secret: KEY_B, previousSecrets: [KEY_A] });
    expect(fc.decrypt(oldCipher)).toBe('轮换测试');
    const rotated = fc.rotate(oldCipher);
    expect(rotated).not.toBe(oldCipher);
    expect(fc.decrypt(rotated)).toBe('轮换测试');
    expect(decryptField(rotated, [KEY_A], null)).toBe(null);
  });

  it('缺密钥时工厂抛错（不静默降级）', () => {
    expect(() => createFieldCrypto({ secret: '', previousSecrets: [] }))
      .toThrow(/密钥/);
  });
});

describe('敏感字段注册表与脱敏', () => {
  const fc = createFieldCrypto({ secret: KEY_A });

  it('employees 注册了身份证/手机号/邮箱等字段', () => {
    const reg = fieldsOf('employees');
    expect(reg.idCard.level).toBe('HIGH');
    expect(reg.phone.mask).toBe('phone');
  });

  it('写库加密 → 读库解密往返', () => {
    const row = { name: '张三', phone: '13800138000', idCard: '110101199001011234', address: '北京市朝阳区某路1号' };
    const secured = encryptRow('employees', row, fc);
    expect(secured.name).toBe('张三');
    expect(isEncrypted(secured.phone)).toBe(true);
    const plain = decryptRow('employees', secured, fc);
    expect(plain.phone).toBe('13800138000');
    expect(plain.idCard).toBe('110101199001011234');
  });

  it('密码哈希不下发（never 字段被移除）', () => {
    const out = decryptRow('users', { id: 1, password: '$2b$10$xxx' }, fc);
    expect(out.password).toBeUndefined();
    expect(out.id).toBe(1);
  });

  it('脱敏：手机/身份证/邮箱/姓名/地址', () => {
    expect(maskValue('13800138000', 'phone')).toBe('138****8000');
    expect(maskValue('110101199001011234', 'idcard')).toBe('110***********1234');
    expect(maskValue('zhangsan@example.com', 'email')).toMatch(/^z\*\*\*@example\.com$/);
    expect(maskValue('张三丰', 'name')).toBe('张*');
    expect(maskValue('北京市朝阳区建国路', 'address')).toBe('北京市朝阳区…');
    expect(maskValue('secret', 'never')).toBe('[已隐藏]');
  });

  it('maskRow 只改注册字段', () => {
    const out = maskRow('employees', { name: '张三', phone: '13800138000', department: '技术部' });
    expect(out.name).toBe('张三');
    expect(out.phone).toBe('138****8000');
    expect(out.department).toBe('技术部');
  });

  it('导出风险分级：无命中=low，PII=medium，身份证/密码=high', () => {
    expect(riskLevelOf('employees', ['name', 'department'])).toBe('low');
    expect(riskLevelOf('employees', ['phone', 'email'])).toBe('medium');
    expect(riskLevelOf('employees', ['idCard'])).toBe('high');
    expect(riskLevelOf('users', ['password'])).toBe('high');
  });
});
