-- ============================================================
-- 数据安全扩展：查询出口分级管控（导出审批单）
-- 依赖：db.sql（基础库）
-- 说明：本文件已注册到 scripts/sql-files.mjs，bundle-sql 会自动合入 db-all.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS data_export_approvals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  requestNo VARCHAR(32) NOT NULL COMMENT '申请单号 EXP+时间戳+随机码',
  schemaKey VARCHAR(64) NOT NULL COMMENT '导出模板 key',
  tableName VARCHAR(64) NOT NULL COMMENT '数据表',
  riskLevel VARCHAR(16) NOT NULL COMMENT '风险等级 low/medium/high',
  requestedBy VARCHAR(64) NOT NULL COMMENT '申请人',
  requestedAt DATETIME NOT NULL,
  reason VARCHAR(500) COMMENT '导出用途',
  rowLimit INT NOT NULL DEFAULT 10000 COMMENT '批准行数上限',
  status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT 'pending/approved/rejected/expired/used',
  approvedBy VARCHAR(64) COMMENT '审批人（auto=低风险自动放行）',
  approvedAt DATETIME,
  expiresAt DATETIME NOT NULL COMMENT '审批单有效期',
  createdAt DATETIME NOT NULL,
  updatedAt DATETIME NOT NULL,
  UNIQUE KEY uk_export_request (requestNo),
  KEY idx_export_status (status),
  KEY idx_export_requester (requestedBy)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='数据导出审批单';
