/**
 * 运行时配置服务（方案A：配置入库 + 热切换）
 * 从 app_configs 表读取驱动/通道等运行时开关，带 TTL 内存缓存。
 * 修改配置后无需重启进程，refresh() 立即使缓存失效即可生效。
 *
 * 约定配置键：
 *   runtime.storage.driver   文件驱动：local / minio / oss
 *   runtime.message.channel  默认消息通道：inapp / email / sms / wechat
 */
const TTL = +(process.env.RUNTIME_CONFIG_TTL_MS || 10_000);
const cache = new Map(); // key -> { value, at }

/** 读配置值（带缓存；DB 不可用时回退 env 默认值） */
export async function getRuntimeConfig(pool, key, fallback = '') {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.value;
  try {
    const [[row]] = await pool.execute(
      "SELECT configValue FROM app_configs WHERE configKey=? AND env='runtime' LIMIT 1", [key]
    );
    const value = row?.configValue ?? fallback;
    cache.set(key, { value, at: Date.now() });
    return value;
  } catch {
    return fallback;
  }
}

/** 写配置值（upsert 到 runtime 环境，并刷新缓存） */
export async function setRuntimeConfig(pool, key, value, operator = '') {
  await pool.execute(
    `INSERT INTO app_configs (configKey, configValue, category, env, description, version, updatedBy)
     VALUES (?,?,?, 'runtime', '运行时热切换配置', 1, ?)
     ON DUPLICATE KEY UPDATE configValue=VALUES(configValue), version=version+1, updatedBy=VALUES(updatedBy)`,
    [key, String(value), 'runtime', operator]
  );
  cache.set(key, { value: String(value), at: Date.now() });
}

/** 强制某个 key 或全部缓存失效（配置变更时调用） */
export function refreshRuntimeConfig(key) {
  if (key) cache.delete(key);
  else cache.clear();
}

/** 读取当前文件驱动 */
export async function storageDriver(pool) {
  return (await getRuntimeConfig(pool, 'runtime.storage.driver', process.env.STORAGE_DRIVER || 'local')).trim();
}

/** 读取默认消息通道 */
export async function messageChannel(pool) {
  return (await getRuntimeConfig(pool, 'runtime.message.channel', process.env.DEFAULT_MESSAGE_CHANNEL || 'inapp')).trim();
}
