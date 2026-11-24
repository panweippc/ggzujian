<template>
  <div v-if="modelValue" class="pwd-strength">
    <div class="ps-bar">
      <div class="ps-fill" :class="strength.class" :style="{ width: strength.percent + '%' }"></div>
    </div>
    <div class="ps-head">
      <span class="ps-label" :class="strength.class">强度：{{ strength.label }}</span>
      <span v-if="showRules" class="ps-hint">至少 10 位，含大小写字母、数字、特殊字符</span>
    </div>
    <ul v-if="showRules" class="ps-checks">
      <li :class="checks.lengthOk ? 'ok' : ''">✓ 至少 10 位</li>
      <li :class="checks.lowerOk ? 'ok' : ''">✓ 包含小写字母</li>
      <li :class="checks.upperOk ? 'ok' : ''">✓ 包含大写字母</li>
      <li :class="checks.digitOk ? 'ok' : ''">✓ 包含数字</li>
      <li :class="checks.specialOk ? 'ok' : ''">✓ 包含特殊字符</li>
      <li v-if="username" :class="checks.notUsername ? 'ok' : ''">✓ 不包含用户名</li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  modelValue: string;
  username?: string;
  showRules?: boolean;
}>(), { username: '', showRules: true });

const checks = computed(() => {
  const v = props.modelValue || '';
  const u = props.username || '';
  return {
    lengthOk: v.length >= 10,
    lowerOk: /[a-z]/.test(v),
    upperOk: /[A-Z]/.test(v),
    digitOk: /\d/.test(v),
    specialOk: /[^A-Za-z0-9]/.test(v),
    notUsername: !u || !v.toLowerCase().includes(u.toLowerCase()),
  };
});
const strength = computed(() => {
  const c = checks.value;
  const rules = [c.lengthOk, c.lowerOk, c.upperOk, c.digitOk, c.specialOk];
  const met = rules.filter(Boolean).length;
  if (!props.modelValue) return { percent: 0, class: '', label: '' };
  if (met <= 2) return { percent: 25, class: 'weak', label: '弱' };
  if (met === 3) return { percent: 50, class: 'medium', label: '中' };
  if (met === 4) return { percent: 75, class: 'good', label: '较强' };
  return { percent: 100, class: 'strong', label: '强' };
});
</script>

<style scoped>
.pwd-strength { margin: 4px 0 12px; }
.ps-bar { height: 6px; border-radius: 3px; background: #ebeef5; overflow: hidden; }
.ps-fill { height: 100%; border-radius: 3px; transition: width .3s, background-color .3s; }
.ps-fill.weak { background: #f56c6c; }
.ps-fill.medium { background: #e6a23c; }
.ps-fill.good { background: #409eff; }
.ps-fill.strong { background: #67c23a; }
.ps-head { display: flex; align-items: center; justify-content: space-between; margin-top: 5px; }
.ps-label { font-size: 12px; }
.ps-label.weak { color: #f56c6c; }
.ps-label.medium { color: #e6a23c; }
.ps-label.good { color: #409eff; }
.ps-label.strong { color: #67c23a; }
.ps-hint { font-size: 11px; color: #c0c4cc; }
.ps-checks { list-style: none; padding: 0; margin: 8px 0 0; display: grid; grid-template-columns: 1fr 1fr; gap: 4px 12px; }
.ps-checks li { font-size: 12px; color: #c0c4cc; }
.ps-checks li.ok { color: #67c23a; }
</style>
