/**
 * starter 公共 CI/CD Pipeline 模板（Scripted Pipeline）
 * ------------------------------------------------------------------
 * 放在仓库内，无需 Jenkins 配置 Shared Library；各项目根目录的 Jenkinsfile
 * 只保留一份薄配置，调用本模板并传入项目参数即可。
 *
 * 参数（全部可选）：
 *   projectDir       项目相对仓库根路径，默认 '.'
 *   nodeVersion      仅用于日志标识（Node 由 Jenkins agent 预装），默认 '20'
 *   imageRepo        镜像名，默认 'starter'
 *   registry         镜像仓库地址，留空则只构建不推送
 *   registryCredential Jenkins 凭据 ID，默认 'docker-registry'
 *   deployScript     部署命令字符串，留空则跳过部署阶段
 *   testCommand      自定义测试命令，默认 'npm test'
 *   buildCommand     自定义前端构建命令，默认 'npm run build'
 *   dbCompatGate     是否执行多数据库方言静态门禁，默认 true
 *   consistencyGate  是否执行一致性+环境变量门禁，默认 true
 */

def run(Map cfg = [:]) {
  def projectDir = cfg.projectDir ?: '.'
  def imageRepo = cfg.imageRepo ?: 'starter'
  def registry = cfg.registry ?: ''
  def registryCredential = cfg.registryCredential ?: 'docker-registry'
  def deployScript = cfg.deployScript ?: ''
  def testCommand = cfg.testCommand ?: 'npm test'
  def buildCommand = cfg.buildCommand ?: 'npm run build'
  def dbCompatGate = cfg.dbCompatGate == null ? true : cfg.dbCompatGate
  def consistencyGate = cfg.consistencyGate == null ? true : cfg.consistencyGate

  node {
    def image
    try {
      stage('Checkout') {
        checkout scm
      }

      stage('Backend Test') {
        dir("${projectDir}/server") {
          sh 'npm ci --no-audit --no-fund'
          sh testCommand
        }
      }

      if (consistencyGate) {
        stage('Consistency Gate') {
          dir(projectDir) {
            sh 'node scripts/check-consistency.mjs'
          }
          dir("${projectDir}/server") {
            sh 'node scripts/check-env.mjs'
            sh 'node scripts/check-secrets.mjs'
            sh 'node scripts/check-code-quality.mjs'   // 报告项，不阻断
            sh 'node scripts/check-compliance.mjs'     // 自查项，不阻断
            sh 'node scripts/generate-openapi.mjs --check'
          }
        }
      }

      if (consistencyGate) {
        stage('Extended Security Gate') {
          dir("${projectDir}/server") {
            sh 'node scripts/check-api-exposure.mjs'
            sh 'node scripts/check-config-baseline.mjs'
            sh 'node scripts/check-sql-safety.mjs'
            sh 'node scripts/check-coverage.mjs'
            sh 'node scripts/check-sbom.mjs'
            sh 'node scripts/check-data-classification.mjs'
            sh 'node scripts/check-permission-matrix.mjs'
            sh 'node scripts/check-backup-drill.mjs'
            sh 'node scripts/check-complexity.mjs'
            sh 'node scripts/check-unused-deps.mjs'
            sh 'node scripts/check-ts-strict.mjs'
            sh 'node scripts/check-api-contract.mjs'
          }
        }
      }

      if (dbCompatGate) {
        stage('DB Dialect Gate') {
          dir("${projectDir}/server") {
            sh 'node scripts/check-compat.mjs --driver postgres'
            sh 'node scripts/generate-dialect-ddl.mjs --check'
          }
        }
      }

      stage('Frontend Build') {
        dir("${projectDir}/web") {
          sh 'npm install --no-audit --no-fund'
          sh buildCommand
        }
      }

      stage('Docker Build') {
        dir(projectDir) {
          image = docker.build("${imageRepo}:${env.BUILD_NUMBER}")
        }
      }

      if (registry) {
        stage('Docker Push') {
          docker.withRegistry("https://${registry}", registryCredential) {
            image.push()
            image.push('latest')
          }
        }
      }

      if (deployScript) {
        stage('Deploy') {
          sh deployScript
        }
      }
    } finally {
      stage('Cleanup') {
        sh 'docker image prune -f --filter label=starter-ci=true || true'
        deleteDir()
      }
    }
  }
}

return this
