-- ============================================================================
-- 平台化能力扩展表（工作流 / 表单设计 / 报表 / 多租户 / 套餐 / 合规 / 集成）
-- 全部幂等，可重复执行；导入务必带 --default-character-set=utf8mb4
-- ============================================================================

-- ---------- 1. 工作流引擎 ----------
CREATE TABLE IF NOT EXISTS workflow_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE COMMENT '流程编码，如 leave/expense',
  name VARCHAR(128) NOT NULL COMMENT '流程名称',
  description VARCHAR(500) DEFAULT '',
  nodes JSON NOT NULL COMMENT '节点定义 [{id,name,type,assignee,approvers}]',
  edges JSON DEFAULT NULL COMMENT '连线定义 [{from,to,condition}]',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  version INT NOT NULL DEFAULT 1,
  createdBy VARCHAR(64) DEFAULT '',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workflow_instances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  defCode VARCHAR(64) NOT NULL,
  title VARCHAR(200) NOT NULL,
  initiator VARCHAR(64) NOT NULL,
  businessKey VARCHAR(128) DEFAULT NULL COMMENT '关联业务单据ID',
  formData JSON DEFAULT NULL COMMENT '提交的表单数据快照',
  currentNode VARCHAR(64) DEFAULT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'running' COMMENT 'running/approved/rejected/cancelled',
  startedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  endedAt DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @has_idx = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workflow_instances' AND INDEX_NAME='idx_wf_inst_status');
SET @sql = IF(@has_idx=0, 'CREATE INDEX idx_wf_inst_status ON workflow_instances(status, initiator)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS workflow_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  instanceId INT NOT NULL,
  nodeId VARCHAR(64) NOT NULL,
  assignee VARCHAR(64) NOT NULL COMMENT '待办人用户名',
  status VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected/skipped',
  comment VARCHAR(500) DEFAULT '',
  handledAt DATETIME DEFAULT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
SET @has_idx2 = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='workflow_tasks' AND INDEX_NAME='idx_wf_task_assignee');
SET @sql2 = IF(@has_idx2=0, 'CREATE INDEX idx_wf_task_assignee ON workflow_tasks(assignee, status)', 'SELECT 1');
PREPARE stmt2 FROM @sql2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

-- ---------- 2. 表单设计器 ----------
CREATE TABLE IF NOT EXISTS form_schemas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  schemaData JSON NOT NULL COMMENT '字段配置数组',
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 3. 报表 / BI ----------
CREATE TABLE IF NOT EXISTS report_definitions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'chart' COMMENT 'chart/table',
  chartType VARCHAR(20) DEFAULT 'bar' COMMENT 'bar/line/pie',
  sqlTemplate TEXT NOT NULL COMMENT '只读查询SQL模板（平台校验仅允许SELECT）',
  description VARCHAR(500) DEFAULT '',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 4. 多租户 ----------
CREATE TABLE IF NOT EXISTS tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  planId INT DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  config JSON DEFAULT NULL COMMENT '租户级配置覆盖',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  limits JSON NOT NULL COMMENT '配额 {maxUsers,maxStorageMb,modules:[]}',
  price DECIMAL(10,2) DEFAULT 0,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 用户-租户关联（字段级隔离用）
