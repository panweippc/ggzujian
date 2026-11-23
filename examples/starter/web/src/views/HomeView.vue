<template>
  <div class="layout">
    <header class="topbar">
      <span class="brand">{{ BRAND.logo }} {{ BRAND.title }}</span>
      <AccountDropdown
        :config="{ displayName: '管理员', items: [
          { command: 'profile', label: '个人中心' },
          { command: 'password', label: '修改密码' },
          { command: 'logout', label: '退出登录', divided: true }
        ]}"
        @command="onAccount"
      />
    </header>

    <main class="content">
      <el-tabs v-model="tab">
        <el-tab-pane label="用户管理" name="users">
          <CrudPanel :config="userConfig" />
        </el-tab-pane>
        <el-tab-pane label="操作日志" name="logs">
          <OperationLogPanel :config="logConfig" />
        </el-tab-pane>
      </el-tabs>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { AccountDropdown, CrudPanel, OperationLogPanel } from '@panweippc/admin-ui';
import { BRAND } from '../config';
import { api, getUsers, getLogs } from '../api';

const router = useRouter();
const tab = ref('users');

const onAccount = (cmd: string) => {
  if (cmd === 'logout') {
    localStorage.removeItem('token');
    router.push('/login');
  }
};

// 系统管理：列/字段/接口全是配置，组件本身不用改
const userConfig = {
  columns: [
    { prop: 'username', label: '用户名' },
    { prop: 'role', label: '角色', formatter: (v: string) => v === 'admin' ? '管理员' : v }
  ],
  formFields: [
    { prop: 'username', label: '用户名' },
    { prop: 'password', label: '密码', type: 'password' as const, placeholder: '至少10位含大小写数字符号' }
  ],
  list: getUsers,
  create: (form: any) => api.post('/users', form).then(r => r.data),
  // 下面两个接口示例项目后端未实现，可自行补充
  update: async (id: any, form: any) => { await api.put(`/users/${id}`, form); },
  remove: async (id: any) => { await api.delete(`/users/${id}`); }
};

// 操作日志
const logConfig = {
  columns: [
    { prop: 'username', label: '操作人' },
    { prop: 'action', label: '操作' },
    { prop: 'module', label: '模块' },
    { prop: 'createdAt', label: '时间' }
  ],
  modules: [{ label: '认证', value: 'auth' }, { label: '用户', value: 'user' }],
  list: getLogs
};
</script>

<style scoped>
.layout { min-height: 100vh; background: #f5f7fa; }
.topbar { height: 56px; background: #1E5AA8; color: #fff; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; }
.brand { font-size: 18px; font-weight: bold; }
.content { padding: 24px; max-width: 1100px; margin: 0 auto; background: #fff; min-height: calc(100vh - 56px); }
</style>
