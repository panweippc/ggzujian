# ggzujian — 管理后台公共模块 Monorepo

把 qygl（OA）与 wygl（智慧物业）共用的登录/认证/系统管理/操作日志/账号区能力抽离成可复用包，供后续所有项目使用。

仓库地址：`git@github.com:panweippc/ggzujian.git`（本地目录名仍为 shared-pkgs）

## 包结构

```
ggzujian/
├── packages/
│   ├── auth-kit/    @panweippc/auth-kit   后端：JWT/密码/验证码/审计/鉴权中间件/安全告警
│   └── admin-ui/    @panweippc/admin-ui   前端：会话工具 + 配置化登录/账号区/CRUD/日志组件
├── docs/
│   ├── 团队复用指南.md    ★ 其他人拉取本仓库后如何复用（发包 vs 不发包、拉取步骤、更新、常见问题）
│   ├── 迁移指南.md        qygl/wygl 迁移步骤与验证清单
│   └── 新项目接入指南.md  全新项目从零接入（装包→后端→前端→验证）
├── examples/
│   └── starter/           ★ 可直接复制运行的最小示例（server + web）
└── README.md
```

## 其他人如何复用本仓库？

> 一句话：**clone 仓库 → 复制 starter → 改 `file:` 路径与自己的配置 → 跑起来**。
> 当前**未发包**，走 `git clone` + 本地 `file:` 引用（零 token、改源码即时生效）。

- **团队复用指南**：[docs/团队复用指南.md](docs/团队复用指南.md) —— ★ 先看这篇：发包区别、拉取后 6 步复用、更新与常见问题
- **完整接入指南**：[docs/新项目接入指南.md](docs/新项目接入指南.md) —— 逐步骤讲解 + 可直接复制的代码
- **可运行骨架**：[examples/starter/](examples/starter/) —— 复制后改配置即可跑（含建表 SQL、登录接口、四个页面）
- **已有项目改造**：[docs/迁移指南.md](docs/迁移指南.md)

单个新项目接入预计 **2～3.5 小时**（不含业务功能开发）。

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
npm test                       # 12/12 通过
# 前端工具由消费项目的 Vite 编译，无需单独构建
```

## 发包（GitHub Packages）— 当前未发包

**当前状态：未发包。** 团队通过 `git clone` + `file:` 本地引用复用，见 [docs/团队复用指南.md](docs/团队复用指南.md)。下面步骤仅在未来需要跨团队分发时执行。

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
