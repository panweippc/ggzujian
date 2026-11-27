# CI/CD 公共配置（方案 C：公共模板 + 各项目薄配置）

仓库内提供两条流水线，**共用同一套门禁逻辑**（后端测试 → 前端构建 → 镜像构建 → 可选推送/部署）：

| 平台 | 公共实现 | 项目薄配置 |
|---|---|---|
| GitHub Actions | `.github/actions/starter-check/action.yml`（composite action） | `.github/workflows/ci.yml` 的 `matrix.project` |
| Jenkins | `ci/pipeline.groovy`（Scripted Pipeline 模板，仓库内 `load`，无需 Shared Library） | 项目根 `Jenkinsfile` |

## 新项目接入（三步）

1. 复制 `Jenkinsfile`，只改 `projectDir` / `imageRepo` / `registry` / `deployScript`。
2. 在 `.github/workflows/ci.yml` 的 `matrix.project` 加一行项目相对路径。
3. Jenkins agent 预装 Node 20 + Docker；推送镜像时在 Jenkins 建凭据 `docker-registry`（或改 `registryCredential`）。

## 门禁内容

- 后端：`npm ci` + `npm test`（Vitest 全量用例）
- 前端：`npm install` + `npm run build`
- 镜像：`docker build`（验证 Dockerfile 与依赖可复现）

## 可选阶段

`Jenkinsfile` 中：
- `registry` 非空 → 增加镜像推送（tag = BUILD_NUMBER + latest）
- `deployScript` 非空 → 增加部署阶段（写你自己的 `ssh`/`pm2`/`kubectl` 命令）

> 说明：GitHub Actions 门禁只做构建验证，不推送镜像、不部署；部署仍由 Jenkins 或你手动执行，避免PR触发外部变更。
