<template>
  <div class="rte-wrap">
    <QuillEditor
      v-model:content="inner"
      contentType="html"
      :toolbar="toolbar"
      :placeholder="placeholder"
      :readOnly="disabled"
      theme="snow"
      @update:content="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { QuillEditor } from '@vueup/vue-quill';
import '@vueup/vue-quill/dist/vue-quill.snow.css';
import DOMPurify from 'dompurify';

/** 富文本编辑器：基于 Quill，输出经 DOMPurify 净化的 HTML，防 XSS。 */
const props = withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  minHeight?: string;
}>(), { modelValue: '', placeholder: '请输入内容...', disabled: false, minHeight: '220px' });
const emit = defineEmits<{ 'update:modelValue': [v: string] }>();

const toolbar = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ color: [] }, { background: [] }],
  [{ list: 'ordered' }, { list: 'bullet' }],
  ['blockquote', 'code-block', 'link', 'image'],
  [{ align: [] }],
  ['clean'],
];

const inner = ref(props.modelValue);
watch(() => props.modelValue, (v) => { if (v !== inner.value) inner.value = v; });
function onChange(html: string) {
  const clean = DOMPurify.sanitize(html || '');
  emit('update:modelValue', clean);
}
</script>

<style scoped>
.rte-wrap :deep(.ql-editor) { min-height: v-bind(minHeight); font-size: 14px; }
.rte-wrap :deep(.ql-toolbar.ql-snow) { border-color: #dcdfe6; border-radius: 6px 6px 0 0; }
.rte-wrap :deep(.ql-container.ql-snow) { border-color: #dcdfe6; border-radius: 0 0 6px 6px; font-family: inherit; }
</style>
