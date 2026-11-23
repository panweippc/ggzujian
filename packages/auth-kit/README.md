# @panweippc/auth-kit

通用后端认证与安全工具包。**零业务耦合**，所有项目相关的依赖（密钥、数据库、用户查询、角色判定）都通过配置/回调注入。

## 安装

```bash
# 本地开发（未发包前）
npm install file:../shared-pkgs/packages/auth-kit

# 发包后
npm install @panweippc/auth-kit --registry=https://npm.pkg.github.com
```

## 模块

### 1. security — JWT / 密码

```js
import { createSecurity, hashPassword, verifyPassword, validatePassword, generateRandomPassword } from '@panweippc/auth-kit';

const { signToken, verifyToken, buildLoginPayload } = createSecurity({
  secret: process.env.JWT_SECRET,
  previousSecret: process.env.JWT_SECRET_PREVIOUS, // 可选，密钥无感轮换
  expires: '12h'
});

const payload = buildLoginPayload({ id: 1, username: 'admin', password: hash, roleName: '管理员', tokenVersion: 0 });
const token = signToken(payload);
const decoded = verifyToken(token);

validatePassword('Abcdefgh1!', 'admin'); // null=通过，否则返回中文错误
```

### 2. captcha — SVG 验证码

```js
import { createCaptcha } from '@panweippc/auth-kit';
const captcha = createCaptcha({ ttl: 5 * 60 * 1000 }); // 默认内存存储，多实例可传 store

// GET /captcha
const { token, svg } = captcha.generate(); // svg 直接作为 img src
// 登录时校验
captcha.verify(token, userInput); // 'ok' | 'wrong' | 'expired'（一次性消费）
```

多实例部署传自定义 `store`（实现 `set(token, code)` 与 `consume(token, input)`）：

```js
createCaptcha({ store: redisCaptchaStore });
```

### 3. audit — 操作日志

```js
import { createAudit } from '@panweippc/auth-kit';
// 表名/列名与默认不同的项目传 columns 映射
const audit = createAudit({ table: 'sys_operation_log', columns: { username: 'operator' } });

await audit.createOperationLog(pool, { userId: 1, username: 'admin', action: 'login', module: 'auth', detail: 'ok' });
await audit.logDataChange(pool, { module: 'user', username: 'admin', targetId: 5, beforeValue: oldRow, afterValue: newRow });
```

### 4. requireAuth — 鉴权中间件工厂

```js
import { createSecurity, createRequireAuth } from '@panweippc/auth-kit';
const { verifyToken } = createSecurity({ secret: process.env.JWT_SECRET });

const { requireAuth } = createRequireAuth({
  verifyToken,
  publicPaths: [
    { method: 'POST', path: '/login' },
    { method: 'GET', path: '/captcha' },
    { method: 'GET', path: '/public/overview', prefix: true }
  ],
  // 可选：密码指纹 / 会话版本二次校验（防止改密/踢人后旧 token 仍有效）
  findUserByUsername: async (username) => {
    const [rows] = await pool.execute('SELECT password, tokenVersion FROM users WHERE username = ?', [username]);
    const u = rows[0];
    return u ? { pwdFingerprint: String(u.password).slice(0, 12), tokenVersion: u.tokenVersion } : null;
  },
  normalizeUsername: (u) => u.replace(/^emp_/, '').split('_')[0] // qygl 的 emp_姓名_id 格式
});
app.use('/api', requireAuth);
```

### 5. security-alert — 安全告警

```js
import { createSecurityAlert } from '@panweippc/auth-kit';
const alert = createSecurityAlert({
  logDir: path.join(process.cwd(), 'logs'), // 必须显式指定
  webhookUrl: process.env.ALERT_WEBHOOK_URL,
  onHighRisk: ({ title, content }) => sendMail(title, content) // 可选：邮件等
});
alert.writeSecurityAlert({ level: 'HIGH', type: 'login_brute_force', username: 'admin', ip: '1.2.3.4', detail: '...' });
```

## 测试

```bash
npm test   # Node 内置 test runner，10 项全绿
```
