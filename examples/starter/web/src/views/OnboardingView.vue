<template>
  <div class="onboarding">
    <div class="ob-card">
      <div class="ob-header">
        <span class="ob-logo">{{ BRAND.logo }}</span>
        <h1>欢迎使用 {{ BRAND.title }}</h1>
        <p>{{ BRAND.subtitle }}</p>
      </div>
      <div class="ob-steps">
        <div v-for="(s, i) in steps" :key="i" class="ob-step" :class="{ active: current === i }" @click="current = i">
          <span class="step-ico">{{ s.icon }}</span>
          <div>
            <h3>{{ s.title }}</h3>
            <p>{{ s.desc }}</p>
          </div>
        </div>
      </div>
      <div class="ob-footer">
        <el-button @click="finish">跳过引导</el-button>
        <el-button type="primary" @click="next">{{ current === steps.length - 1 ? '开始使用' : '下一步' }}</el-button>
      </div>
      <div class="ob-dots">
        <span v-for="(s, i) in steps" :key="i" :class="{ active: current === i }" @click="current = i"></span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { BRAND } from '../config';

const router = useRouter();
const current = ref(0);
const steps = [
  { icon: '🔍', title: '全局搜索', desc: '按 Ctrl + K 快速搜索菜单、用户和操作日志。' },
  { icon: '🔔', title: '消息中心', desc: '顶栏铃铛查看通知，未读时标题闪烁并发浏览器通知。' },
  { icon: '🎨', title: '主题与布局', desc: '右上角 🎨 可切换亮色/暗色/紫蓝主题、多标签页。' },
  { icon: '🧩', title: '公共组件', desc: '「公共组件」菜单集中展示 CRUD 表格、字典、富文本等能力。' },
];
function next() { if (current.value < steps.length - 1) current.value++; else finish(); }
function finish() { localStorage.setItem('onboarding-done', '1'); router.push('/'); }
</script>

<style scoped>
.onboarding { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: var(--bg-gradient); padding: 20px; }
.ob-card { width: 100%; max-width: 620px; background: var(--card-bg); border-radius: 18px; padding: 40px; box-shadow: 0 12px 40px rgba(102,126,234,.15); }
.ob-header { text-align: center; margin-bottom: 28px; }
.ob-logo { display: inline-flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 14px; font-size: 28px; color: #fff; background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end)); box-shadow: 0 6px 18px rgba(102,126,234,.35); }
.ob-header h1 { margin: 16px 0 6px; font-size: 22px; color: var(--text-color); }
.ob-header p { margin: 0; color: var(--text-secondary); font-size: 14px; }
.ob-steps { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 28px; }
.ob-step { display: flex; gap: 12px; padding: 16px; border: 2px solid var(--border-color); border-radius: 12px; cursor: pointer; transition: all .2s; }
.ob-step:hover, .ob-step.active { border-color: var(--primary-color); background: rgba(102,126,234,.05); }
.step-ico { font-size: 26px; }
.ob-step h3 { margin: 0 0 4px; font-size: 14px; color: var(--text-color); }
.ob-step p { margin: 0; font-size: 12px; color: var(--text-secondary); line-height: 1.5; }
.ob-footer { display: flex; justify-content: center; gap: 12px; }
.ob-dots { display: flex; justify-content: center; gap: 8px; margin-top: 22px; }
.ob-dots span { width: 8px; height: 8px; border-radius: 50%; background: var(--border-color); cursor: pointer; }
.ob-dots span.active { background: var(--primary-color); width: 20px; border-radius: 4px; }
@media (max-width: 600px) { .ob-steps { grid-template-columns: 1fr; } }
</style>
