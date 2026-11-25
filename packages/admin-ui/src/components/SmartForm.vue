<template>
  <el-form ref="formRef" :model="model" :rules="rules" :label-width="config.labelWidth || '110px'"
           :label-position="config.labelPosition || 'right'" @submit.prevent>
    <template v-for="group in groups" :key="group.title || '_main'">
      <div v-if="group.title" class="ak-sf__group-title">{{ group.title }}</div>
      <el-row :gutter="16">
        <el-col v-for="f in group.fields" :key="f.prop" :span="f.span || 24"
                v-show="isVisible(f)">
          <el-form-item :label="f.label" :prop="f.prop" :required="isRequired(f)">
            <!-- 文本类 -->
            <el-input v-if="!f.type || ['text','textarea','password'].includes(f.type)"
                      v-model="model[f.prop]"
                      :type="f.type === 'textarea' ? 'textarea' : (f.type === 'password' ? 'password' : 'text')"
                      :rows="f.rows || 3" :show-password="f.type === 'password'"
                      :placeholder="f.placeholder" :disabled="isDisabled(f)" clearable />
            <!-- 数字 -->
            <el-input-number v-else-if="f.type === 'number'" v-model="model[f.prop]"
                             :min="f.min" :max="f.max" :step="f.step || 1" :disabled="isDisabled(f)" />
            <!-- 下拉（静态 options 或异步 loader） -->
            <el-select v-else-if="f.type === 'select'" v-model="model[f.prop]"
                       :placeholder="f.placeholder" :disabled="isDisabled(f)" clearable filterable
                       :multiple="!!f.multiple" style="width:100%" @focus="ensureOptions(f)">
              <el-option v-for="o in optionsOf(f)" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <!-- 单选 / 多选 -->
            <el-radio-group v-else-if="f.type === 'radio'" v-model="model[f.prop]" :disabled="isDisabled(f)">
              <el-radio v-for="o in optionsOf(f)" :key="o.value" :value="o.value">{{ o.label }}</el-radio>
            </el-radio-group>
            <el-checkbox-group v-else-if="f.type === 'checkbox'" v-model="model[f.prop]" :disabled="isDisabled(f)">
              <el-checkbox v-for="o in optionsOf(f)" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox>
            </el-checkbox-group>
            <!-- 开关 / 日期 -->
            <el-switch v-else-if="f.type === 'switch'" v-model="model[f.prop]" :disabled="isDisabled(f)" />
            <el-date-picker v-else-if="f.type === 'date' || f.type === 'datetime'"
                            v-model="model[f.prop]" :type="f.type === 'date' ? 'date' : 'datetime'"
                            :value-format="f.valueFormat || (f.type === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss')"
                            :placeholder="f.placeholder" :disabled="isDisabled(f)" style="width:100%" />
            <!-- 字典：给 category 自动加载，复用宿主注入的 dictLoader -->
            <el-select v-else-if="f.type === 'dict'" v-model="model[f.prop]"
                       :placeholder="f.placeholder" :disabled="isDisabled(f)" clearable filterable style="width:100%"
                       @focus="ensureDict(f)">
              <el-option v-for="o in dictOptions[f.category || '']" :key="o.value" :label="o.label" :value="o.value" />
            </el-select>
            <slot v-else :name="'field-' + f.prop" :field="f" :model="model" />
          </el-form-item>
          <div v-if="f.help" class="ak-sf__help">{{ f.help }}</div>
        </el-col>
      </el-row>
    </template>
  </el-form>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted } from 'vue';
import type { FormInstance } from 'element-plus';

