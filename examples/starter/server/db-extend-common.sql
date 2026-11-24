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

-- 2) 配置中心：key-value 配置，JSON 值
CREATE TABLE IF NOT EXISTS app_configs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  configKey VARCHAR(128) NOT NULL UNIQUE COMMENT '配置键，如 site.name',
  configValue TEXT COMMENT '配置值（JSON 或纯文本）',
  category VARCHAR(64) NOT NULL DEFAULT 'system',
  description VARCHAR(255) DEFAULT NULL,
  updatedBy VARCHAR(64) DEFAULT NULL,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_cfg_cat (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO app_configs (configKey, configValue, category, description) VALUES
('site.name', '"我的管理系统"', 'system', '站点名称'),
('site.theme', '"purple-blue"', 'system', '默认主题'),
('security.loginLockAttempts', '5', 'security', '登录失败锁定阈值'),
('security.loginLockMinutes', '15', 'security', '锁定时长（分钟）');

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
