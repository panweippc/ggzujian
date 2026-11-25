-- ============================================================
-- db-all.sql — 一次性导入合集（自动生成，请勿手动修改）
-- 生成命令：cd server && npm run sql:bundle
-- 源文件与顺序：scripts/sql-files.mjs
-- 导入命令：mysql -u root -p --default-character-set=utf8mb4 my_project < db-all.sql
-- 5 个源文件均为幂等脚本，本合集可重复执行；
-- 如需 checksum 版本管理/跳过已迁移文件，请改用 node scripts/migrate.mjs
-- ============================================================

SET NAMES utf8mb4;

-- ============ 以下来自 db.sql ============
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

-- ============ 以下来自 db-extend-system.sql ============
-- 系统管理扩展表（从 qygl 迁移，供用户管理/角色管理/数据备份使用）
-- 注意：users 表沿用 starter 自带结构（bcrypt + token_version），不要覆盖
-- 执行: mysql -u root -p --default-character-set=utf8mb4 my_project < db-extend-system.sql
-- ⚠️ Windows 下 mysql 客户端默认按 GBK 解读文件，不加 --default-character-set=utf8mb4 会全部变乱码

CREATE TABLE IF NOT EXISTS departments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT '启用',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  code VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  status VARCHAR(20) NOT NULL DEFAULT '启用',
  dataScope VARCHAR(20) NOT NULL DEFAULT 'all' COMMENT '数据范围: all=全部 dept=本部门 self=仅本人',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 幂等补列：老库 roles 无 dataScope 时自动加
