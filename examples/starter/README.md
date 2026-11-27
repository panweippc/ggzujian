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
│   ├── db-extend-enterprise.sql # 企业级补全表（审计归档/幂等键/回执/分片/数据权限规则）
│   ├── db-extend-platform.sql   # 平台化扩展表（工作流/表单/报表/租户/合规/集成/AI巡检）
│   ├── db-all.sql             # 一次性导入合集（由 npm run sql:bundle 自动生成，勿手改）
│   ├── scripts/sql-files.mjs  # SQL 清单与依赖顺序（迁移/合集共用的唯一数据源）
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

两种方式**二选一**：全新安装推荐方式 A（零配置）；需要升级/重复执行管控用方式 B（版本化迁移）。

#### 方式 A：直接导入合集 SQL（推荐，零前置配置）

不需要 `.env`，只要能连上 MySQL。命令**必须带** `--default-character-set=utf8mb4`：Windows 下 mysql 客户端默认按 GBK 解读 UTF-8 文件，不加中文会全部变乱码。

```bash
# 1) 建库（库名自行替换）
mysql -u root -p --default-character-set=utf8mb4 -e "CREATE DATABASE IF NOT EXISTS my_project DEFAULT CHARSET utf8mb4;"

# 2) 一次性导入合集（已包含全部 5 个 SQL，按依赖顺序拼好）
mysql -u root -p --default-character-set=utf8mb4 my_project < server/db-all.sql
```

> `db-all.sql` 由 `npm run sql:bundle` 按 `scripts/sql-files.mjs` 的顺序自动生成，**请勿手改**；改了任一源 SQL 后重新生成即可。全部源脚本都是 `CREATE TABLE IF NOT EXISTS` + `INSERT IGNORE`，合集可重复执行，不会覆盖已有数据。
>
> 只想装某个模块（比如跳过演示数据）时，可按 [`scripts/sql-files.mjs`](server/scripts/sql-files.mjs) 的顺序单独导入对应的 `db-extend-*.sql`。
>
> 如果之前导入过但中文乱码：先在 MySQL 里清空演示表（`DELETE FROM dict_items; DELETE FROM app_configs; DELETE FROM scheduled_tasks; DELETE FROM notifications;`），再重跑上面第 2 步。

#### 方式 B：版本化迁移脚本（需先配 .env）

适合后续升级：脚本把每个 SQL 的 checksum 记到 `schema_migrations` 表，已迁移过的自动跳过；只有 SQL 内容变了才重跑。

```bash
cp server/.env.example server/.env
# 编辑 server/.env：至少填 DB_NAME；DB_USER 默认 root，DB_PASSWORD 按本机 MySQL 填写
cd server && npm i
node scripts/migrate.mjs    # 按依赖顺序迁移全部 5 个 SQL；缺 DB_NAME 会直接报错并给出上面的指引
```

> **两种方式建的表完全一样，不要重复执行**。已经用 A 导过库、又想纳入版本管理的，执行一次 B 即可（幂等，只是往 `schema_migrations` 记一笔）。
>
> `db-all.sql` 只是一次性导入入口，**不参与版本化迁移**：`migrate.mjs` 永远读 5 个分文件，不会记录合集的 checksum。

生成管理员密码哈希并插入用户（两种方式都需要）：

```bash
cd server && npm i
node -e "import('@panweippc/auth-kit').then(m=>console.log(m.hashPassword('Admin@2026pass')))"
# 把输出的哈希填入下面的 SQL 并在 MySQL 执行
# INSERT INTO users(username,password,role) VALUES('admin','<上一步的哈希>','admin');
```

### ② 启动后端

```bash
cd server && npm i && npm run dev   # 默认监听 3011，被占用会自动顺延到 3012、3013…
curl http://localhost:3011/api/health   # 应返回 {"status":"ok","db":"up"}
```

> 后端已把 `dotenv`/`bcryptjs`/`jsonwebtoken` 声明为自己的直接依赖，`cd server && npm i` 一步即可装齐，**不依赖仓库根的 workspaces**。端口从 `.env` 的 `PORT`（默认 3011）起探测，占用则自动 +1（最多 20 个），实际端口写入 `server/.runtime-port.json`，并在控制台打印。

### ③ 启动前端

```bash
cd web && npm i && npm run dev   # 默认监听 3008，被占用会自动顺延
```