export interface FormField {
  prop: string;
  label: string;
  type?: 'text' | 'textarea' | 'password' | 'number' | 'select' | 'radio' | 'checkbox' | 'switch' | 'date' | 'datetime' | 'dict' | 'slot';
  span?: number;
  placeholder?: string;
  help?: string;
  options?: { label: string; value: any }[];
  optionsLoader?: () => Promise<{ label: string; value: any }[]>;
  category?: string;                       // type=dict 时的字典分类
  min?: number; max?: number; step?: number; rows?: number;
  multiple?: boolean;
  valueFormat?: string;
  rules?: any[];                            // element-plus 校验规则
  required?: boolean;
  visibleWhen?: (model: any) => boolean;    // 字段联动：显示条件
  disabledWhen?: (model: any) => boolean;   // 字段联动：禁用条件
}
export interface FormGroup { title?: string; fields: FormField[] }
export interface SmartFormConfig {
  groups: FormGroup[];
  labelWidth?: string;
  labelPosition?: 'left' | 'right' | 'top';
  initialValues?: Record<string, any>;
  /** 字典数据源注入：宿主把 api.batchGetDictItems 之类的函数传进来 */
  dictLoader?: (categories: string[]) => Promise<Record<string, { label: string; value: any }[]>>;
}

const props = defineProps<{ config: SmartFormConfig; modelValue?: Record<string, any> }>();
const emit = defineEmits<{ 'update:modelValue': [v: Record<string, any>] }>();

const formRef = ref<FormInstance>();
const model = reactive<Record<string, any>>({ ...(props.config.initialValues || {}), ...(props.modelValue || {}) });
const groups = computed(() => props.config.groups);
const loadedOptions = reactive<Record<string, { label: string; value: any }[]>>({});
const dictOptions = reactive<Record<string, { label: string; value: any }[]>>({});

const rules = computed(() => {
  const r: Record<string, any[]> = {};
  for (const g of props.config.groups) for (const f of g.fields) {
    if (f.rules) r[f.prop] = f.rules;
    else if (f.required && !r[f.prop]) r[f.prop] = [{ required: true, message: `请填写${f.label}`, trigger: 'blur' }];
  }
  return r;
});

function isRequired(f: FormField) { return !!f.required || (f.rules || []).some((x: any) => x.required); }
function isVisible(f: FormField) { return f.visibleWhen ? f.visibleWhen(model) : true; }
function isDisabled(f: FormField) { return f.disabledWhen ? f.disabledWhen(model) : false; }
function optionsOf(f: FormField) { return f.options || loadedOptions[f.prop] || []; }

async function ensureOptions(f: FormField) {
  if (!f.optionsLoader || loadedOptions[f.prop]) return;
  try { loadedOptions[f.prop] = await f.optionsLoader(); } catch { loadedOptions[f.prop] = []; }
}
async function ensureDict(f: FormField) {
  const cat = f.category || '';
  if (!cat || dictOptions[cat] || !props.config.dictLoader) return;
  try {
    const data = await props.config.dictLoader([cat]);
    dictOptions[cat] = (data[cat] || []).map((x: any) => ({ label: x.label, value: x.value }));
  } catch { dictOptions[cat] = []; }
}

async function preloadDicts() {
  if (!props.config.dictLoader) return;
  const cats = [...new Set(props.config.groups.flatMap((g) => g.fields).filter((f) => f.type === 'dict').map((f) => f.category || ''))].filter(Boolean);
  if (!cats.length) return;
  try {
    const data = await props.config.dictLoader(cats);
    for (const c of cats) dictOptions[c] = (data[c] || []).map((x: any) => ({ label: x.label, value: x.value }));
  } catch { /* ignore */ }
}

async function validate() { return formRef.value?.validate() || Promise.resolve(false); }
function values() { return JSON.parse(JSON.stringify(model)); }
function reset() {
  Object.keys(model).forEach((k) => delete model[k]);
  Object.assign(model, props.config.initialValues || {});
  formRef.value?.clearValidate();
}

watch(() => props.modelValue, (v) => { if (v) Object.assign(model, v); }, { deep: true });
watch(model, (v) => emit('update:modelValue', { ...v }), { deep: true });
onMounted(preloadDicts);

defineExpose({ validate, values, reset, formRef });
</script>

<style scoped>
.ak-sf__group-title { font-weight: 600; color: #303133; margin: 8px 0 14px; padding-left: 8px; border-left: 3px solid #667eea; }
.ak-sf__help { font-size: 12px; color: #909399; margin: -10px 0 8px; }
</style>
