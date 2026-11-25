# starter — 新项目最小可运行示例

这是一个"从零接入公共包"的完整骨架。它演示了 auth-kit 的全部后端能力和 admin-ui 的四个页面组件。**复制整个 `starter` 目录到你的新项目，改几处配置就能跑。**

## 目录结构

```
starter/
├── server/                # 后端（Node + Express + MySQL）
│   ├── package.json       # 依赖 auth-kit（file: 引用，发包后改包名）
│   ├── .env.example       # 环境变量模板（复制为 .env 并填值）
│   ├── db.sql                # 最小表结构（用户表 + 操作日志表）
│   ├── db-extend-system.sql  # 系统管理扩展表（部门/角色/员工/菜单/权限/通知 + 演示数据）
│   ├── db-extend-common.sql  # 公共组件表（字典/配置/定时任务/会话/IP白名单/TOTP）
│   ├── routes/
│   │   ├── system.js         # 系统管理 + 通知 + 安全告警接口
│   │   └── common.js         # 公共组件接口（字典/配置/任务/监控/TOTP）
│   └── server.js             # 完整接线：JWT/验证码/审计/告警/鉴权/登录
└── web/                   # 前端（Vue3 + Vite + Element Plus）
    ├── package.json       # 依赖 admin-ui + echarts/xlsx/quill/qrcode/dompurify
    ├── vite.config.ts     # 关键：让 node_modules 里的 .vue 能被编译
    ├── index.html
    └── src/
        ├── main.ts        # 装拦截器/fetch token/空闲检测
        ├── api.ts         # 请求封装
        ├── config.ts      # ★ 项目品牌/菜单/映射配置（新项目主要改这里）
        ├── router.ts      # 路由 + 守卫
        ├── App.vue        # 全局挂载：搜索/回收站/通知/返回顶部/AI助手
        ├── stores/        # Pinia：user/notifications/tabs
        ├── composables/   # useTheme/useConfirm/useGlobalSearch/useRecycleBin
        ├── components/    # 全局公共组件（见下方清单）
        ├── utils/         # mask / excel / lunarFestival 等纯工具
        ├── assets/styles/ # variables.css + themes.css（三套主题）
        └── views/         # 15 个页面（工作台/系统/日志/安全/消息/组件/监控/配置/任务/文档...）
```

## 三步跑起来

### ① 准备数据库

```bash
# ⚠️ 关键：必须带 --default-character-set=utf8mb4
# 否则 Windows 下 mysql 客户端按系统 GBK 解读 UTF-8 文件，中文全部变乱码
# 1) 先建库
mysql -u root -p --default-character-set=utf8mb4 -e "CREATE DATABASE IF NOT EXISTS my_project DEFAULT CHARSET utf8mb4;"
# 2) 最小表（用户 + 操作日志）
mysql -u root -p --default-character-set=utf8mb4 my_project < server/db.sql
# 3) 系统管理扩展表（部门/角色/员工/菜单/权限/通知中心 + 演示数据，可重复执行）
mysql -u root -p --default-character-set=utf8mb4 my_project < server/db-extend-system.sql
# 4) 公共组件表（数据字典/配置中心/定时任务/会话/IP白名单/TOTP，可重复执行）
mysql -u root -p --default-character-set=utf8mb4 my_project < server/db-extend-common.sql
# 5) 编辑 server/.env（从 .env.example 复制），填数据库密码和 JWT_SECRET
cp server/.env.example server/.env
```

> 如果之前已经导入过且中文是乱码，重跑上面第 3、4 条命令即可：脚本全部用了 `INSERT IGNORE`，不会覆盖已有行。正确做法是先在 MySQL 里 `DELETE FROM dict_items; DELETE FROM app_configs; DELETE FROM scheduled_tasks; DELETE FROM notifications;` 清空演示表，再重新导入。

生成管理员密码哈希并插入用户：

```bash
cd server && npm i
node -e "import('@panweippc/auth-kit').then(m=>console.log(m.hashPassword('Admin@2026pass')))"
# 把输出的哈希填入下面的 SQL 并在 MySQL 执行
# INSERT INTO users(username,password,role) VALUES('admin','<上一步的哈希>','admin');
```

### ② 启动后端

```bash
cd server && npm run dev     # 监听 3011
curl http://localhost:3011/api/health   # 应返回 {"status":"ok","db":"up"}
```

### ③ 启动前端

```bash
cd web && npm i && npm run dev   # 监听 3008，/api 代理到 3011
```

浏览器打开 `http://localhost:3008`，用 `admin / Admin@2026pass` 登录。首次登录会进入**新手引导页**（`/onboarding`），看完后进入工作台。全部功能开箱即用：

