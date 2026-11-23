# @panweippc/admin-ui

通用管理后台前端工具与配置化页面组件（Vue3 + Element Plus）。**业务数据/接口/角色/文案全部通过 config 注入**，不写死任何项目信息。

## 安装

```bash
npm install @panweippc/admin-ui --registry=https://npm.pkg.github.com
# 需安装 peer 依赖：vue3 / element-plus / axios / pinia / @element-plus/icons-vue
```

> 本包以 TypeScript/Vue SFC 源码分发，由消费项目的 Vite 编译。若 Vite 默认不编译 node_modules 内的 `.vue`，在 `vite.config` 中把本包加入 `server.fs.allow` 或使用 `vite-plugin-` 相关配置。

## 工具函数（零业务耦合，可单独引入）

```ts
import {
  validatePassword, passwordRuleHint,      // 密码校验 + 常驻提示文案
  startIdleDetector, stopIdleDetector,     // 空闲超时登出（onTimeout 回调注入）
  getLunarFestivals,                       // 农历节日→公历
  createTokenStore, installAuthInterceptors, installFetchToken  // token/401 刷新
} from '@panweippc/admin-ui/utils';

passwordRuleHint(); // "至少10位 + 小写字母 + 大写字母 + 数字 + 特殊字符 + 不含用户名"

startIdleDetector({
  timeout: 30 * 60 * 1000,
  loginPath: '/login',
  onTimeout: () => userStore.logout()   // 业务自己决定清 store / 断 socket
});
```

## 组件

### LoginPanel — 登录页

内置验证码、登录、错误提示骨架。品牌、主色、接口、成功回调全部配置化；qygl 的天气/公告/节日/寄语等增强通过 `#extra` 插槽注入。

```vue
<LoginPanel :config="{
  title: '宏友智慧办公平台',
  subtitle: '科技赋能高效办公',
  logo: '⚡',
  primaryColor: '#1E5AA8',
  onSuccess: (r) => { store.setToken(r.data.token); router.push('/') }
}">
  <template #extra><WeatherWidget /><NoticeMarquee /></template>
</LoginPanel>
```

### AccountDropdown — 顶部账号区

```vue
<AccountDropdown
  :config="{ displayName: user.name, items: [
    { command: 'profile', label: '个人中心', icon: User },
    { command: 'pwd', label: '修改密码', icon: Lock },
    { command: 'logout', label: '退出登录', icon: SwitchButton, divided: true }
  ]}"
  @command="handleAccountCommand"
/>
```

### CrudPanel — 系统管理通用 CRUD 表格

字段、接口、权限位全部配置化。qygl 的"用户/角色/菜单/权限/备份"、wygl 的"用户/角色/菜单/参数/部门"都可用它拼装。

```vue
<CrudPanel :config="{
  columns: [{ prop: 'username', label: '用户名' }, { prop: 'real_name', label: '姓名' }],
  formFields: [{ prop: 'username', label: '用户名' }, { prop: 'password', label: '密码', type: 'password' }],
  list: ({ page, pageSize }) => api.getUsers({ page, pageSize }),
  create: (form) => api.addUser(form),
  update: (id, form) => api.updateUser(id, form),
  remove: (id) => api.deleteUser(id)
}" />
```

### OperationLogPanel — 操作日志

```vue
<OperationLogPanel :config="{
  columns: [{ prop: 'username', label: '操作人' }, { prop: 'action', label: '操作' }, { prop: 'module', label: '模块' }],
  modules: moduleOptionsFromApi,
  actions: actionOptionsFromApi,
  list: (params) => api.getLogs(params)
}" />
```