> 前端启动时会读取 `server/.runtime-port.json` 拿到后端实际端口；`/api` 代理在**每次请求时动态读取**该文件，所以后端换了端口前端无需重启。两个端口都可分别用 `PORT`（后端）和 `VITE_PORT`（前端）环境变量覆盖。

浏览器打开前端控制台打印的地址（默认 `http://localhost:3008`），用 `admin / Admin@2026pass` 登录。首次登录会进入**新手引导页**（`/onboarding`），看完后进入工作台。全部功能开箱即用：

- **核心底座**：登录/验证码/限流/锁定、JWT 鉴权、个人中心、修改密码、退出登录
- **系统管理**：用户/角色/数据备份（真实后端），菜单/权限（占位）
- **消息中心**：顶栏铃铛（未读角标 + 浏览器通知 + 标题闪烁）+ 独立消息页（`/messages`）
- **操作日志**：可展开变更 diff + 审计导出（带脱敏策略）
- **公共组件演示**（`/components`）：通用 CRUD 表格、数据字典选择器、富文本、图片裁剪、Excel 导入导出
- **体验**：三套主题（紫蓝/亮色/暗色）、布局设置抽屉、多标签页导航、返回顶部、AI 助手悬浮球
- **安全**（`/security`）：TOTP 二次验证、会话管理（踢下线）、IP 白名单、脱敏策略
- **运维**：系统监控（`/monitor`）、配置中心（`/config`）、定时任务（`/tasks`）、接口文档（`/api-docs`）
- **基础数据与标准**（`/base-data`）：组织机构/行政区划/行业分类树形维护、字典分类与缓存/批量接口、代码化数据标准体检（`node scripts/check-standards.mjs`）
- **统一接入**：文件服务（`/files`，前端可热切换驱动、配置入库即时生效）、消息通道（`/message-channels`）、数据访问适配层（`DB_DRIVER`，预留国产库/NoSQL/时序）
- **全留痕**：网关自动审计所有写操作（含未埋点接口）+ 手动审计自动去重；日志哈希链防篡改（`/api/audit/verify-chain`）、归档（`/api/audit/archive`）、增强查询（`/api/audit/logs/enhanced`）、危险操作 webhook 告警
- **回收站**：顶栏 ♻，删除的文件/记录进回收站，保留 30 天（可配 `RECYCLE_KEEP_DAYS`）自动清除，支持恢复/彻底清除；后端 `/api/recycle-bin*`
- **网关运维与可观测**：`/metrics`（Prometheus 文本指标：网关请求/慢请求/接口耗时错误 + Node.js 内存/CPU/事件循环 + 系统负载 + 实例信息）、Grafana 面板（docker-compose 一键起，自动加载）、`/api/api-docs.json`（自动生成接口清单）、维护模式开关、写接口幂等键（`Idempotency-Key` 请求头）、版本响应头
- **工程化**：`npm test`（Vitest，73 用例：登录/鉴权/权限三条关键路径 + Excel/签章/SSE/预览/Cron 底座）、`node scripts/migrate.mjs`（版本化迁移）、`npm run sql:bundle`（生成一次性导入合集）、Dockerfile + docker-compose 一键起、组件与接口文档（`/component-docs`）、配置推送（dev→prod）
- **平台化**（`/workflow`、`/platform`、`/ai-ops`、`/low-code`）：工作流引擎（流程定义/发起/待办/审批）、表单设计器、报表 BI、多租户与套餐、数据分级与字段加密、委托授权、事件订阅 Webhook、ETL 管线、开放平台 API 密钥；稳定性（熔断/缓存/特性开关）、可观测（trace/结构化日志/UEBA）、AI 助手（聊天/RAG/NL2SQL/智能巡检）、低代码搭建器

> 平台化能力**默认全部走本地实现、零外部依赖**：缓存=内存 LRU、事件总线=内存、加密=AES-256-GCM、AI=内置演示、trace=内存环形缓冲。在 `.env` 填 `REDIS_URL`/`MQ_URL`/`KMS_URL`/`LLM_API_URL`/`OTLP_ENDPOINT`/`VECTOR_DB_URL` 后切换到对应真实适配器（适配器骨架在 `server/services/platform.js`，未接入真实驱动时明确提示，不静默降级）。
>
> **外部资源配置位已全部预声明**（见 `server/.env.example`），分三类：① 开箱即用（缓存/事件/加密/LLM/trace/文件 local/数据库）；② 有配置位但适配器为占位（`REDIS_URL`/`MQ_URL`/`KMS_URL`/`OTLP_ENDPOINT`/`VECTOR_DB_URL`，填入后会明确提示未接入真实驱动）；③ 仅预留配置位、尚未接入驱动（`ELK_URL`/`KIBANA_URL`/`JAEGER_URL`/`SENTRY_DSN` 与对象存储 `MINIO_*`/`OSS_*`）。第②③类需要对应外部服务与 SDK 适配器才能生效，配置位本身不会静默降级或报错。