- **核心底座**：登录/验证码/限流/锁定、JWT 鉴权、个人中心、修改密码、退出登录
- **系统管理**：用户/角色/数据备份（真实后端），菜单/权限（占位）
- **消息中心**：顶栏铃铛（未读角标 + 浏览器通知 + 标题闪烁）+ 独立消息页（`/messages`）
- **操作日志**：可展开变更 diff + 审计导出（带脱敏策略）
- **公共组件演示**（`/components`）：通用 CRUD 表格、数据字典选择器、富文本、图片裁剪、Excel 导入导出
- **体验**：三套主题（紫蓝/亮色/暗色）、布局设置抽屉、多标签页导航、返回顶部、AI 助手悬浮球
- **安全**（`/security`）：TOTP 二次验证、会话管理（踢下线）、IP 白名单、脱敏策略
- **运维**：系统监控（`/monitor`）、配置中心（`/config`）、定时任务（`/tasks`）、接口文档（`/api-docs`）

> 两个扩展表脚本都带演示数据（部门/角色/员工 + 2 条通知 + 字典 + 配置项 + 3 个任务），登录后即可看到效果。创建备份、添加用户、修改密码等操作会自动推送通知。

> **TOTP 说明**：骨架提供完整的绑定/启用/关闭接口与 UI，但**默认不在登录流程强制校验**（避免锁死演示账号）。真实项目在 `server.js` 登录逻辑里按 `/api/totp/status` 的 `enabled` 决定是否要求输入动态码。

## 新项目要改哪里

| 想改的东西 | 改哪个文件 |
|---|---|
| 项目名/Logo/主色 | `web/src/config.ts` |
| 后端接口地址 | `web/src/api.ts`、`server/server.js` 业务路由 |
| 用户表结构 | `server/db.sql` + `server/server.js` 里的 SQL 和 `findUserByUsername` |
| 页面字段/列 | `web/src/views/HomeView.vue` 里的 `userConfig` / `logConfig` |
| 品牌增强（天气/公告等） | `LoginView.vue` 的 `#extra` 插槽 |
| 通知类型（图标/颜色/文案） | `web/src/config.ts` 的 `NOTIFICATION_TYPES` + 后端 `system.js` 的 `pushNotification()` |
| 全局公共组件 | `web/src/components/`（搜索/回收站/通知铃铛），在 `App.vue` / `MainLayout.vue` 挂载 |
| JWT 密钥/数据库密码 | `server/.env`（绝不入库） |

### 安全能力（全栈自带）

| 能力 | 位置 | 说明 |
|---|---|---|
| 全局确认弹窗 | `composables/useConfirm.ts` | `confirmDanger()` 收集当前密码，配合后端 `verifyAdminPassword` 做高危操作二次验证；`confirmAction()` 普通确认 |
| 密码强度组件 | `components/PasswordStrength.vue` | 实时强度条 + 规则清单（可校验不含用户名），`ChangePasswordView` / 安全设置页复用 |
| 安全设置页 | `views/SecuritySettingsView.vue` | 安全状态总览 + 改密/个人中心/安全监控入口 + 密码强度自测，路由 `/security` |
| 登录失败锁定 | `server.js` | 连续失败 `LOGIN_MAX_FAILS`(5) 次锁定 `LOGIN_LOCK_MS`(15min)，返回 423 + retryAfterMin；失败次数前端提示剩余额度；内存计数，生产换 Redis |
| 敏感信息脱敏 | `utils/mask.ts` | maskPhone/maskIdCard/maskEmail/maskName/maskBankCard/maskIp 纯函数 |
| 安全事件监控 | `views/SecurityAlertView.vue` + `GET /api/security-alerts` | 读 auth-kit 写的 `logs/security-alert.log`，按级别/类型筛选 + 统计，管理员可见 |

### RBAC 权限执行层（已落地，配了就生效）

| 能力 | 位置 | 说明 |
|---|---|---|
| 权限上下文接口 | `GET /api/me/permissions` | 返回当前用户 `isAdmin/menus/buttons/dataScope/department`，admin 全放行；非 admin 走 `employees.roleId → roles → 权限表` |
| 菜单权限 | `stores/user.ts` `canVisit()` + `router.ts` 守卫 + `DynamicSidebar` | 路由守卫按角色菜单权限过滤，侧边栏同步隐藏；`/profile` 等个人路由不受限，避免锁死 |
| 按钮权限 | `v-perm` 指令（`main.ts` 注册） | `<el-button v-perm="'system:menu:create'">`，无权限元素直接移除；按钮清单在 `PermissionManagementTab.vue` 的 `BUTTON_DEFS` |
| 接口级权限 | `routes/system.js` `requirePerm(key)` | 后端中间件工厂，admin 放行、非 admin 校验按钮权限；管理类接口本身有 `adminOnly` 兜底 |
| 菜单/权限管理 UI | `components/MenuManagementTab.vue` / `PermissionManagementTab.vue` | 菜单 CRUD + 角色勾选菜单权限 + 按钮权限（高危带二次密码），系统管理页两个 tab 已接入 |

