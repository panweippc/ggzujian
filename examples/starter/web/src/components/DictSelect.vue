<template>
  <el-select v-model="inner" :placeholder="placeholder" :clearable="clearable" :disabled="disabled" :style="{ width }" @change="onChange">
    <el-option v-for="item in items" :key="item.value" :label="item.label" :value="valueAsNumber ? Number(item.value) : item.value" />
  </el-select>
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from 'vue';
import { getDictItems } from '../services/api';
import type { DictItem } from '../services/api';

/**
 * 数据字典/枚举选择器：传 category 自动加载字典项。
 * 支持 v-model，值类型可切数字（valueAsNumber）。
 */
const props = withDefaults(defineProps<{
  modelValue?: string | number;
  category: string;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  width?: string;
  valueAsNumber?: boolean;
}>(), {
  modelValue: '', placeholder: '请选择', clearable: true, disabled: false, width: '100%', valueAsNumber: false
});
const emit = defineEmits<{ 'update:modelValue': [v: string | number]; change: [v: string | number] }>();

const inner = ref<string | number>(props.modelValue);
const items = ref<DictItem[]>([]);
watch(() => props.modelValue, (v) => { inner.value = v; });
function onChange(v: string | number) { emit('update:modelValue', v); emit('change', v); }
async function load() {
  try { const r = await getDictItems(props.category); items.value = r.data || []; } catch { items.value = []; }
}
watch(() => props.category, load);
onMounted(load);
defineExpose({ load });
</script>
