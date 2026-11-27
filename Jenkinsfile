/**
 * starter 项目薄配置 —— 公共流水线逻辑见 ci/pipeline.groovy
 * 新项目复制本文件，只改下面四个参数即可。
 */
def flow = load 'ci/pipeline.groovy'

flow.run([
  projectDir: 'examples/starter',
  imageRepo : 'starter',
  // 留空 = 只构建本地镜像不推送；填写后需 Jenkins 配置同名凭据
  registry  : env.DOCKER_REGISTRY ?: '',
  // 留空 = 跳过部署；填写后在主干构建成功后执行（如 Jenkins 触发远程 pm2/systemd）
  deployScript: env.DEPLOY_SCRIPT ?: '',
])
