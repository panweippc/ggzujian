-- 企业级底座补全扩展表（回收站之外的 ①②③④ 档能力）
-- ⚠️ 导入必须带编码参数：mysql -u root -p --default-character-set=utf8mb4 my_project < db-extend-enterprise.sql
SET NAMES utf8mb4;
SET @db := DATABASE();

-- ========== ① 全留痕延伸 ==========
-- 审计归档表（从 operation_logs 搬移过期日志，主表保持轻量）
CREATE TABLE IF NOT EXISTS operation_logs_archive LIKE operation_logs;

-- 哈希链字段：每行 hash = SHA256(prevHash + 本行关键字段)，用于防篡改校验（幂等补列）
SET @c_hash = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs' AND COLUMN_NAME='rowHash');
SET @sql_hash = IF(@c_hash=0, 'ALTER TABLE operation_logs ADD COLUMN rowHash CHAR(64) DEFAULT NULL COMMENT ''防篡改哈希链'' AFTER durationMs', 'SELECT 1');
PREPARE st_hash FROM @sql_hash; EXECUTE st_hash; DEALLOCATE PREPARE st_hash;
SET @c_hash2 = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=@db AND TABLE_NAME='operation_logs_archive' AND COLUMN_NAME='rowHash');
SET @sql_hash2 = IF(@c_hash2=0, 'ALTER TABLE operation_logs_archive ADD COLUMN rowHash CHAR(64) DEFAULT NULL', 'SELECT 1');
PREPARE st_hash2 FROM @sql_hash2; EXECUTE st_hash2; DEALLOCATE PREPARE st_hash2;

-- ========== ② 网关运维 ==========
-- 接口幂等键：写请求带 Idempotency-Key，缓存首次响应
CREATE TABLE IF NOT EXISTS idempotency_keys (
  idempotencyKey VARCHAR(128) NOT NULL PRIMARY KEY,
  endpoint VARCHAR(255) NOT NULL,
  responseJson TEXT,
  statusCode INT DEFAULT 200,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_idem_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== ③ 业务底座 ==========
-- 消息已读回执（notifications 已有 isRead，这里补每用户独立回执）
CREATE TABLE IF NOT EXISTS message_read_receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  messageId INT NOT NULL,
  username VARCHAR(64) NOT NULL,
  readAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_msg_user (messageId, username),
  INDEX idx_receipt_msg (messageId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 文件分片上传会话（断点续传）
CREATE TABLE IF NOT EXISTS upload_sessions (
  uploadId VARCHAR(64) NOT NULL PRIMARY KEY,
  fileName VARCHAR(255) NOT NULL,
  totalChunks INT NOT NULL,
  chunkSize BIGINT NOT NULL,
  uploadedChunks INT NOT NULL DEFAULT 0,
  mimeType VARCHAR(128) DEFAULT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'uploading' COMMENT 'uploading/merged/expired',
  finalKey VARCHAR(255) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_upload_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 定时任务执行历史与失败重试
CREATE TABLE IF NOT EXISTS task_execution_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  taskId INT DEFAULT NULL,
  taskKey VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL COMMENT 'success/failed',
  durationMs INT DEFAULT 0,
  result TEXT,
  error TEXT,
  retryCount INT NOT NULL DEFAULT 0,
  executedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_exec_task (taskKey), INDEX idx_exec_time (executedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 数据权限规则配置化（角色 → 部门范围）
CREATE TABLE IF NOT EXISTS role_data_scope_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role VARCHAR(64) NOT NULL,
  scope VARCHAR(16) NOT NULL COMMENT 'all/dept/self/custom',
  deptCodes TEXT DEFAULT NULL COMMENT 'custom 时的部门编码列表(JSON)',
  remark VARCHAR(255) DEFAULT NULL,
  updatedBy VARCHAR(64) DEFAULT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 字典多语言（dict_items 的 i18n 扩展）
CREATE TABLE IF NOT EXISTS dict_item_i18n (
  id INT AUTO_INCREMENT PRIMARY KEY,
  dictItemId INT NOT NULL,
  lang VARCHAR(16) NOT NULL COMMENT 'zh-CN/en-US/...',
  label VARCHAR(255) NOT NULL,
  UNIQUE KEY uk_item_lang (dictItemId, lang)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
