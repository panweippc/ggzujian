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
