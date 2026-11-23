# starter — 新项目最小可运行示例

这是一个"从零接入公共包"的完整骨架。它演示了 auth-kit 的全部后端能力和 admin-ui 的四个页面组件。**复制整个 `starter` 目录到你的新项目，改几处配置就能跑。**

## 目录结构

```
starter/
├── server/                # 后端（Node + Express + MySQL）
│   ├── package.json       # 依赖 auth-kit（file: 引用，发包后改包名）
│   ├── .env.example       # 环境变量模板（复制为 .env 并填值）
│   ├── db.sql             # 最小表结构（用户表 + 操作日志表）
│   └── server.js          # 完整接线：JWT/验证码/审计/告警/鉴权/登录
└── web/                   # 前端（Vue3 + Vite + Element Plus）
    ├── package.json       # 依赖 admin-ui（file: 引用）
    ├── vite.config.ts     # 关键：让 node_modules 里的 .vue 能被编译
    ├── index.html
    └── src/
        ├── main.ts        # 装拦截器/fetch token/空闲检测
        ├── api.ts         # 请求封装
        ├── config.ts      # ★ 项目品牌配置（新项目主要改这里）
        ├── router.ts      # 路由 + 守卫
        ├── App.vue
        └── views/
            ├── LoginView.vue   # LoginPanel
            └── HomeView.vue    # AccountDropdown + CrudPanel + OperationLogPanel
```

## 三步跑起来

### ① 准备数据库

```bash
mysql -u root -p < server/db.sql
# 编辑 server/.env（从 .env.example 复制），填数据库密码和 JWT_SECRET
cp server/.env.example server/.env
```

生成管理员密码哈希并插入用户：

```bash
cd server && npm i
node -e "import('@panweippc/auth-kit').then(m=>console.log(m.hashPassword('Admin@2026pass')))"
# 把输出的哈希填入下面的 SQL 并在 MySQL 执行
# INSERT INTO users(username,password,role) VALUES('admin','<上一步的哈希>','admin');
```

### ② 启动后端

```bash
cd server && npm run dev     # 监听 3010
curl http://localhost:3010/api/health   # 应返回 {"status":"ok","db":"up"}
```

### ③ 启动前端

```bash
cd web && npm i && npm run dev   # 监听 3008，/api 代理到 3010
```

浏览器打开 `http://localhost:3008`，用 `admin / Admin@2026pass` 登录，即可看到登录页、账号区、用户管理、操作日志四个模块正常工作。

## 新项目要改哪里

| 想改的东西 | 改哪个文件 |
|---|---|
| 项目名/Logo/主色 | `web/src/config.ts` |
| 后端接口地址 | `web/src/api.ts`、`server/server.js` 业务路由 |
| 用户表结构 | `server/db.sql` + `server/server.js` 里的 SQL 和 `findUserByUsername` |
| 页面字段/列 | `web/src/views/HomeView.vue` 里的 `userConfig` / `logConfig` |
| 品牌增强（天气/公告等） | `LoginView.vue` 的 `#extra` 插槽 |
| JWT 密钥/数据库密码 | `server/.env`（绝不入库） |

> 更详细的逐步骤讲解、原理和常见坑，见 [../../docs/新项目接入指南.md](../../docs/新项目接入指南.md)。
