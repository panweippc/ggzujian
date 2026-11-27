<script setup lang="ts">
/**
 * 【生成文件】商品 管理页 —— 由 scripts/generate-crud.mjs 生成，可自由修改
 * 需在 router.ts 注册：{ path: 'products', name: 'product', component: ProductViewView, meta: { title: '商品' } }
 * 需在 config.ts 的 SIDE_MENUS / LOGIN_MODULES 同步加菜单项（新增菜单必须同步登录页导览）
 */
import { CrudPanel } from '@panweippc/admin-ui';
import axios from 'axios';

const config = {
  columns: [
    { prop: 'name', label: '商品名称', minWidth: 120 },
    { prop: 'category', label: '分类', minWidth: 120 },
    { prop: 'price', label: '单价', minWidth: 120 },
    { prop: 'stock', label: '库存', minWidth: 120 },
    { prop: 'status', label: '状态', minWidth: 120 },
    { prop: 'remark', label: '备注', minWidth: 120 }
  ],
  formFields: [
    { prop: 'name', label: '商品名称' },
    { prop: 'category', label: '分类', type: 'select', options: [{"label":"电子产品","value":"电子"},{"label":"日用品","value":"日用"}] },
    { prop: 'price', label: '单价', type: 'number' },
    { prop: 'stock', label: '库存', type: 'number' },
    { prop: 'status', label: '状态', type: 'select', options: [{"label":"上架","value":"on"},{"label":"下架","value":"off"}] },
    { prop: 'remark', label: '备注', type: 'textarea' }
  ],
  list: async ({ page, pageSize }: { page: number; pageSize: number }) => {
    const r = await axios.get('/api/products', { params: { page, pageSize } });
    return { data: r.data.data || [], total: r.data.total || 0 };
  },
  create: (form: any) => axios.post('/api/products', form).then(r => r.data),
  update: (id: any, form: any) => axios.put('/api/products/' + id, form).then(r => r.data),
  remove: (id: any) => axios.delete('/api/products/' + id).then(r => r.data),
};
</script>

<template>
  <div class="generated-page">
    <el-page-header title="商品管理" content="增删改查（生成页面）" />
    <CrudPanel :config="config" />
  </div>
</template>

<style scoped>
.generated-page { padding: 16px; }
</style>