> 权限数据来源：`roles` / `role_permissions` / `role_button_permissions` / `menus` 四张表，演示数据（10 个菜单 + 普通员工/部门经理的菜单权限）在 `db-extend-system.sql`。**表里的配置会真正影响可见页面和按钮**，不再只是摆设。

### 数据权限（行级 + 列级）

- **行级**：`roles.dataScope` = `all`（全部）/ `dept`（本部门）/ `self`（仅本人）。`GET /api/employees` 按当前用户角色的范围自动注入 `WHERE` 条件，非 admin 只能看到范围内数据。
- **列级**：非 `all` 范围时，手机号/身份证/邮箱/紧急联系人/地址自动脱敏（后端 `maskEmployeeRow`，策略与前端 `utils/mask.ts` 一致）。
- **改角色数据范围**：在角色管理编辑弹窗里切换，保存后会提升该角色下所有用户的 `token_version` 强制重新登录，确保权限立即刷新。

### 配置中心（多环境 + 版本回滚）

- **多环境**：配置带 `env`（dev/test/prod），接口 `?env=xxx` 过滤，页面顶栏切换；同一 configKey 在不同环境值互相隔离（联合唯一键 `configKey+env`）。
- **版本历史**：每次增删改自动写 `config_history` 快照，`version` 递增；`GET /api/configs/:key/history?env=xxx` 查历史。
- **一键回滚**：`POST /api/configs/:key/rollback`（body `{version, env}`）把配置恢复到指定版本，并生成新版本记录；页面「历史/回滚」弹窗可直接操作。
- **读时生效**：后端业务（如 IP 白名单开关）每次请求实时读表，改配置无需重启。

### 消息通知中心（全栈自带，可直接用）

- **后端**：`notifications`（通知）+ `notifications_reads`（广播按人已读）两张表在 `db-extend-system.sql`；接口 `GET /notifications`、`GET /notifications/unread-count`、`POST /notifications/:id/read`、`POST /notifications/read-all` 在 `routes/system.js`，受登录保护。
- **前端**：`composables/useNotification.ts`（单例状态 + 60s 未读轮询）+ `components/NotificationCenter.vue`（顶栏铃铛角标 + 下拉列表），挂在 `MainLayout` 顶栏。
- **产生通知**：后端调 `pushNotification(pool, { recipient, type, title, content, link })`。`recipient='*'` 为全员广播，否则指定用户名。骨架已在「创建用户/创建备份/恢复数据库/改密」处接入，照抄一行即可扩展。
- **广播已读隔离**：广播通知的已读写进 `notifications_reads`（按 username），一人已读不影响他人；定向通知直接更新 `isRead`。

## 公共组件清单（本次全量落地）

### 复用性 / 基础建设
| 组件 | 文件 | 说明 |
|---|---|---|
| 统一页头 | `components/PageHeaderBar.vue` | 品牌+首页+当前页+操作+回收站+返回，照搬 qy 成品，品牌走 config |
| 通用 CRUD 表格 | admin-ui `CrudPanel`（`/components` 演示） | 配置列+表单字段生成完整增删改查，已在数据字典页用起来 |
| 数据字典选择器 | `components/DictSelect.vue` | 传 category 自动加载字典项，支持 v-model / 数字值 |
| 富文本编辑器 | `components/RichTextEditor.vue` | Quill + DOMPurify 净化，防 XSS |
| 图片裁剪上传 | `components/ImageCropper.vue` | 原生 canvas 居中裁剪，零额外依赖，上传走 JWT |
| Excel 导入导出 | `utils/excel.ts` | 基于 xlsx：导出/模板/导入，支持表头映射 |

