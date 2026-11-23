# shared-pkgs — 管理后台公共模块 Monorepo

把 qygl（OA）与 wygl（智慧物业）共用的登录/认证/系统管理/操作日志/账号区能力抽离成可复用包，供后续所有项目使用。

## 包结构

```
shared-pkgs/
├── packages/
│   ├── auth-kit/    @panweippc/auth-kit   后端：JWT/密码/验证码/审计/鉴权中间件/安全告警
│   └── admin-ui/    @panweippc/admin-ui   前端：会话工具 + 配置化登录/账号区/CRUD/日志组件
├── docs/
│   └── 迁移指南.md   qygl/wygl 迁移步骤与验证清单
└── README.md
```

## 设计原则

1. **零业务耦合**：公共包不出现 `users`/`employees`/`resident_owner` 等业务表、不出现"总经理/业主"等业务角色、不写死项目名与配色。
2. **依赖注入**：密钥、数据库池、用户查询、角色判定全部通过 config/回调传入。
3. **配置驱动 + 插槽扩展**：前端组件提供通用骨架，业务增强以 props/slots 注入。
4. **可独立升级**：两包语义化版本，消费项目按需升级，改一处全局生效。

## 快速开始

```bash
# 安装依赖
cd packages/auth-kit && npm install
# 跑测试
npm test                       # 10/10 通过
# 前端工具由消费项目的 Vite 编译，无需单独构建
```

## 发包（GitHub Packages）

前置：GitHub PAT（需 `read:packages` / `write:packages` / `repo` 权限），本机配置：

```bash
npm login --registry=https://npm.pkg.github.com
# 用户名：panweippc；密码：粘贴 PAT
```

发包：

```bash
cd packages/auth-kit && npm publish
cd ../admin-ui && npm publish
```

消费项目 `.npmrc`：

```
@panweippc:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

## 迁移

见 [docs/迁移指南.md](docs/迁移指南.md)。