SET @has_scope = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'dataScope');
SET @add_scope = IF(@has_scope = 0, 'ALTER TABLE roles ADD COLUMN dataScope VARCHAR(20) NOT NULL DEFAULT ''all'' COMMENT ''数据范围: all/dept/self''', 'SELECT 1');
PREPARE stmt_scope FROM @add_scope;
EXECUTE stmt_scope;
DEALLOCATE PREPARE stmt_scope;

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(50) NOT NULL UNIQUE,
  department VARCHAR(50) NOT NULL,
  position VARCHAR(50) NOT NULL DEFAULT '',
  email VARCHAR(100) NOT NULL DEFAULT '',
  phone VARCHAR(30) NOT NULL DEFAULT '',
  entryDate DATETIME NOT NULL,
  createdAt DATETIME NOT NULL,
  status VARCHAR(20) DEFAULT '在职',
  employeeType VARCHAR(20) DEFAULT '正式员工',
  education VARCHAR(20) DEFAULT NULL,
  birthDate DATE DEFAULT NULL,
  idCard VARCHAR(18) DEFAULT NULL,
  address VARCHAR(255) DEFAULT NULL,
  emergencyContact VARCHAR(50) DEFAULT NULL,
  emergencyPhone VARCHAR(30) DEFAULT NULL,
  parentDepartmentId INT DEFAULT NULL,
  level INT DEFAULT 1,
  roleId INT DEFAULT NULL,
  avatar VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS menus (
  id INT AUTO_INCREMENT PRIMARY KEY,
  parentId INT DEFAULT 0,
  name VARCHAR(100) NOT NULL,
  path VARCHAR(255) NOT NULL,
  component VARCHAR(100) DEFAULT NULL,
  icon VARCHAR(100) DEFAULT NULL,
  sort INT DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT '启用',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roleId INT NOT NULL,
  menuId INT NOT NULL,
  createdAt DATETIME NOT NULL,
  UNIQUE KEY role_menu_unique (roleId, menuId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_button_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  roleId INT NOT NULL,
  menuId INT NOT NULL,
  buttonKey VARCHAR(100) NOT NULL,
  createdAt DATETIME NOT NULL,
  UNIQUE KEY role_menu_button_unique (roleId, menuId, buttonKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============ 演示数据（幂等，可重复执行）============

INSERT IGNORE INTO departments (id, name, code, description, status, createdAt, updatedAt) VALUES
(1, '技术部', 'tech', '负责系统开发和维护', '启用', NOW(), NOW()),
(2, '销售部', 'sales', '负责产品销售和客户管理', '启用', NOW(), NOW()),
(3, '财务部', 'finance', '负责财务管理和会计核算', '启用', NOW(), NOW()),
(4, '人力资源部', 'hr', '负责人力资源和员工培训', '启用', NOW(), NOW()),
(5, '管理部门', 'management', '公司管理层', '启用', NOW(), NOW());

INSERT IGNORE INTO roles (id, name, code, description, status, dataScope, createdAt, updatedAt) VALUES
(1, '系统管理员', 'admin', '系统超级管理员，拥有所有权限', '启用', 'all', NOW(), NOW()),
(2, '普通员工', 'employee', '普通员工角色', '启用', 'self', NOW(), NOW()),
(3, '部门经理', 'manager', '部门管理角色', '启用', 'dept', NOW(), NOW());

-- 幂等刷新 dataScope（老库 IGNORE 不会覆盖已存在角色，需显式 UPDATE 一次）
UPDATE roles SET dataScope = CASE code
  WHEN 'admin' THEN 'all' WHEN 'employee' THEN 'self' WHEN 'manager' THEN 'dept'
  ELSE dataScope END
WHERE code IN ('admin','employee','manager') AND dataScope = 'all' AND code <> 'admin';

-- 菜单：与前端 SIDE_MENUS 的 10 个路由对齐（id 必须一致，权限分配靠 menuId）
INSERT IGNORE INTO menus (id, parentId, name, path, component, icon, sort, status, createdAt, updatedAt) VALUES
(1, 0, '工作台', '/', 'HomeView', 'home', 1, '启用', NOW(), NOW()),
(2, 0, '消息中心', '/messages', 'MessageCenterView', 'email', 2, '启用', NOW(), NOW()),
(3, 0, '操作日志', '/logs', 'OperationLogView', 'clipboard', 3, '启用', NOW(), NOW()),
(4, 0, '系统管理', '/system', 'SystemManagementView', 'setting', 4, '启用', NOW(), NOW()),
(5, 0, '安全设置', '/security', 'SecuritySettingsView', 'key', 5, '启用', NOW(), NOW()),
(6, 0, '公共组件', '/components', 'ComponentsView', 'quality', 6, '启用', NOW(), NOW()),
(7, 0, '系统监控', '/monitor', 'MonitorView', 'monitor', 7, '启用', NOW(), NOW()),
(8, 0, '配置中心', '/config', 'ConfigView', 'sliders', 8, '启用', NOW(), NOW()),
(9, 0, '定时任务', '/tasks', 'TaskView', 'clock', 9, '启用', NOW(), NOW()),
(10, 0, '接口文档', '/api-docs', 'ApiDocsView', 'book', 10, '启用', NOW(), NOW()),
(11, 0, '文件服务', '/files', 'FileServiceView', 'folder', 11, '启用', NOW(), NOW()),
(12, 0, '消息通道', '/message-channels', 'MessageChannelView', 'bell', 12, '启用', NOW(), NOW());

-- 演示权限：普通员工可见工作台/消息/日志；部门经理多给系统管理/监控
INSERT IGNORE INTO role_permissions (roleId, menuId, createdAt) VALUES
(2, 1, NOW()), (2, 2, NOW()), (2, 3, NOW()),
(3, 1, NOW()), (3, 2, NOW()), (3, 3, NOW()), (3, 4, NOW()), (3, 7, NOW());

-- 老库校正：id=2 若仍是旧值「系统管理」则改回「消息中心」（仅此一次，不覆盖用户后续修改）
UPDATE menus SET name='消息中心', path='/messages', component='MessageCenterView', icon='email', sort=2, updatedAt=NOW()
WHERE id=2 AND path='/system';

-- 演示员工：admin 对应 starter 的登录账号；其余为纯资料展示
INSERT IGNORE INTO employees (id, name, department, position, email, phone, entryDate, createdAt, status, employeeType, roleId) VALUES
(1, 'admin', '管理部门', '系统管理员', 'admin@example.com', '13800000000', NOW(), NOW(), '在职', '正式员工', 1),
(2, '张三', '技术部', '前端工程师', 'zhangsan@example.com', '13800000001', NOW(), NOW(), '在职', '正式员工', 2),
(3, '李四', '销售部', '销售经理', 'lisi@example.com', '13800000002', NOW(), NOW(), '在职', '正式员工', 3);

-- ============ 消息通知中心 ============
-- recipient 为接收人用户名；'*' 表示全员广播（所有人可见，个人已读状态隔离）
-- type 由前端 config.ts 的 NOTIFICATION_TYPES 映射成图标/颜色/文案
CREATE TABLE IF NOT EXISTS notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  recipient VARCHAR(64) NOT NULL COMMENT '接收人用户名，* 表示全员广播',
  type VARCHAR(32) NOT NULL DEFAULT 'system' COMMENT '通知类型: system/backup/user/security/approve',
  title VARCHAR(128) NOT NULL,
  content TEXT,
  link VARCHAR(255) DEFAULT NULL COMMENT '点击跳转的前端路由，如 /system',
  isRead TINYINT NOT NULL DEFAULT 0 COMMENT '广播通知用 notifications_reads 表按人记录，此字段对广播无效',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_recipient_read (recipient, isRead),
  INDEX idx_created (createdAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 广播通知的按人已读记录（避免全员广播时一人已读影响所有人）
CREATE TABLE IF NOT EXISTS notifications_reads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  notificationId INT NOT NULL,
  username VARCHAR(64) NOT NULL,
  readAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  hidden TINYINT NOT NULL DEFAULT 0 COMMENT '1=该用户已删除此广播通知（按人隐藏，不影响他人）',
  UNIQUE KEY notif_user_unique (notificationId, username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 幂等补列：老库已有 notifications_reads 但无 hidden 时自动加
SET @has_hidden = (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'notifications_reads' AND COLUMN_NAME = 'hidden');
SET @add_hidden = IF(@has_hidden = 0, 'ALTER TABLE notifications_reads ADD COLUMN hidden TINYINT NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt_hidden FROM @add_hidden;
EXECUTE stmt_hidden;
DEALLOCATE PREPARE stmt_hidden;

-- 演示通知（幂等）：让新拉取项目的人登录后立刻能看到效果
INSERT IGNORE INTO notifications (id, recipient, type, title, content, link, isRead, createdAt) VALUES
(1, '*', 'system', '欢迎使用管理系统骨架', '这是一条全员广播通知。消息中心已接入后端，可在系统管理触发操作产生新通知。', '/', 0, NOW()),
(2, '*', 'backup', '数据备份功能已就绪', '系统管理 - 数据备份可创建/下载/恢复数据库备份，操作后会自动推送通知。', '/system', 0, NOW());

-- ============ 以下来自 db-extend-common.sql ============
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

-- ============ 以下来自 db-extend-enterprise.sql ============
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

-- ============ 以下来自 db-extend-platform.sql ============
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