### 监控栈（Prometheus + Grafana，可选）

后端 `/metrics` 已内置 Prometheus 文本指标，无需外部依赖即可用 curl 查看。要配可视化面板，用 docker-compose 一键起 Prometheus + Grafana：

```bash
# 首次准备密钥（必填，无弱默认值）
cp .env.docker.example .env   # 填写 DB_PASSWORD / JWT_SECRET / SIGN_SECRET / GRAFANA_ADMIN_PASSWORD

# 本地开发（暴露 3306/9090/3000 便于调试）
docker compose up -d
# Prometheus: http://localhost:9090   （已配好抓 app:3011/metrics）
# Grafana:    http://localhost:3000   （账号见 .env 的 GRAFANA_ADMIN_*）

# 生产（安全基线：数据库/监控端口均不映射公网，仅 app:3011 供反代）
docker compose -f docker-compose.base.yml -f docker-compose.prod.yml up -d
```

登录 Grafana 后「Dashboards」里已有 Starter 服务监控总览，无需手动导入。镜像以非 root 用户运行，app 带 `/api/health` 健康检查。

配置文件都在 `monitoring/`：`prometheus.yml`（抓取目标）、`grafana/provisioning/`（数据源 + 面板自动加载）、`grafana/dashboards/starter-dashboard.json`（10 个面板：请求量/慢请求/接口耗时/错误率/内存/CPU/负载/事件循环延迟等）。若已有自建 Prometheus，直接把抓取目标指向你的后端 `/metrics` 即可，面板 JSON 可单独导入。

### 开发效率底座（7 项补强）

| 能力 | 入口 | 说明 |
|---|---|---|
| 测试体系 | `cd server && npm test` | Vitest 73 用例：登录（验证码/密码/锁定/密钥轮换）、鉴权（白名单/伪造 token/改密/换设备）、权限（角色拒绝）+ 各底座单测 |
| CRUD 生成器 | `node scripts/generate-crud.mjs --sql server/db.sql --table products`（或 `--config scripts/entities/product.json`） | 从表结构/实体定义生成后端 CRUD 路由 + 前端 CrudPanel 页面 + SQL；加 `--register` 一键接线（自动挂路由/菜单/导览/Excel schema，幂等可重复执行） |
| Excel 导入导出 | `/api/excel/{template,check,import,export}/:key` | schema 注册式：模板下载、字段校验（必填/类型/枚举/范围/正则）、错误行回显、事务导入全回滚；新增实体只需在 `routes/excel.js` 的 `SCHEMAS` 加一项 |
| 电子签章 | `/api/signatures/*`、`/api/seals` | SHA-256 文档摘要 + HMAC-SHA256 签名 + 常量时间验签 + 撤销；`db-extend-signature.sql` 迁移；CA 级签名需接 KMS（预留 `KMS_URL`） |
| SSE 实时推送 | `GET /api/sse/notifications?token=...` | 消息中心 EventSource 替换轮询：发送站内信即推，断线回退低频轮询并自动重连；`/api/sse/stats` 看连接数；心跳 25s |
| 文件在线预览 | `/api/files/:key/preview-policy`、`/preview` | 图片/PDF/TXT/MD/CSV/JSON 内联；Office 需配 `CONVERT_URL`（LibreOffice/OnlyOffice），未配置时接口明确 501 提示下载，不静默失败 |
| 任务可视化配置 | `/tasks` 页 + `CronEditor.vue` + `POST /api/cron/preview` | 快捷预设 + 分段选择 + 人类可读描述 + 下次执行时间预览；任务列表「执行日志」回溯 `task_execution_history` |

> 测试命令在 `server/` 目录执行（`npm test` / `npm run test:watch` / `npm run test:coverage`）。

### 工程化与安全加固

