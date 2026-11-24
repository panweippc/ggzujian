<template>
  <Transition name="fade">
    <button v-if="visible" class="backtop" title="返回顶部" @click="scrollTop">↑</button>
  </Transition>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
const visible = ref(false);
const target = ref<HTMLElement | null>(null);
function onScroll() {
  const el = target.value;
  visible.value = el ? el.scrollTop > 300 : window.scrollY > 300;
}
function scrollTop() {
  const el = target.value;
  if (el) el.scrollTo({ top: 0, behavior: 'smooth' });
  else window.scrollTo({ top: 0, behavior: 'smooth' });
}
onMounted(() => {
  target.value = document.querySelector('.content');
  (target.value || window).addEventListener('scroll', onScroll);
});
onUnmounted(() => { (target.value || window).removeEventListener('scroll', onScroll); });
</script>

<style scoped>
.backtop {
  position: fixed; right: 28px; bottom: 32px; z-index: 1000;
  width: 42px; height: 42px; border-radius: 50%; border: none;
  background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end));
  color: #fff; font-size: 20px; cursor: pointer; box-shadow: 0 4px 14px rgba(102,126,234,.4);
  transition: transform .2s;
}
.backtop:hover { transform: translateY(-3px); }
.fade-enter-active, .fade-leave-active { transition: opacity .25s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
