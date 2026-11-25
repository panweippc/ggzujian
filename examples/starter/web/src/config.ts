/**
 * ★★★ 新项目只改这一个文件 ★★★
 *
 * 这是"科技风管理后台骨架"的唯一配置入口。
 * 品牌、登录页导览、侧边栏菜单、表格字段、日志筛选项全部集中在此。
 * UI 组件（登录页/布局/系统管理/操作日志）从此处读配置，不用改组件源码。
 */

// ============ 品牌 ============
export const BRAND = {
  title: '我的管理系统',          // 登录页大标题 / 顶栏名称
  shortName: '管理系统',          // 侧边栏简称
  subtitle: '科技赋能 · 智慧管理', // 登录页副标题
  logo: '⚡',                     // Logo 文字（图片请改组件 slot）
  primaryColor: '#1E5AA8',        // 主题主色
  adminContactName: '系统管理员', // 忘记密码弹窗里的联系人
};

// ============ 登录页左侧「平台能力」导览 ============
// 图标为内联 SVG 字符串；换成自己的业务模块即可
const ICON = (path: string, color: string) =>
  `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const LOGIN_MODULES = [
  { name: '用户管理', bg: 'rgba(74,168,255,.14)', icon: ICON('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M17 11a3 3 0 1 0 0-6"/>', '#1E5AA8') },
  { name: '角色权限', bg: 'rgba(139,92,246,.14)', icon: ICON('<circle cx="12" cy="8" r="3.2"/><path d="M5 20c0-3.5 3.1-6 7-6s7 2.5 7 6"/>', '#7c3aed') },
  { name: '操作审计', bg: 'rgba(251,146,60,.15)', icon: ICON('<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/>', '#ea580c') },
  { name: '数据统计', bg: 'rgba(52,211,153,.15)', icon: ICON('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>', '#0f9d76') },
  { name: '系统配置', bg: 'rgba(251,191,36,.16)', icon: ICON('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 8.9a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15.1 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z"/>', '#c28706') },
  { name: '安全告警', bg: 'rgba(239,68,68,.14)', icon: ICON('<path d="M12 3l9 16H3z"/><path d="M12 9v4M12 16v.5"/>', '#dc2626') },
];

// ============ 登录页每日寄语（按年内天数取模轮播）============
export const DAILY_QUOTES = [
  '把简单的事做到极致，就是不简单。',
  '今天的努力，是明天的实力。',
  '认真工作的人，运气都不会太差。',
  '每一步都算数，每一天都值得。',
  '与其担心未来，不如现在努力。',
  '成功来自坚持，坚持造就非凡。',
  '把小事做好，把大事做细。',
  '心中有目标，脚下有力量。',
  '细节决定成败，态度决定高度。',
  '保持热爱，奔赴山海。',
  '星光不问赶路人，时光不负有心人。',
  '行胜于言，实干为本。',
];

// ============ 侧边栏菜单 ============
// path 对应 router.ts 中的路由；icon 用 emoji（可在组件 ICONS 表扩展）
export const SIDE_MENUS = [
  { id: 1, name: '工作台', path: '/', icon: 'home' },
  { id: 2, name: '消息中心', path: '/messages', icon: 'email' },
  { id: 3, name: '操作日志', path: '/logs', icon: 'clipboard' },
  { id: 4, name: '系统管理', path: '/system', icon: 'setting' },
  { id: 5, name: '安全设置', path: '/security', icon: 'key' },
  { id: 6, name: '公共组件', path: '/components', icon: 'quality' },
  { id: 7, name: '系统监控', path: '/monitor', icon: 'monitor' },
  { id: 8, name: '配置中心', path: '/config', icon: 'sliders' },
  { id: 9, name: '定时任务', path: '/tasks', icon: 'clock' },
  { id: 10, name: '接口文档', path: '/api-docs', icon: 'book' },
  { id: 11, name: '文件服务', path: '/files', icon: 'folder' },
  { id: 12, name: '消息通道', path: '/message-channels', icon: 'bell' },
];

// ============ 系统管理 - Tab 配置 ============
// 结构照搬 qygl（角色/用户/菜单/权限/备份）。
// implemented=true 的 tab 会渲染真实表格；false 的 tab 显示"待接后端"骨架。
// 新项目接入时：改这里 + 在组件里加对应分支即可。
export const SYSTEM_TABS = [
  { name: 'roles', label: '角色管理', icon: '👥', implemented: true },
  { name: 'users', label: '用户管理', icon: '👤', implemented: true },
  { name: 'menus', label: '菜单管理', icon: '📋', implemented: true },
  { name: 'permissions', label: '权限管理', icon: '🔐', implemented: true },
  { name: 'backup', label: '数据备份', icon: '💾', implemented: true },
];

// 系统管理页头部文案（照搬 qygl 的标题+副标题结构）
export const SYSTEM_PAGE = {
  title: '系统管理',
  subtitle: '角色管理、用户管理与权限配置中心',
};

// ============ 系统管理 - 用户表格列 ============
// 字段对应后端 GET /api/users 返回的列（id / username / role）
export const USER_COLUMNS = [
  { prop: 'id', label: '编号', width: '90' },
  { prop: 'username', label: '用户名' },
  {
    prop: 'role', label: '角色',
    formatter: (v: string) => ({ admin: '管理员', user: '普通用户' } as Record<string, string>)[v] || v,
  },
];

// ============ 操作日志 - 映射表（照搬 qygl）============
// 后端存英文枚举，这里映射成中文显示。新项目按自己后端枚举补充即可。
export const ACTION_LABELS: Record<string, string> = {
  create: '创建', update: '更新', delete: '删除', soft_delete: '删除', login: '登录',
  login_fail: '登录失败', login_new_ip: '新IP登录', logout: '退出',
  approve: '审批通过', reject: '驳回', submit: '提交', withdraw: '撤回',
  upload: '上传', download: '下载', export: '导出', import: '导入',
  change_password: '修改密码', create_user: '创建用户', assign: '分配权限',
};
export const MODULE_LABELS: Record<string, string> = {
  auth: '登录认证', user: '用户管理', system: '系统管理',
  operation_log: '操作日志', file: '文件管理', notification: '消息通知',
};
export const FIELD_LABELS: Record<string, string> = {
  id: '编号', username: '用户名', role: '角色', status: '状态', name: '姓名',
};
// el-tag 类型映射（科技蓝主题下用 success/primary/danger/warning/info）
export const ACTION_TAGS: Record<string, string> = {
  create: 'success', create_user: 'success', update: 'primary',
  delete: 'danger', soft_delete: 'danger', login_fail: 'danger',
  login: 'info', logout: 'info', export: 'warning', import: 'warning',
  change_password: 'warning', assign: 'primary',
};

// ============ 操作日志 - 筛选项 ============
// 对应后端 GET /api/logs 的 module / action 字段（支持 startDate/endDate）
export const LOG_FILTERS = {
  modules: [
    { label: '登录认证', value: 'auth' },
    { label: '用户管理', value: 'user' },
    { label: '系统管理', value: 'system' },
    { label: '操作日志', value: 'operation_log' },
  ],
  actions: [
    { label: '登录', value: 'login' },
    { label: '创建', value: 'create' },
    { label: '更新', value: 'update' },
    { label: '删除', value: 'delete' },
    { label: '创建用户', value: 'create_user' },
  ],
  // 是否显示日期区间筛选（后端 /api/logs 目前忽略日期，默认关闭；接好日期后可打开）
  showDateRange: false,
};

// 日志表格列（结构照搬 qygl：时间/操作人/操作/模块/操作对象/详情/IP）
export const LOG_COLUMNS = [
  { prop: 'createdAt', label: '时间', width: '175' },
  { prop: 'username', label: '操作人', width: '120' },
  { prop: 'action', label: '操作', width: '120' },
  { prop: 'module', label: '模块', width: '120' },
  { prop: 'targetName', label: '操作对象', minWidth: '140' },
  { prop: 'detail', label: '详情', minWidth: '200' },
  { prop: 'ipAddress', label: 'IP', width: '130' },
];

// ============ 天气（登录页左侧，公开 API，失败不影响登录）============
export const WEATHER = {
  enabled: true,
  latitude: 40.8424,   // 默认呼和浩特，改成你的城市
  longitude: 111.7490,
};

// ============ 消息通知中心 - 类型映射 ============
// 后端 notifications.type 存英文枚举，这里映射成图标/颜色/文案。
// 新项目加通知类型：后端插入时换 type 值 + 这里加一条即可。
export const NOTIFICATION_TYPES: Record<string, { label: string; icon: string; color: string }> = {
  system:   { label: '系统',   icon: '⚙', color: '#667eea' },
  backup:   { label: '备份',   icon: '💾', color: '#0f9d76' },
  user:     { label: '用户',   icon: '👤', color: '#7c3aed' },
  security: { label: '安全',   icon: '🔐', color: '#dc2626' },
  approve:  { label: '审批',   icon: '✅', color: '#ea580c' },
};
export const NOTIFICATION_DEFAULT = { label: '通知', icon: '🔔', color: '#909399' };