- **CI/CD**（方案 C）：`.github/actions/starter-check`（公共门禁）+ `.github/workflows/ci.yml`（PR/push 自动跑测试+构建+镜像）；Jenkins 用仓库内 `ci/pipeline.groovy` 公共模板 + 根目录薄 `Jenkinsfile`，新项目接入见 `ci/README.md`。
- **Docker**（方案 A）：`docker-compose.base.yml`（安全基线，密钥必填、管理端口不暴露）+ `docker-compose.prod.yml`（生产覆盖：资源限制/日志滚动/no-new-privileges）+ 默认 `docker-compose.yml`（本地开发）。Dockerfile 非 root 运行。
- **安全**：8 处重复的 `adminOnly` 统一到 `server/middleware/role.js`；签章密钥独立 `SIGN_SECRET`；helmet 安全响应头（CSP 关闭，由前端管控）。依赖漏洞修复见 `server/SECURITY.md`。

### 自动化工具箱（一致性 / 编排 / 门禁）

所有命令在对应目录执行（`scripts/` 下除标注外均在 `server/`）。npm script 入口见 `server/package.json`。

**门禁类（已接入 GitHub Actions + Jenkins，提交即跑）**

| 命令 | 作用 |
|---|---|
| `node scripts/check-consistency.mjs`（starter 根目录） | 菜单/路由/导览/i18n 四方一致性 + 悬挂路由扫描；防「新增菜单漏导览」「字典漏 key 白屏」复发 |
| `cd server && node scripts/check-env.mjs` | 扫 `process.env.X` 对照 `.env.example`，检出未声明项与内置变量误报 |
| `cd server && node scripts/check-compat.mjs --driver postgres` | 业务 SQL 方言兼容扫描（见下节） |
| `cd server && node scripts/check-audit.mjs --level critical --omit dev --allow-list xlsx` | npm audit 阈值门禁，可豁免已评估漏洞 |
| `cd server && node scripts/check-secrets.mjs` | 硬编码密钥/口令/私钥扫描（高危阻断，`--strict` 连可疑项也阻断） |
| `cd server && node scripts/check-code-quality.mjs` | 冗余代码审查：重复块/超长函数/死导出/TODO/console.log（`--strict` 阻断） |
| `cd server && node scripts/check-compliance.mjs` | 等保 2.0 三级技术项自查（`--level 二级` 切基线）；**自查非测评** |
| `cd server && npm run check:all` | 一次跑齐 env + compat + audit + secrets 四道阻断门禁 |

**生成 / 编排类（按需手动执行）**

| 命令 | 作用 |
|---|---|
| `node scripts/generate-crud.mjs --config scripts/entities/product.json --register` | CRUD 一键生成 + 自动注册，幂等 |
| `cd server && node scripts/init-admin.mjs --password <pwd> --dry-run` | 管理员初始化：bcrypt 哈希后幂等 upsert，去掉 `--dry-run` 实际写入；`--force-reset` 强制重置 |
| `cd server && node scripts/backup-orchestrator.mjs --dry-run` | 备份全链路编排：dump → manifest 校验 → 加密 → 异地复制 → 过期清理，可挂 cron |
| `cd server && node scripts/rotate-secrets.mjs --key data` | 密钥统一轮换协调器：字段密文轮换 + JWT/SIGN 轮换指引，`--key` 选 jwt/sign/data/backup |
| `cd server && node scripts/generate-openapi.mjs` | 从路由源码生成 OpenAPI 3.0 规范（`--check` 校验幂等） |
| `cd server && node scripts/check-schema-drift.mjs --dry-run` | 比对库实际结构与 `db-all.sql` 声明，出 diff（`--dry-run` 只解析 SQL 不连库） |
| `cd server && node scripts/generate-demo-data.mjs --table employees --rows 20` | 零依赖演示数据生成（种子可复现，自动跳过 users/审计/敏感表）；`--list` 看可生成表 |

> CRUD 生成器 `--register` 与一致性门禁闭环：生成时自动同步 `SIDE_MENUS` / `LOGIN_MODULES` / `router.ts` / Excel `SCHEMAS`，再由门禁校验无漂移。

> ⚠️ **等保自查边界**：`check-compliance.mjs` 只做技术项**预检自查**，输出 ✓（自动核验通过）/ ✗（缺失）/ ⚠（需人工确认）；管理制度、物理安全、定级备案等不在代码层检测范围，**不构成等保测评结论**，正式测评须由有资质机构出具。密钥扫描与密钥的管理制度是两回事，弱口令仍需在 `.env` 层治理（见 `check-env.mjs`）。

