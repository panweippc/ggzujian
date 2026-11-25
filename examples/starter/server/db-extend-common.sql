-- ============================================================
-- 公共组件扩展表（骨架自带，随代码走；导入一次即可，全部幂等）
-- 覆盖：数据字典 / 配置中心 / 定时任务 / 在线会话 / IP 白名单 / TOTP
-- ⚠️ 导入必须带编码参数：mysql -u root -p --default-character-set=utf8mb4 my_project < db-extend-common.sql
--    Windows 下 mysql 客户端默认按 GBK 解读文件，不加会全部变乱码
-- ============================================================

-- 1) 数据字典：枚举选择器的动态数据源
CREATE TABLE IF NOT EXISTS dict_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  category VARCHAR(64) NOT NULL COMMENT '字典分类，如 gender / order_status',
  label VARCHAR(128) NOT NULL COMMENT '显示名',
  value VARCHAR(128) NOT NULL COMMENT '值',
  sort INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
  remark VARCHAR(255) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_dict_cat (category, status, sort)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO dict_items (category, label, value, sort, remark) VALUES
('gender', '男', 'M', 1, '演示字典'),
('gender', '女', 'F', 2, '演示字典'),
('gender', '保密', 'U', 3, '演示字典'),
('order_status', '待处理', 'pending', 1, '演示字典'),
('order_status', '处理中', 'processing', 2, '演示字典'),
('order_status', '已完成', 'done', 3, '演示字典');

-- 1b) 字典分类：统一管理 category 的中文名/说明，供下拉与分组展示
CREATE TABLE IF NOT EXISTS dict_categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(64) NOT NULL UNIQUE COMMENT '分类编码，对应 dict_items.category',
  name VARCHAR(128) NOT NULL COMMENT '分类名称',
  description VARCHAR(255) DEFAULT NULL,
  sort INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO dict_categories (code, name, description, sort) VALUES
('gender', '性别', '人员性别枚举', 1),
('order_status', '订单状态', '订单流转状态', 2);

-- 2) 配置中心：key-value 配置，JSON 值；支持多环境 + 版本历史
CREATE TABLE IF NOT EXISTS app_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  configKey VARCHAR(128) NOT NULL COMMENT '配置键，如 site.name',
  configValue TEXT COMMENT '配置值（JSON 或纯文本）',
  category VARCHAR(64) NOT NULL DEFAULT 'system',
  env VARCHAR(16) NOT NULL DEFAULT 'dev' COMMENT '环境: dev/test/prod',
  description VARCHAR(255) DEFAULT NULL,
  version INT NOT NULL DEFAULT 1 COMMENT '当前版本号',
  updatedBy VARCHAR(64) DEFAULT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cfg_key_env (configKey, env),
  INDEX idx_cfg_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 幂等迁移：老库单列 UNIQUE(configKey) → 联合唯一 (configKey, env) + 补 env/version 列
SET @has_env = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_configs' AND COLUMN_NAME = 'env');
SET @add_env = IF(@has_env = 0, 'ALTER TABLE app_configs ADD COLUMN env VARCHAR(16) NOT NULL DEFAULT ''dev''', 'SELECT 1');
PREPARE stmt_env FROM @add_env; EXECUTE stmt_env; DEALLOCATE PREPARE stmt_env;
SET @has_ver = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_configs' AND COLUMN_NAME = 'version');
SET @add_ver = IF(@has_ver = 0, 'ALTER TABLE app_configs ADD COLUMN version INT NOT NULL DEFAULT 1', 'SELECT 1');
PREPARE stmt_ver FROM @add_ver; EXECUTE stmt_ver; DEALLOCATE PREPARE stmt_ver;
SET @has_old_unique = (SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'app_configs' AND INDEX_NAME = 'configKey');
SET @drop_old = IF(@has_old_unique > 0, 'ALTER TABLE app_configs DROP INDEX configKey, ADD UNIQUE KEY uk_cfg_key_env (configKey, env)', 'SELECT 1');
PREPARE stmt_old FROM @drop_old; EXECUTE stmt_old; DEALLOCATE PREPARE stmt_old;

-- 配置版本历史：每次变更写快照，支持一键回滚
CREATE TABLE IF NOT EXISTS config_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  configKey VARCHAR(128) NOT NULL,
  env VARCHAR(16) NOT NULL DEFAULT 'dev',
  version INT NOT NULL,
  configValue TEXT,
  description VARCHAR(255) DEFAULT NULL,
  operation VARCHAR(16) NOT NULL COMMENT 'create/update/delete/rollback',
  operator VARCHAR(64) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hist_key_env (configKey, env, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_configs (configKey, configValue, category, env, description) VALUES
('site.name', '"我的管理系统"', 'system', 'dev', '站点名称'),
('site.theme', '"purple-blue"', 'system', 'dev', '默认主题'),
('security.loginLockAttempts', '5', 'security', 'dev', '登录失败锁定阈值'),
('security.loginLockMinutes', '15', 'security', 'dev', '锁定时长（分钟）');

-- 3) 定时任务：任务注册表（真正的执行由 pm2 cron / node-cron 兜底，本表做展示与开关）
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  taskName VARCHAR(128) NOT NULL,
  taskKey VARCHAR(64) NOT NULL UNIQUE COMMENT '任务标识',
  cron VARCHAR(64) NOT NULL COMMENT 'cron 表达式',
  description VARCHAR(255) DEFAULT NULL,
  enabled TINYINT NOT NULL DEFAULT 1,
  lastRunAt DATETIME DEFAULT NULL,
  lastStatus VARCHAR(32) DEFAULT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO scheduled_tasks (taskName, taskKey, cron, description, enabled) VALUES
