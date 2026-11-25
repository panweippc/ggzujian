/**
 * 全局回收站 —— 单例状态（顶栏按钮 / 抽屉共享）
 * 已接入后端 4 个接口（list/modules/restore/purge），见 services/api.ts。
 * 保留天数由后端 KEEP_DAYS 配置，过期项由后端每小时自动清除。
 */
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  getRecycleBin, getRecycleModules, restoreRecycleItem, purgeRecycleItem,
} from '../services/api';

export interface RecycleItem {
  id: number;
  record_id: number;
  module: string;
  module_label: string;
  title: string;
  deleted_by: string;
  deleted_at: string;
  expire_at: string;
}

const visible = ref(false);
const loading = ref(false);
const list = ref<RecycleItem[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const keepDays = ref(30);
const keyword = ref('');
const module = ref('');
const modules = ref<{ key: string; label: string }[]>([]);

async function load() {
  loading.value = true;
  try {
    const res: any = await getRecycleBin({
      page: page.value, pageSize: pageSize.value,
      keyword: keyword.value || undefined, module: module.value || undefined,
    });
    list.value = res.data?.list || [];
    total.value = res.total || 0;
    if (res.data?.keepDays) keepDays.value = res.data.keepDays;
  } catch {
    list.value = []; total.value = 0;
  } finally { loading.value = false; }
}
async function loadModules() {
  try {
    const res: any = await getRecycleModules();
    modules.value = res.data || [];
  } catch { modules.value = []; }
}
async function open() {
  visible.value = true; page.value = 1;
  await Promise.all([load(), loadModules()]);
}
function close() { visible.value = false; }
function search() { page.value = 1; return load(); }
function changePage(p: number) { page.value = p; return load(); }
async function restore(id: number) {
  try {
    await restoreRecycleItem(id);
    ElMessage.success('已恢复');
    await load();
  } catch { ElMessage.error('恢复失败'); }
}
async function purge(id: number) {
  try {
    await purgeRecycleItem(id);
    ElMessage.success('已彻底清除');
    await load();
  } catch { ElMessage.error('清除失败'); }
}

export function useRecycleBin() {
  return {
    visible, loading, list, total, page, pageSize, keepDays, keyword, module, modules,
    open, close, load, search, changePage, restore, purge,
  };
}