CREATE TABLE IF NOT EXISTS user_tenants (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  tenantId INT NOT NULL,
  roleInTenant VARCHAR(32) DEFAULT 'member',
  UNIQUE KEY uk_user_tenant (username, tenantId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 5. 安全合规 ----------
-- 字段分级分类策略
CREATE TABLE IF NOT EXISTS data_classification (
  id INT AUTO_INCREMENT PRIMARY KEY,
  tableName VARCHAR(64) NOT NULL,
  columnName VARCHAR(64) NOT NULL,
  level VARCHAR(20) NOT NULL COMMENT 'public/internal/sensitive/secret',
  maskRule VARCHAR(32) DEFAULT NULL COMMENT 'phone/idcard/email/name/none',
  encrypt TINYINT NOT NULL DEFAULT 0 COMMENT '是否加密存储',
  UNIQUE KEY uk_table_col (tableName, columnName)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 委托授权（代理审批/代办）
CREATE TABLE IF NOT EXISTS delegations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fromUser VARCHAR(64) NOT NULL,
  toUser VARCHAR(64) NOT NULL,
  reason VARCHAR(200) DEFAULT '',
  startTime DATETIME NOT NULL,
  endTime DATETIME NOT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 6. 事件订阅 / Webhook ----------
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  eventKey VARCHAR(64) NOT NULL COMMENT '领域事件，如 audit.danger',
  targetUrl VARCHAR(500) NOT NULL COMMENT '回调地址',
  secret VARCHAR(128) DEFAULT NULL COMMENT '签名密钥（加密存储）',
  enabled TINYINT NOT NULL DEFAULT 1,
  lastTriggerAt DATETIME DEFAULT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 7. 数据集成 / ETL ----------
CREATE TABLE IF NOT EXISTS etl_pipelines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL,
  sourceType VARCHAR(32) NOT NULL COMMENT 'mysql/csv/api',
  sourceConfig JSON NOT NULL,
  targetTable VARCHAR(64) NOT NULL,
  fieldMap JSON NOT NULL,
  cron VARCHAR(64) DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 0,
  lastRunAt DATETIME DEFAULT NULL,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 8. 开放平台 API 密钥 ----------
CREATE TABLE IF NOT EXISTS api_keys (
  id INT AUTO_INCREMENT PRIMARY KEY,
  appName VARCHAR(128) NOT NULL,
  accessKey VARCHAR(64) NOT NULL UNIQUE,
  secretHash VARCHAR(128) NOT NULL COMMENT 'secret 的哈希，不明文存储',
  scopeList JSON DEFAULT NULL COMMENT '授权范围，如 ["read:users","write:workflow"]',
  expiresAt DATETIME DEFAULT NULL,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- 9. 智能巡检规则 ----------
CREATE TABLE IF NOT EXISTS ai_inspect_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  ruleType VARCHAR(32) NOT NULL COMMENT 'log/anomaly/usage',
  config JSON NOT NULL COMMENT '检测规则',
  enabled TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 演示数据（INSERT IGNORE，可重复执行）
-- ============================================================================
INSERT IGNORE INTO plans (code, name, limits, price) VALUES
('free', '免费版', JSON_OBJECT('maxUsers', 10, 'maxStorageMb', 100, 'modules', JSON_ARRAY('dashboard','users')), 0),
('pro', '专业版', JSON_OBJECT('maxUsers', 100, 'maxStorageMb', 1024, 'modules', JSON_ARRAY('dashboard','users','workflow','report')), 299.00),
('enterprise', '企业版', JSON_OBJECT('maxUsers', 9999, 'maxStorageMb', 10240, 'modules', JSON_ARRAY('*')), 1999.00);

INSERT IGNORE INTO tenants (code, name, planId, config) VALUES
('default', '默认租户', 1, JSON_OBJECT('theme', 'purple'));

INSERT IGNORE INTO workflow_definitions (code, name, description, nodes, edges, createdBy) VALUES
('leave', '请假审批', '演示流程：提交→部门经理审批→结束',
 JSON_ARRAY(JSON_OBJECT('id','start','name','开始','type','start'), JSON_OBJECT('id','mgr','name','部门经理审批','type','approve','approvers',JSON_ARRAY('admin')), JSON_OBJECT('id','end','name','结束','type','end')),
 JSON_ARRAY(JSON_OBJECT('from','start','to','mgr'), JSON_OBJECT('from','mgr','to','end')), 'system');

INSERT IGNORE INTO form_schemas (code, name, schemaData) VALUES
('leave_form', '请假申请表单', JSON_ARRAY(
  JSON_OBJECT('prop','days','label','请假天数','type','number','required',TRUE),
  JSON_OBJECT('prop','reason','label','请假事由','type','textarea','required',TRUE),
  JSON_OBJECT('prop','urgent','label','是否紧急','type','switch','required',FALSE)
));

INSERT IGNORE INTO report_definitions (code, name, type, chartType, sqlTemplate, description) VALUES
('login_trend', '登录趋势', 'chart', 'line', 'SELECT DATE(createdAt) d, COUNT(*) c FROM operation_logs WHERE action=\'login\' GROUP BY DATE(createdAt) ORDER BY d', '按天统计登录次数'),
('action_dist', '操作类型分布', 'chart', 'pie', 'SELECT action, COUNT(*) c FROM operation_logs GROUP BY action ORDER BY c DESC', '操作动作占比');

INSERT IGNORE INTO data_classification (tableName, columnName, level, maskRule, encrypt) VALUES
('users','password','secret','none',1),
('employees','phone','sensitive','phone',0),
('employees','idCard','sensitive','idcard',0),
('employees','email','internal','email',0);

INSERT IGNORE INTO ai_inspect_rules (name, ruleType, config) VALUES
('登录失败突增', 'log', JSON_OBJECT('action','login_fail','threshold',10,'windowMinutes',5)),
('慢接口堆积', 'anomaly', JSON_OBJECT('metric','slow_request','threshold',20,'windowMinutes',10));

SELECT 'db-extend-platform.sql applied' AS result;