**前端一键安全自检（管理端）**

侧边栏「安全自检」页把密钥扫描、冗余代码审查、等保技术项自查集中到一个界面：管理员可勾选执行或「一键执行全部」，并可切换等保二级/三级基线。结果与 CI 门禁使用**同一脚本、同一口径**（页面展示的是脚本的 `--json` 输出），属于按需自查入口，不替代 CI 阻断。

| 接口 | 作用 |
|---|---|
| `GET /api/security/checks` | 列出可用检测项与可选基线（仅管理员） |
| `POST /api/security/run` | 执行选中项，body：`{ "checks": ["secrets","quality","compliance"], "level": "三级" }` |

安全边界：仅管理员可调用；检测项 id 走固定白名单，脚本路径与参数不可由请求指定；`execFile` 直接启动 Node 子进程、不经过 shell，杜绝命令注入；每用户+IP 限频、全局单并发、单次超时（按检测项分级）、stderr 不回传；每次执行写操作审计。**生产环境默认关闭**，需显式设置 `SECURITY_UI_ENABLED=true` 才启用；`SECURITY_UI_TIMEOUT_MS` / `SECURITY_UI_RATE_MAX` / `SECURITY_UI_RATE_WINDOW_MS` 可调。页面结果与脚本自查一样，不构成等保测评结论。

**15 项检测清单（页面可勾选执行，CI 自动跑）**

| # | 检测项 | 默认口径 |
|---|---|---|
| 1 | 硬编码密钥扫描 | 高危阻断 |
| 2 | 冗余代码审查 | 仅告警 |
| 3 | 等保合规自查 | 缺失阻断，人工项提示 |
| 4 | API 暴露面自查 | 公开写接口阻断 |
| 5 | 配置基线漂移检测 | 实际 `.env` 弱值阻断（CI 无 `.env` 标人工） |
| 6 | SQL 危险拼接扫描 | 请求对象插值阻断，其余提示 |
| 7 | 测试覆盖率门禁 | 启发式比例告警；装 provider 后可升级真实覆盖率 |
| 8 | SBOM 与许可证合规 | GPL/AGPL/SSPL 阻断，支持 `--out` 导出 CycloneDX |
| 9 | 数据分类分级扫描 | PII 漏登记告警 |
| 10 | 权限矩阵一致性 | 管理页免 RBAC 阻断 |
| 11 | 备份可恢复性演练 | 完整性失败阻断；无备份标人工 |
| 12 | 圈复杂度门禁 | 超阈值 3 倍阻断（历史基线仅提示） |
| 13 | 未使用依赖扫描 | 静态缺依赖阻断，动态导入提示 |
| 14 | TypeScript 严格度门禁 | 缺 tsconfig / 大量 any 提示 |
| 15 | 前后端接口契约校验 | 前端调用路径无后端路由时提示 |

全部脚本零依赖、支持 `--json` / `--strict`，已接入 GitHub Actions 与 Jenkins。前端页面从后端动态读取检测项列表，**新增检测只需在 `security-check.js` 白名单登记并接一行 CI 命令，无需改页面**。`npm run check:extended` 可一次跑齐后 12 项，`npm run check:all` 已包含。

> 底座约定：新增功能优先接入自动化门禁与前端面板，能自动核验的不留人工步骤；确实需要环境/制度配合的项（如真实数据库恢复演练、等保测评）必须显式标注为"人工"，不得静默通过。

### 数据安全（方案 C）与多数据库兼容（方案 A）

**数据安全 C —— 三层闭环**

| 层 | 落地 | 用法 |
|---|---|---|
| 字段级加解密 | `services/field-crypto.js`（AES-256-GCM + 密钥轮换）、`services/sensitive-fields.js`（注册表） | employees 的手机/身份证/邮箱/地址等写库前加密、读库后解密；非全量数据范围再脱敏。存量明文：`node scripts/migrate-encrypt-fields.mjs --dry-run` 预演，确认后去掉 `--dry-run` 执行；旧密钥密文加 `--rotate` 迁移 |
| 查询出口分级 | `POST /api/data-export/request` → 管理员 `POST /api/data-export/approvals/:no/approve` → `GET /api/excel/export/:key?approvalNo=...` | 中/高风险模板必须先审批，审批单一性消费；导出 xlsx 自动附「导出信息」水印 sheet，申请/审批/导出全程审计。`EXPORT_POLICY=medium` 为默认阈值 |
| 备份完整性 | `services/backup-security.js` + `db-extend-data-security.sql` | 每次备份产出 `.manifest.json`（SHA-256/表数/行数）；`GET /api/backups/:file/verify` 依次校验落盘哈希、解密后哈希、SQL 干跑；恢复前强制校验且自动留快照，并要求二次密码 |

