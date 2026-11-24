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
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 默认管理员（密码哈希仅为示例，真实项目请替换）
-- INSERT INTO users(username, password, role) VALUES('admin', '$2a$10$替换为你生成的bcrypt哈希', 'admin');
