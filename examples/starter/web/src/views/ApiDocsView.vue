<template>
  <div class="api-docs">
    <PageHeaderBar title="接口文档">
      <template #actions>
        <el-input v-model="keyword" placeholder="搜索接口路径/说明" size="small" clearable style="width:220px" />
      </template>
    </PageHeaderBar>

    <div class="ad-body">
      <div class="tip-bar">骨架自带接口清单（部分需管理员权限）。真实项目可用 Swagger/apidoc 替换本页；这里保持零依赖、开箱即看。</div>
      <el-collapse v-model="openGroups">
        <el-collapse-item v-for="group in filteredGroups" :key="group.name" :title="`${group.name}（${group.apis.length}）`" :name="group.name">
          <el-table :data="group.apis" size="small" border>
            <el-table-column label="方法" width="90">
              <template #default="{ row }"><el-tag size="small" :type="methodType(row.method)">{{ row.method }}</el-tag></template>
            </el-table-column>
            <el-table-column prop="path" label="路径" width="260">
              <template #default="{ row }"><code>{{ row.path }}</code></template>
            </el-table-column>
            <el-table-column prop="desc" label="说明" min-width="240" />
            <el-table-column label="权限" width="100">
              <template #default="{ row }"><span :class="row.admin ? 'need-admin' : 'ok'">{{ row.admin ? '管理员' : '登录' }}</span></template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import PageHeaderBar from '../components/PageHeaderBar.vue';

interface Api { method: string; path: string; desc: string; admin?: boolean }
const groups: { name: string; apis: Api[] }[] = [
  { name: '认证', apis: [
    { method: 'GET', path: '/api/captcha', desc: '获取图形验证码' },
    { method: 'POST', path: '/api/login', desc: '登录（连续失败 5 次锁定 15 分钟）' },
    { method: 'GET', path: '/api/health', desc: '健康检查' },
    { method: 'GET', path: '/api/ip-check', desc: 'IP 白名单校验（公开）' },
  ]},
  { name: '用户与系统管理', apis: [
    { method: 'GET', path: '/api/users', desc: '用户列表' },
    { method: 'POST', path: '/api/users', desc: '新增用户' },
    { method: 'GET', path: '/api/roles', desc: '角色列表', admin: true },
    { method: 'GET', path: '/api/departments', desc: '部门列表', admin: true },
    { method: 'GET', path: '/api/menus', desc: '菜单列表', admin: true },
    { method: 'POST', path: '/api/backups', desc: '创建数据库备份', admin: true },
    { method: 'GET', path: '/api/backups', desc: '备份列表', admin: true },
  ]},
  { name: '消息中心', apis: [
    { method: 'GET', path: '/api/notifications', desc: '通知列表（专属+广播，按人已读隔离）' },
    { method: 'GET', path: '/api/notifications/unread-count', desc: '未读数' },
    { method: 'POST', path: '/api/notifications/:id/read', desc: '标记单条已读' },
    { method: 'POST', path: '/api/notifications/read-all', desc: '全部已读' },
    { method: 'DELETE', path: '/api/notifications/:id', desc: '删除（广播按人隐藏）' },
  ]},
  { name: '公共组件', apis: [
    { method: 'GET', path: '/api/dict-items', desc: '数据字典列表', admin: true },
    { method: 'POST/PUT/DELETE', path: '/api/dict-items', desc: '字典增删改', admin: true },
    { method: 'GET', path: '/api/configs', desc: '配置列表', admin: true },
    { method: 'PUT', path: '/api/configs/:key', desc: '修改配置', admin: true },
    { method: 'GET', path: '/api/tasks', desc: '定时任务列表', admin: true },
    { method: 'PUT', path: '/api/tasks/:id/toggle', desc: '启停任务', admin: true },
  ]},
  { name: '安全与运维', apis: [
    { method: 'GET', path: '/api/monitor', desc: '系统监控（CPU/内存/磁盘/服务）', admin: true },
    { method: 'GET', path: '/api/security-alerts', desc: '安全告警日志', admin: true },
    { method: 'GET', path: '/api/sessions', desc: '在线会话列表', admin: true },
    { method: 'DELETE', path: '/api/sessions/:id', desc: '强制下线', admin: true },
    { method: 'GET', path: '/api/ip-whitelist', desc: 'IP 白名单', admin: true },
    { method: 'POST', path: '/api/totp/setup', desc: '生成 TOTP 密钥', admin: true },
    { method: 'POST', path: '/api/totp/enable', desc: '启用 TOTP', admin: true },
  ]},
];
const keyword = ref('');
const openGroups = ref<string[]>(['认证']);
const filteredGroups = computed(() => {
  const k = keyword.value.trim().toLowerCase();
  if (!k) return groups;
  return groups.map((g) => ({ ...g, apis: g.apis.filter((a) => (a.path + a.desc + a.method).toLowerCase().includes(k)) })).filter((g) => g.apis.length);
});
function methodType(m: string): any { return m.startsWith('GET') ? 'success' : m.startsWith('DELETE') ? 'danger' : 'primary'; }
</script>

<style scoped>
.api-docs { min-height: 100%; display: flex; flex-direction: column; }
.ad-body { padding: 20px 24px; flex: 1; }
.tip-bar { background: rgba(102,126,234,.06); border: 1px solid rgba(102,126,234,.2); border-radius: 8px; padding: 10px 14px; font-size: 12px; color: var(--primary-color); margin-bottom: 16px; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 2px 6px; border-radius: 4px; }
.need-admin { color: #f56c6c; font-size: 12px; }
.ok { color: #67c23a; font-size: 12px; }
</style>