### 体验类
| 组件 | 文件 | 说明 |
|---|---|---|
| 主题切换 | `composables/useTheme.ts` + `themes.css` | 紫蓝/亮色/暗色三套，localStorage 持久化 |
| 布局设置抽屉 | `components/SettingsDrawer.vue` | 主题/多标签/紧凑模式/侧边栏折叠 |
| 多标签页导航 | `stores/tabs.ts` + `components/TabBar.vue` | 打开/关闭/关闭其他/右键菜单 + KeepAlive 缓存 |
| 返回顶部 | `components/BackToTop.vue` | 监听 `.content` 滚动，平滑回顶 |
| 骨架屏 | `components/PageSkeleton.vue` | 通用列表骨架，各页面可复用 |
| 引导页 | `views/OnboardingView.vue` | 首次登录 4 步特性引导，localStorage 记住 |
| AI 助手悬浮球 | `components/AiAssistant.vue` | 零后端依赖演示版；把 `askAI()` 换成 `/api/ai/chat` 即接真实 AI |

### 安全补强
| 组件 | 文件 | 说明 |
|---|---|---|
| TOTP 二次验证 | `components/TotpSetup.vue` + `common.js` | 纯 Node crypto 实现 RFC6238，二维码用 qrcode，无需 otplib |
| 会话管理 | `components/SecurityAdmin.vue` | 在线会话列表 + 踢下线（提 token_version 使旧 token 全失效） |
| IP 白名单 | `components/SecurityAdmin.vue` + `server.js` `/api/ip-check` | 支持 IP/CIDR，配置开关控制是否启用 |
| 审计导出 + 脱敏策略 | `utils/mask.ts` + `OperationLogView.vue` | 导出日志时按策略脱敏 IP/用户名 + 水印 |

### 运维类
| 组件 | 文件 | 说明 |
|---|---|---|
| 系统监控 | `views/MonitorView.vue` | CPU/内存/磁盘 echarts 图表 + 服务状态 + 15s 自动刷新 |
| 配置中心 | `views/ConfigView.vue` | key-value 配置增删改，改后立即影响后端逻辑 |
| 定时任务 | `views/TaskView.vue` | 任务注册表 + 启停开关（真实调度由 pm2 cron 兜底） |
| 接口文档 | `views/ApiDocsView.vue` | 零依赖接口清单，按模块分组 + 搜索 |
| 文件服务 | `views/FileServiceView.vue` | 统一上传/下载/预览/列表/删除，本地存储 + 对象存储适配位 |
| 消息通道 | `views/MessageChannelView.vue` | 站内信/邮件/短信/微信统一发送入口，未配外部资源走控制台适配器 |

### 底座能力：网关 / 全链路日志 / 文件与消息

**统一网关**（`server/middleware/gateway.js`，全局生效）
- CORS + JWT 前置鉴权 + 天气接口服务端转发
- 全局限流（默认 300 次/分）+ 写操作分级限流（60 次/分）+ 登录独立限流（15 分钟 10 次，第 11 次起 429）；`/health` 等探针接口白名单放行
- 可通过 `.env` 调：`RATE_MAX` / `RATE_WINDOW_MS` / `WRITE_RATE_MAX` / `LOGIN_RATE_MAX`

**全链路 Trace ID**
- 每个请求自动分配 `X-Request-Id`（支持上游透传），响应头回传；前端响应拦截器自动捕获
- 操作日志表新增 `traceId` / `requestBody` / `responseResult` / `durationMs` 四列（敏感字段自动打码）
- 操作日志页可按 Trace ID 检索，展开可见请求参数、响应结果、耗时；慢接口（>800ms，`SLOW_REQUEST_MS` 可调）自动写安全告警

**统一文件服务**（`server/routes/files.js`）
- 接口：`POST /files/upload`、`GET /files`、`GET /files/:key/preview`、`GET /files/:key/download`、`DELETE /files/:key`
- 扩展名白名单 + 20MB 大小限制（`FILE_MAX_SIZE` 可调）；元数据入 `file_objects` 表
- 底层存储由 `STORAGE_DRIVER` 决定（默认 `local`），预留 `minio`/`oss` 适配位——切换驱动不改任何业务接口

**统一消息通道**（`server/services/message-channels.js` + `server/routes/messages.js`）
- 一个 `sendMessage({ channel, to, title, content })` 覆盖 站内信/邮件/短信/微信
- 站内信已实现（写 notifications 表）；其余三通道：填了对应 `.env` 走真实服务，没填走**控制台适配器**（消息写入 `logs/message-center.log`，不丢）
- 启用真实通道只需在 `.env` 配：`SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS`、`SMS_API_URL/SMS_API_KEY/SMS_SIGN`、`WECHAT_WEBHOOK`，无需改代码
- 消息通道页可查看各通道就绪状态、发送测试消息、查发送日志

> 更详细的逐步骤讲解、原理和常见坑，见 [../../docs/新项目接入指南.md](../../docs/新项目接入指南.md)。