备份可选 AES-256-GCM 加密落盘（`BACKUP_ENCRYPT_KEY`）、异地复制（`BACKUP_REMOTE_DIR`）、过期清理（`BACKUP_RETENTION_DAYS`）。密钥缺失时明确拒绝校验/解密，不会静默按明文处理。

**多数据库 A —— PostgreSQL 协议栈 + 全国产库方言兼容**

- **一套 SQL 跑多种库**：`DB_DRIVER=postgres/kingbase/opengauss/dameng` 走 `pg` 真驱动（国产库 PG 兼容模式），业务 SQL 仍按 MySQL 风格书写，`services/pg-compat.js` 按方言自动改写：
  - `ON DUPLICATE KEY UPDATE` → `ON CONFLICT (唯一键) DO UPDATE SET …=EXCLUDED.…`（唯一键登记表在 `services/dialects.js` 的 `UPSERT_KEYS`）
  - `INSERT IGNORE` → `ON CONFLICT DO NOTHING`；`GROUP_CONCAT` → `STRING_AGG`/`LISTAGG`（按方言）；`DATABASE()`/`IFNULL()` → PG 等价写法
  - 反引号标识符、`?` 占位符、INSERT `RETURNING *` 提取 insertId、事务 BEGIN/COMMIT/ROLLBACK 全部兼容，路由零改动
  - 无法安全改写的语法（`SHOW` / `STRAIGHT_JOIN` / `REPLACE INTO` 等）明确报错；未登记唯一键的 upsert 表也明确报错并提示补登记——不静默产出错误结果
- **自动识别数据库**：`DB_DRIVER=auto`（或留空）时按连接串 scheme / 端口推断协议族，连上后用 `version()` 识别真实驱动（人大金仓/openGauss/达梦/PostgreSQL/MySQL），识别不出明确报错并打印原始版本串。`DB_STRICT_DRIVER_MATCH=true` 可在配置与识别不一致时启动失败。
- **启动自检**：连库后跑冒烟 SQL（连接 / 版本 / 函数 / upsert / 分页），每条都经兼容层转换，失败时指出「哪个方言 + 哪条 SQL」。`DB_STRICT_BOOT=true` 让生产启动失败；`DB_SKIP_COMPAT_CHECK=true` 紧急情况跳过。
- **国产库建库脚本**：`node scripts/generate-dialect-ddl.mjs` 从 MySQL 源脚本生成 `sql/dialect/{postgres,kingbase,opengauss,dameng}.sql`（自增/类型/注释/索引/表选项全部转换）。CI 用 `--check` 保证生成脚本与源脚本同步。
- **CI 静态门禁**：`node scripts/check-compat.mjs --driver postgres` 扫描业务 SQL，阻断无法兼容的语法与未登记的 upsert 表，把"上线才报错"提前到提交阶段。已接入 GitHub Actions 与 Jenkins 模板。
- 备份/恢复按驱动分发到 `services/db-backup.js`；`mongodb` / `influxdb` 仍为占位适配器（非关系型，现有 SQL 路由不适用），未接入即明确报错，不做假兼容。

> ⚠️ **真机验证边界**：当前无国产库真机环境，以上方言改写/自动识别规则已通过 mock 单测与静态门禁，但**尚未在人大金仓/openGauss/达梦实例上实跑**。首次上线前请在小库演练；若某库 `version()` 串不在识别表或某语法改写不符，按报错提示在 `db-compat-check.js`（VERSION_RULES）或 `pg-compat.js`（改写规则）补充即可，无需改业务代码。

> 扩展表脚本都带演示数据（部门/角色/员工 + 2 条通知 + 字典 + 配置项 + 3 个任务），登录后即可看到效果。创建备份、添加用户、修改密码等操作会自动推送通知。

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