('每日数据备份', 'daily_backup', '0 2 * * *', '每天凌晨 2 点自动备份数据库', 1),
('清理过期操作日志', 'clean_logs', '0 3 * * 0', '每周日清理 90 天前操作日志', 1),
('通知已读状态汇总', 'notify_summary', '0 */6 * * *', '每 6 小时汇总一次通知状态', 0);

-- 4) 在线会话：单设备互踢/会话管理（登录时写入，退出/过期删除）
CREATE TABLE IF NOT EXISTS user_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  tokenVersion INT NOT NULL DEFAULT 0,
  ipAddress VARCHAR(64) DEFAULT NULL,
  userAgent VARCHAR(255) DEFAULT NULL,
  loginAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lastActiveAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_user (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) IP 白名单：security.ipWhitelistEnabled 开启后生效
CREATE TABLE IF NOT EXISTS ip_whitelist (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NOT NULL UNIQUE COMMENT 'IP 或 CIDR，如 192.168.1.0/24',
  remark VARCHAR(255) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) TOTP 二次验证：每用户一个密钥（base32），enabled 控制是否启用
CREATE TABLE IF NOT EXISTS user_totp (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(64) NOT NULL UNIQUE,
  secret VARCHAR(128) NOT NULL COMMENT 'base32 密钥',
  enabled TINYINT NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  enabledAt DATETIME DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7) 统一文件服务：文件元数据（底层存储由 STORAGE_DRIVER 决定，业务只见此表）
CREATE TABLE IF NOT EXISTS file_objects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  objectKey VARCHAR(255) NOT NULL UNIQUE COMMENT '存储键（local 为文件名，minio/oss 为对象 key）',
  originalName VARCHAR(255) NOT NULL COMMENT '原始文件名',
  mimeType VARCHAR(128) DEFAULT NULL,
  size BIGINT DEFAULT 0,
  driver VARCHAR(32) NOT NULL DEFAULT 'local' COMMENT '存储驱动 local/minio/oss',
  url VARCHAR(512) DEFAULT NULL COMMENT '可访问 URL',
  uploadedBy VARCHAR(64) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_file_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8) 公共基础数据：组织机构 / 行政区划 / 行业分类统一模型，parentCode 支持树形
CREATE TABLE IF NOT EXISTS base_data (
  id INT AUTO_INCREMENT PRIMARY KEY,
  type VARCHAR(32) NOT NULL COMMENT '类型: organization=组织机构 region=行政区划 industry=行业分类',
  code VARCHAR(64) NOT NULL COMMENT '编码（全局按 type 唯一）',
  name VARCHAR(128) NOT NULL COMMENT '名称',
  parentCode VARCHAR(64) DEFAULT NULL COMMENT '上级编码，根节点为 NULL',
  sort INT NOT NULL DEFAULT 0,
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1=启用 0=停用',
  remark VARCHAR(255) DEFAULT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_base_type_code (type, code),
  INDEX idx_base_type_parent (type, parentCode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO base_data (type, code, name, parentCode, sort, remark) VALUES
('organization', 'HQ', '总公司', NULL, 1, '演示基础数据'),
('organization', 'HQ-HR', '人力资源部', 'HQ', 1, '演示基础数据'),
('organization', 'HQ-IT', '信息技术部', 'HQ', 2, '演示基础数据'),
('region', '110000', '北京市', NULL, 1, '演示基础数据'),
('region', '110100', '市辖区', '110000', 1, '演示基础数据'),
('region', '110101', '东城区', '110100', 1, '演示基础数据'),
('industry', 'A', '农、林、牧、渔业', NULL, 1, '演示基础数据'),
('industry', 'I', '信息传输、软件和信息技术服务业', NULL, 9, '演示基础数据'),
('industry', 'I65', '软件和信息技术服务业', 'I', 1, '演示基础数据');

-- 9) 回收站：软删记录快照，保留 KEEP_DAYS 天后由定时任务自动清除
CREATE TABLE IF NOT EXISTS recycle_bin (
  id INT AUTO_INCREMENT PRIMARY KEY,
  module VARCHAR(64) NOT NULL COMMENT '来源模块: file/dict/base_data/user/...（前端据此分组）',
  module_label VARCHAR(64) DEFAULT NULL COMMENT '模块中文名',
  record_id VARCHAR(64) NOT NULL COMMENT '原记录主键',
  title VARCHAR(255) DEFAULT NULL COMMENT '展示标题',
  payload JSON DEFAULT NULL COMMENT '原记录完整快照（用于恢复）',
  extra JSON DEFAULT NULL COMMENT '附加数据（如文件的 objectKey、物理路径）',
  deleted_by VARCHAR(64) DEFAULT NULL,
  deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expire_at DATETIME NOT NULL COMMENT '过期时间 = deleted_at + KEEP_DAYS',
  INDEX idx_recycle_expire (expire_at),
  INDEX idx_recycle_module (module),
  INDEX idx_recycle_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
