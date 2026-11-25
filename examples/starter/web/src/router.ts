import { createRouter, createWebHistory } from 'vue-router';
import { useUserStore } from './stores/user';
import LoginView from './views/LoginView.vue';
import MainLayout from './layout/MainLayout.vue';
import HomeView from './views/HomeView.vue';
import SystemManagementView from './views/SystemManagementView.vue';
import OperationLogView from './views/OperationLogView.vue';
import ProfileView from './views/ProfileView.vue';
import ChangePasswordView from './views/ChangePasswordView.vue';
import SecuritySettingsView from './views/SecuritySettingsView.vue';
import SecurityAlertView from './views/SecurityAlertView.vue';
import MessageCenterView from './views/MessageCenterView.vue';
import ComponentsView from './views/ComponentsView.vue';
import OnboardingView from './views/OnboardingView.vue';
import MonitorView from './views/MonitorView.vue';
import ConfigView from './views/ConfigView.vue';
import TaskView from './views/TaskView.vue';
import ApiDocsView from './views/ApiDocsView.vue';
import FileServiceView from './views/FileServiceView.vue';
import MessageChannelView from './views/MessageChannelView.vue';
import BaseDataView from './views/BaseDataView.vue';
import ComponentDocsView from './views/ComponentDocsView.vue';
import WorkflowView from './views/WorkflowView.vue';
import PlatformView from './views/PlatformView.vue';
import AIOpsView from './views/AIOpsView.vue';
import LowCodeView from './views/LowCodeView.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView },
    { path: '/onboarding', name: 'onboarding', component: OnboardingView, meta: { requiresAuth: true, title: '新手引导' } },
    {
      path: '/',
      component: MainLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'home', component: HomeView, meta: { title: '工作台' } },
        { path: 'system', name: 'system', component: SystemManagementView, meta: { title: '系统管理' } },
        { path: 'system/users', redirect: '/system' },
        { path: 'logs', name: 'logs', component: OperationLogView, meta: { title: '操作日志' } },
        { path: 'profile', name: 'profile', component: ProfileView, meta: { title: '个人中心' } },
        { path: 'change-password', name: 'changePassword', component: ChangePasswordView, meta: { title: '修改密码' } },
        { path: 'security', name: 'security', component: SecuritySettingsView, meta: { title: '安全设置' } },
        { path: 'security-alerts', name: 'securityAlerts', component: SecurityAlertView, meta: { title: '安全事件监控' } },
        { path: 'messages', name: 'messages', component: MessageCenterView, meta: { title: '消息中心' } },
        { path: 'components', name: 'components', component: ComponentsView, meta: { title: '公共组件' } },
        { path: 'monitor', name: 'monitor', component: MonitorView, meta: { title: '系统监控' } },
        { path: 'config', name: 'config', component: ConfigView, meta: { title: '配置中心' } },
        { path: 'tasks', name: 'tasks', component: TaskView, meta: { title: '定时任务' } },
        { path: 'api-docs', name: 'apiDocs', component: ApiDocsView, meta: { title: '接口文档' } },
        { path: 'files', name: 'files', component: FileServiceView, meta: { title: '文件服务' } },
        { path: 'message-channels', name: 'messageChannels', component: MessageChannelView, meta: { title: '消息通道' } },
        { path: 'base-data', name: 'baseData', component: BaseDataView, meta: { title: '基础数据' } },
        { path: 'component-docs', name: 'componentDocs', component: ComponentDocsView, meta: { title: '组件与接口文档' } },
        { path: 'workflow', name: 'workflow', component: WorkflowView, meta: { title: '工作流' } },
        { path: 'platform', name: 'platform', component: PlatformView, meta: { title: '平台能力' } },
        { path: 'ai-ops', name: 'aiOps', component: AIOpsView, meta: { title: 'AI 运维' } },
        { path: 'low-code', name: 'lowCode', component: LowCodeView, meta: { title: '低代码搭建' } },
      ]
    }
  ]
});

// 无需菜单权限的路由（个人相关 + 登录引导），避免把用户自己锁在外面
const PUBLIC_AUTH_PATHS = ['/', '/profile', '/change-password', '/onboarding'];

router.beforeEach(async (to, from, next) => {
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) return next('/login');
  if (to.path === '/login' && token) return next('/');
  if (!token) return next();

  // RBAC：按角色菜单权限过滤（admin 全放行，见 userStore.canVisit）
  if (!PUBLIC_AUTH_PATHS.includes(to.path)) {
    const userStore = useUserStore();
    await userStore.loadPermissions();
    if (!userStore.canVisit(to.path)) return next('/');
  }
  next();
});

export default router;
