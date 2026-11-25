-- 新项目最小表结构：公共包不建表，由业务项目自己创建
-- 密码用 bcrypt 哈希，可通过 node -e "import('@panweippc/auth-kit').then(m=>console.log(m.hashPassword('你的密码')))" 生成
-- ⚠️ 导入必须带编码参数：mysql -u root -p --default-character-set=utf8mb4 my_project < db.sql

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  password VARCHAR(100) NOT NULL COMMENT 'bcrypt 哈希，前 12 位作为 token 指纹',
  role VARCHAR(64) DEFAULT 'user' COMMENT '角色名，签发到 token',
  token_version INT DEFAULT 0 COMMENT '会话版本，改密/踢下线时 +1',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS operation_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  userId VARCHAR(64) DEFAULT '',
  username VARCHAR(64) DEFAULT '',
  action VARCHAR(64) DEFAULT '',
  module VARCHAR(64) DEFAULT '',
  targetId VARCHAR(64) DEFAULT NULL,
  targetName VARCHAR(128) DEFAULT NULL,
  detail TEXT,
  beforeValue TEXT,
  afterValue TEXT,
  ipAddress VARCHAR(64) DEFAULT '',
  traceId VARCHAR(64) DEFAULT NULL COMMENT '全链路追踪ID，贯穿请求/日志/响应头',
  requestBody TEXT COMMENT '请求参数（敏感字段已打码）',
  responseResult TEXT COMMENT '响应结果（敏感字段已打码）',
  durationMs INT DEFAULT 0 COMMENT '接口耗时（毫秒）',
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_log_trace (traceId), INDEX idx_log_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 老库幂等补列：已存在的 operation_logs 表自动补齐网关新增字段
SET @db := DATABASE();
SET @c_trace = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs' AND COLUMN_NAME='traceId');
SET @sql_trace = IF(@c_trace=0, 'ALTER TABLE operation_logs ADD COLUMN traceId VARCHAR(64) DEFAULT NULL COMMENT''全链路追踪ID''', 'SELECT 1');
PREPARE st_trace FROM @sql_trace; EXECUTE st_trace; DEALLOCATE PREPARE st_trace;
SET @c_req = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs' AND COLUMN_NAME='requestBody');
SET @sql_req = IF(@c_req=0, 'ALTER TABLE operation_logs ADD COLUMN requestBody TEXT', 'SELECT 1');
PREPARE st_req FROM @sql_req; EXECUTE st_req; DEALLOCATE PREPARE st_req;
SET @c_res = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs' AND COLUMN_NAME='responseResult');
SET @sql_res = IF(@c_res=0, 'ALTER TABLE operation_logs ADD COLUMN responseResult TEXT', 'SELECT 1');
PREPARE st_res FROM @sql_res; EXECUTE st_res; DEALLOCATE PREPARE st_res;
SET @c_dur = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs' AND COLUMN_NAME='durationMs');
SET @sql_dur = IF(@c_dur=0, 'ALTER TABLE operation_logs ADD COLUMN durationMs INT DEFAULT 0', 'SELECT 1');
PREPARE st_dur FROM @sql_dur; EXECUTE st_dur; DEALLOCATE PREPARE st_dur;

-- 默认管理员（密码哈希仅为示例，真实项目请替换）
-- INSERT INTO users(username, password, role) VALUES('admin', '$2a$10$替换为你生成的bcrypt哈希', 'admin');
