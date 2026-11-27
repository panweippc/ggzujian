<script setup lang="ts">
/**
 * Cron 可视化编辑器 —— 业务人员不用写 cron 表达式
 * 快捷预设 + 5 段字段选择 + 人类可读描述 + 下次执行时间预览（调后端 /api/cron/preview）
 */
import { ref, watch, onMounted } from 'vue';
import axios from 'axios';

const props = defineProps<{ modelValue: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();

const expr = ref(props.modelValue || '0 2 * * *');
const minute = ref('0'), hour = ref('2'), day = ref('*'), month = ref('*'), week = ref('*');
const desc = ref(''); const nextRun = ref(''); const error = ref('');

const PRESETS = [
  { label: '每分钟', cron: '* * * * *' },
  { label: '每 5 分钟', cron: '*/5 * * * *' },
  { label: '每小时整点', cron: '0 * * * *' },
  { label: '每 6 小时', cron: '0 */6 * * *' },
  { label: '每天 02:00', cron: '0 2 * * *' },
  { label: '每天 09:30', cron: '30 9 * * *' },
  { label: '每周一 09:00', cron: '0 9 * * 1' },
  { label: '每月 1 号 00:00', cron: '0 0 1 * *' },
];

function split(v: string) {
  const p = (v || '').trim().split(/\s+/);
  return [p[0] || '0', p[1] || '0', p[2] || '*', p[3] || '*', p[4] || '*'];
}
function compose() {
  expr.value = [minute.value, hour.value, day.value, month.value, week.value].join(' ');
  emit('update:modelValue', expr.value);
  preview();
}
function applyPreset(cron: string) {
  const [mi, h, d, mo, w] = split(cron);
  minute.value = mi; hour.value = h; day.value = d; month.value = mo; week.value = w;
  expr.value = cron;
  emit('update:modelValue', cron);
  preview();
}
async function preview() {
  error.value = '';
  try {
    const r = await axios.post('/api/cron/preview', { cron: expr.value });
    desc.value = r.data.data?.text || '';
    const n = r.data.data?.nextRunAt;
    nextRun.value = n ? new Date(n).toLocaleString('zh-CN') : '请手动确认';
  } catch (e: any) {
    desc.value = '';
    nextRun.value = '';
    error.value = e?.response?.data?.message || '表达式无效';
  }
}
watch(() => props.modelValue, (v) => {
  if (v === expr.value) return;
  const [mi, h, d, mo, w] = split(v);
  minute.value = mi; hour.value = h; day.value = d; month.value = mo; week.value = w;
  expr.value = v; preview();
});
onMounted(() => { const [mi, h, d, mo, w] = split(expr.value); minute.value = mi; hour.value = h; day.value = d; month.value = mo; week.value = w; preview(); });
</script>

<template>
  <div class="cron-editor">
    <div class="ce-presets">
      <el-tag v-for="p in PRESETS" :key="p.cron" size="small" effect="plain" class="ce-tag"
              :type="expr === p.cron ? 'primary' : 'info'" @click="applyPreset(p.cron)">{{ p.label }}</el-tag>
    </div>
    <div class="ce-fields">
      <el-select v-model="minute" size="small" placeholder="分" @change="compose" style="width:84px">
        <el-option v-for="n in 60" :key="n-1" :label="String(n-1).padStart(2,'0')" :value="String(n-1)" />
        <el-option label="每分(*)" value="*" /><el-option label="每5分(*/5)" value="*/5" /><el-option label="每10分(*/10)" value="*/10" />
      </el-select>
      <el-select v-model="hour" size="small" placeholder="时" @change="compose" style="width:84px">
        <el-option v-for="n in 24" :key="n-1" :label="String(n-1).padStart(2,'0')" :value="String(n-1)" />
        <el-option label="每小时(*)" value="*" /><el-option label="每6小时(*/6)" value="*/6" />
      </el-select>
      <el-select v-model="day" size="small" placeholder="日" @change="compose" style="width:84px">
        <el-option label="每天(*)" value="*" /><el-option v-for="n in 31" :key="n" :label="String(n)+'日'" :value="String(n)" />
      </el-select>
      <el-select v-model="month" size="small" placeholder="月" @change="compose" style="width:84px">
        <el-option label="每月(*)" value="*" /><el-option v-for="n in 12" :key="n" :label="String(n)+'月'" :value="String(n)" />
      </el-select>
      <el-select v-model="week" size="small" placeholder="周" @change="compose" style="width:90px">
        <el-option label="每周(*)" value="*" />
        <el-option v-for="(w,i) in ['日','一','二','三','四','五','六']" :key="i" :label="'周'+w" :value="String(i)" />
      </el-select>
      <el-input :model-value="expr" size="small" readonly class="ce-expr" />
    </div>
    <div class="ce-preview">
      <template v-if="error"><span class="ce-err">⚠ {{ error }}</span></template>
      <template v-else-if="desc"><span class="ce-desc">{{ desc }}</span><span v-if="nextRun" class="ce-next">下次：{{ nextRun }}</span></template>
    </div>
  </div>
</template>

<style scoped>
.cron-editor { padding: 4px 0; }
.ce-presets { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.ce-tag { cursor: pointer; user-select: none; }
.ce-fields { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.ce-expr { width: 140px; }
.ce-preview { margin-top: 8px; font-size: 12px; color: #606266; min-height: 18px; }
.ce-desc { color: #409eff; margin-right: 12px; }
.ce-err { color: #f56c6c; }
</style>
