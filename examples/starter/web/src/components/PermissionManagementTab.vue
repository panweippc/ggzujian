<template>
  <div class="perm-section">
    <div class="sec-head">
      <h3>权限管理</h3>
      <el-select v-model="roleId" placeholder="选择角色" style="width:220px" @change="loadRolePerms">
        <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
      </el-select>
    </div>

    <template v-if="roleId">
      <div class="scope-row">
        <span>数据范围：</span>
        <el-tag :type="currentRole?.dataScope === 'all' ? 'danger' : currentRole?.dataScope === 'dept' ? 'warning' : 'info'">
          {{ scopeLabel(currentRole?.dataScope) }}
        </el-tag>
        <span class="scope-hint">（在「角色管理」编辑角色时设置，控制行级数据隔离）</span>
      </div>

      <el-row :gutter="16">
        <el-col :span="12">
          <div class="perm-card">
            <div class="card-head">
              <span>菜单权限（可见页面）</span>
              <el-button size="small" type="primary" :loading="savingMenu" @click="saveMenuPerms">保存菜单权限</el-button>
            </div>
            <el-tree
              ref="menuTreeRef"
              :data="menuTree"
              show-checkbox
              node-key="id"
              :props="{ label: 'name', children: 'children' }"
              default-expand-all
              :default-checked-keys="checkedMenuIds"
            />
          </div>
        </el-col>
        <el-col :span="12">
          <div class="perm-card">
            <div class="card-head">
              <span>按钮权限（操作级）</span>
              <el-button size="small" type="primary" :loading="savingBtn" @click="saveButtonPerms">保存按钮权限</el-button>
            </div>
            <div class="tip">按菜单分组勾选操作按钮；前端 <code>v-perm</code> 指令据此隐藏按钮。</div>
            <div v-for="g in buttonGroups" :key="g.menuId" class="btn-group">
              <div class="group-name">{{ g.menuName }}</div>
              <el-checkbox-group v-model="buttonSelection[g.menuId]">
                <el-checkbox v-for="b in g.buttons" :key="b.key" :value="b.key">{{ b.label }}</el-checkbox>
              </el-checkbox-group>
            </div>
          </div>
        </el-col>
      </el-row>
    </template>
    <el-empty v-else description="请先选择一个角色" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

const props = defineProps<{ initialRoleId?: number | null }>();
const API = '/api';
const roles = ref<any[]>([]);
const menus = ref<any[]>([]);
const roleId = ref<number | null>(null);
const checkedMenuIds = ref<number[]>([]);
const buttonSelection = reactive<Record<number, string[]>>({});
const savingMenu = ref(false);
const savingBtn = ref(false);
const menuTreeRef = ref();

// 演示按钮清单：新项目按自己的业务操作在此扩展
const BUTTON_DEFS = [
  { menuId: 1, key: 'home:export', label: '导出工作台' },
  { menuId: 3, key: 'log:export', label: '导出日志' },
  { menuId: 4, key: 'system:user:create', label: '新增用户' },
  { menuId: 4, key: 'system:user:delete', label: '删除用户' },
  { menuId: 4, key: 'system:role:create', label: '新增角色' },
  { menuId: 4, key: 'system:role:delete', label: '删除角色' },
  { menuId: 4, key: 'system:menu:create', label: '新增菜单' },
  { menuId: 4, key: 'system:menu:update', label: '编辑菜单' },
  { menuId: 4, key: 'system:menu:delete', label: '删除菜单' },
];
const buttonGroups = computed(() => {
  const grouped: Record<number, string[]> = {};
  BUTTON_DEFS.forEach((b) => { (grouped[b.menuId] ||= []).push(b.key); });
  return Object.entries(grouped).map(([mid, keys]) => ({
    menuId: +mid,
    menuName: menus.value.find((m) => m.id === +mid)?.name || `菜单 ${mid}`,
    buttons: keys.map((k) => ({ key: k, label: BUTTON_DEFS.find((b) => b.key === k)?.label || k }))
  }));
});
const menuTree = computed(() => menus.value.map((m) => ({ ...m, children: [] })));
const currentRole = computed(() => roles.value.find((r) => r.id === roleId.value));
const scopeLabel = (s?: string) => s === 'all' ? '全部数据' : s === 'dept' ? '本部门' : '仅本人';

const fetchApi = async (url: string, options?: RequestInit) => {
  const res = await fetch(API + url, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token') || ''}` },
    ...options
  });
  return res.json();
};
async function loadBase() {
  const [r1, r2] = await Promise.all([fetchApi('/roles'), fetchApi('/menus')]);
  if (r1.success) roles.value = r1.data;
  if (r2.success) menus.value = r2.data;
}
async function loadRolePerms() {
  if (!roleId.value) return;
  const [menuRes, btnRes] = await Promise.all([
    fetchApi(`/roles/${roleId.value}/permissions`),
    fetchApi(`/roles/${roleId.value}/button-permissions`)
  ]);
  checkedMenuIds.value = menuRes.success ? menuRes.data : [];
  Object.keys(buttonSelection).forEach((k) => delete buttonSelection[+k]);
  if (btnRes.success) {
    Object.entries(btnRes.data).forEach(([mid, keys]) => { buttonSelection[+mid] = keys as string[]; });
  }
}
async function saveMenuPerms() {
  if (!roleId.value) return;
  savingMenu.value = true;
  try {
    // el-tree 只拿到半选/全选叶子，这里用 getCheckedKeys(false) 包含父级由后端自己去重
    const ids = menuTreeRef.value?.getCheckedKeys(false) || [];
    const r = await fetchApi(`/roles/${roleId.value}/permissions`, {
      method: 'POST', body: JSON.stringify({ menuIds: ids })
    });
    if (r.success) ElMessage.success('菜单权限已保存'); else ElMessage.error(r.message || '保存失败');
  } finally { savingMenu.value = false; }
}
async function saveButtonPerms() {
  if (!roleId.value) return;
  try {
    const { value } = await ElMessageBox.prompt('按钮权限属高危操作，请输入当前登录密码', '二次验证', {
      inputType: 'password', inputPattern: /\S+/, inputErrorMessage: '密码不能为空'
    });
    savingBtn.value = true;
    const r = await fetchApi(`/roles/${roleId.value}/button-permissions`, {
      method: 'POST', body: JSON.stringify({ permissions: buttonSelection, adminPassword: value })
    });
    if (r.success) ElMessage.success('按钮权限已保存'); else ElMessage.error(r.message || '保存失败');
  } catch {} finally { savingBtn.value = false; }
}
watch(() => props.initialRoleId, (v) => { if (v) roleId.value = v; }, { immediate: true });
onMounted(async () => { await loadBase(); if (roleId.value) await loadRolePerms(); });
defineExpose({ loadRolePerms, loadBase });
</script>

<style scoped>
.perm-section { background: #fff; border: 1px solid #e8ecf4; border-radius: 10px; padding: 16px; }
.sec-head { display: flex; align-items: center; gap: 16px; margin-bottom: 12px; }
.sec-head h3 { margin: 0; font-size: 16px; }
.scope-row { font-size: 13px; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
.scope-hint { color: #909399; font-size: 12px; }
.perm-card { border: 1px solid #eef0f7; border-radius: 8px; padding: 14px; min-height: 360px; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-weight: 600; font-size: 14px; }
.tip { font-size: 12px; color: #909399; margin-bottom: 10px; }
.btn-group { margin-bottom: 12px; }
.group-name { font-size: 13px; font-weight: 600; margin-bottom: 6px; color: #606266; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 2px 5px; border-radius: 4px; }
</style>
