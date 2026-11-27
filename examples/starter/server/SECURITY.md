# 安全加固与依赖漏洞处置说明

## 一、已落地的安全加固（本轮）

| 项 | 处理 | 影响 |
|---|---|---|
| 角色鉴权口径不一 | 8 个路由文件各自内联 `adminOnly`（`system.js` 文案还不同），统一到 `middleware/role.js` | 判定口径一致；`system.js` 拒绝文案并入统一文案 |
| 签章密钥复用 | `services/signature.js` 原用 `JWT_SECRET` 兼作签章密钥；改为优先独立 `SIGN_SECRET`，未配置时兼容回退并在生产告警 | 新增 `.env` 配置位 `SIGN_SECRET` |
| 安全响应头 | 无 helmet → `server.js` 接入 `helmet({ contentSecurityPolicy: false })` | 启用 X-Content-Type-Options / X-Frame-Options / HSTS / Referrer-Policy；CSP 由前端/反代层管控 |
| 镜像安全 | 单阶段 root 运行 → 非 root 用户 + 运行时目录授权 | 需确保挂载卷对 appuser 可写 |

## 二、npm audit 漏洞处置

> 说明：`npm audit` 在 2026-11-26 的基线为 **7 个漏洞**（3 moderate / 2 high / 2 critical）；本轮安装 `pg` 驱动后重新解析依赖树，实测为 **6 个**（1 moderate / 5 high），vitest 链上的 critical RCE 已消除。此前口述的"6 个"以本节实测为准。

### 1. Vitest / 构建链（moderate × 3 + critical × 2）

- 根因：`vitest@2.x` 依赖的 `@vitest/mocker`、`tinypool`、`vite`、`esbuild` 存在路径穿越 / 原型污染 RCE / 开发服务器越权读取。
- 处置：**已升级** `vitest@5.1.2` + `vite@6.4.6`（`tinypool` 的 critical RCE 仅在该版本修复）。
  - 因 peer 冲突（vitest 5 要求 vite 6+）用 `--legacy-peer-deps` 安装，并显式补装 `vite@6.4.6`。
  - Vitest 5 新增 API token 机制，本机因沙箱不可写 AppData，需预建工作区 `node_modules/.vitest/.vitest-secret-token`（gitignore，不入库）；CI/常规环境可自动创建，无此问题。
  - 升级后 `npm test` 全量回归 **73/73 通过**。
- 影响面：仅 devDependencies，不影响生产运行时。

### 2. xlsx / SheetJS（high × 2）

- 根因：`xlsx@0.18.5`（npm registry 上的最后一个版本）有原型污染 + ReDoS，**npm registry 无修复版**。
- 处置决策：**保留现状 + 明确风险提示，不擅自切换依赖源**。原因：
  1. 修复版（0.20.3）只从 SheetJS 官方 CDN（`https://cdn.sheetjs.com`）分发，切换后 `package.json` 依赖变成 URL，破坏可复现性与离线安装；
  2. Excel 底座刚落地 6 个用例，切换来源前需完整回归导入/导出/错误回显，属于独立子项；
  3. 本项目 Excel 服务只在服务端解析上传文件，输入源可控时可加一层文件大小/单元格数上限缓解。
- 建议（需单独拍板后执行）：
  - 方案 A：切 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 并全量回归（网络可达已验证 HTTP 200）；
  - 方案 B：迁移到 `exceljs`（npm registry 可装、无同类漏洞），需改写 `services/excel.js` 的解析/生成 API，成本较高。
- 临时缓解：`routes/excel.js` 的上传入口已限制文件大小（`FILE_MAX_SIZE`）；生产建议限制仅登录用户可导入。

## 三、数据安全方案 C / 多数据库方案 A 的决策记录

| 项 | 决策 | 安全边界 |
|---|---|---|
| 字段加密 | AES-256-GCM + scrypt 派生；密文携带 salt/iv/tag，篡改后 GCM 认证失败 | 缺密钥时工厂抛错、路由层明确告警后走明文（不假装已加密）；密码哈希不写入密文也不下发 |
| 导出管控 | 敏感字段注册表自动判定风险；审批单一次性消费 + 水印 sheet + 申请/审批/导出全量审计 | low 风险免审批但仍留单；审批单 30 分钟过期；单次导出行数硬上限 |
| 备份完整性 | 每次备份产出 manifest（SHA-256/表数/行数）；可选加密落盘、异地复制、过期清理 | 恢复前强制校验并自动留快照；旧备份无 manifest 时需 `BACKUP_REQUIRE_VERIFY=false` 显式放开 |
| 多数据库 | `postgres` 走 pg 真驱动；kingbase/openGauss/达梦复用 PG 协议栈 | MySQL 专有语法明确拒绝，不静默产出错误结果；mongodb/influxdb 仍是占位 |

本轮新增 44 个用例（字段加密 13 / 导出管控 9 / 备份安全 9 / PG 适配器 13），全量 **117/117 通过**。

## 四、验证命令

```bash
cd server
npm audit --omit=dev     # 生产依赖漏洞
npm test                 # 全量回归（117 用例）
node scripts/migrate-encrypt-fields.mjs --dry-run   # 存量明文加密预演（不写库）
```
