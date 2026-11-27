-- ============================================================
-- 电子签名 / 盖章扩展（2026-11-26）
-- 文档摘要 + HMAC 签章 + 验签 + 撤销记录；与工作流实例关联
-- 依赖：platform 扩展的工作流实例表（非强依赖）
-- ============================================================

CREATE TABLE IF NOT EXISTS signatures (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  docId VARCHAR(128) NOT NULL COMMENT '业务文档标识（如 workflow_instances.id 或合同号）',
  docType VARCHAR(64) NOT NULL DEFAULT 'contract' COMMENT '文档类型：contract/workflow/other',
  docHash CHAR(64) NOT NULL COMMENT '文档内容 SHA-256 摘要（Hex）',
  signer VARCHAR(64) NOT NULL COMMENT '签署人用户名',
  signerName VARCHAR(128) NOT NULL DEFAULT '' COMMENT '签署人显示名',
  sealId VARCHAR(64) NOT NULL DEFAULT '' COMMENT '印章标识',
  signature CHAR(64) NOT NULL COMMENT 'HMAC-SHA256 签名（64位Hex），对 docHash+signer+sealId+signedAt 签名',
  signedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ip VARCHAR(64) DEFAULT '' COMMENT '签署 IP',
  userAgent VARCHAR(255) DEFAULT '' COMMENT '签署 UA',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1有效 0已撤销',
  revokedAt DATETIME DEFAULT NULL,
  revokedBy VARCHAR(64) DEFAULT '',
  reason VARCHAR(255) DEFAULT '' COMMENT '撤销原因',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sig_doc (docId, status),
  KEY idx_sig_signer (signer, signedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='电子签章记录';

CREATE TABLE IF NOT EXISTS seals (
  id VARCHAR(64) NOT NULL COMMENT '印章标识（UUID）',
  name VARCHAR(128) NOT NULL COMMENT '印章名称',
  owner VARCHAR(64) NOT NULL COMMENT '所属人/部门',
  color VARCHAR(32) DEFAULT '#dc2626' COMMENT '显示颜色',
  imgData LONGTEXT COMMENT '印章图片 base64（可选）',
  status TINYINT NOT NULL DEFAULT 1 COMMENT '1启用 0停用',
  createdBy VARCHAR(64) DEFAULT '',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_seal_owner (owner, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='印章管理';
