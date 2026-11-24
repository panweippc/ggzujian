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
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

INSERT IGNORE INTO roles (id, name, code, description, status, createdAt, updatedAt) VALUES
(1, '系统管理员', 'admin', '系统超级管理员，拥有所有权限', '启用', NOW(), NOW()),
(2, '普通员工', 'employee', '普通员工角色', '启用', NOW(), NOW()),
(3, '部门经理', 'manager', '部门管理角色', '启用', NOW(), NOW());

INSERT IGNORE INTO menus (id, parentId, name, path, component, icon, sort, status, createdAt, updatedAt) VALUES
(1, 0, '工作台', '/', 'HomeView', 'home', 1, '启用', NOW(), NOW()),
(2, 0, '系统管理', '/system', 'SystemManagementView', 'setting', 2, '启用', NOW(), NOW()),
(3, 0, '操作日志', '/logs', 'OperationLogView', 'clipboard', 3, '启用', NOW(), NOW());

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
