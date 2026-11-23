<template>
  <LoginPanel
    :config="{
      title: BRAND.title, subtitle: BRAND.subtitle, logo: BRAND.logo,
      primaryColor: BRAND.primaryColor,
      getCaptcha, login,
      onSuccess: onSuccess
    }"
  >
    <!-- 业务增强（天气/公告/节日等）放这里：
    <template #extra><WeatherWidget /></template> -->
  </LoginPanel>
</template>

<script setup lang="ts">
import { LoginPanel } from '@panweippc/admin-ui';
import { BRAND } from '../config';
import { login, getCaptcha } from '../api';
import { useRouter } from 'vue-router';

const router = useRouter();
const onSuccess = (r: any) => {
  localStorage.setItem('token', r.data.token);
  router.push('/');
};
</script>
