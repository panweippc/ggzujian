/**
 * 全局回收站 —— 单例状态（顶栏按钮 / 抽屉共享）
 * 骨架版：预留 4 个后端接口（list/modules/restore/purge）。
 * 后端未实现时优雅降级为空态，不报错；接好接口后填入 api 调用即可启用。
 * 对应接口约定见 services/api.ts 末尾注释。
 */
import { ref } from 'vue';
import { ElMessage } from 'element-plus';

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

// ★ 后端接口未实现时保持 false；接好后改为 true 并填 services/api.ts 的调用
const API_READY = false;

async function load() {
  if (!API_READY) { list.value = []; total.value = 0; return; }
  loading.value = true;
  try {
    // 接后端时替换为：const res: any = await api.get('/recycle-bin', { params: {...} })
    // list.value = res.data.list; total.value = res.data.total; keepDays.value = res.data.keepDays;
  } catch {
    list.value = []; total.value = 0;
  } finally { loading.value = false; }
}
async function loadModules() {
  if (!API_READY) { modules.value = []; return; }
  // 接后端时替换为：const res: any = await api.get('/recycle-bin/modules'); modules.value = res.data;
}
async function open() {
  visible.value = true; page.value = 1;
  await Promise.all([load(), loadModules()]);
}
function close() { visible.value = false; }
function search() { page.value = 1; return load(); }
function changePage(p: number) { page.value = p; return load(); }
async function restore(_id: number) {
  ElMessage.info('回收站恢复接口待接入');
}
async function purge(_id: number) {
  ElMessage.info('回收站清除接口待接入');
}

export function useRecycleBin() {
  return {
    visible, loading, list, total, page, pageSize, keepDays, keyword, module, modules,
    open, close, load, search, changePage, restore, purge,
  };
}
