<template>
  <div class="ak-login" :style="cssVars">
    <div class="ak-login__bg" />
    <div class="ak-login__card">
      <!-- 品牌区：业务项目可通过 #brand 插槽自定义 Logo/标题 -->
      <slot name="brand">
        <div class="ak-login__brand">
          <div v-if="config.logo" class="ak-login__logo">{{ config.logo }}</div>
          <h1 class="ak-login__title">{{ config.title }}</h1>
          <p v-if="config.subtitle" class="ak-login__subtitle">{{ config.subtitle }}</p>
        </div>
      </slot>

      <!-- 业务增强插槽（qygl 的天气/公告/节日/寄语等放这里） -->
      <slot name="extra" />

      <el-form class="ak-login__form" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="username" :placeholder="text.usernamePlaceholder" size="large" clearable>
            <template #prefix><span class="ak-login__ico">👤</span></template>
          </el-input>
        </el-form-item>
        <el-form-item>
          <el-input v-model="password" type="password" show-password :placeholder="text.passwordPlaceholder" size="large" clearable>
            <template #prefix><span class="ak-login__ico">🔒</span></template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="config.captcha !== false">
          <div class="ak-login__captcha">
            <el-input v-model="captcha" :placeholder="text.captchaPlaceholder" size="large" />
            <img v-if="captchaImg" :src="captchaImg" class="ak-login__captcha-img" alt="验证码" @click="loadCaptcha" title="点击刷新" />
            <button v-else type="button" class="ak-login__captcha-btn" @click="loadCaptcha">{{ text.refreshCaptcha }}</button>
          </div>
        </el-form-item>
        <el-alert v-if="errorMsg" :title="errorMsg" type="error" :closable="false" show-icon class="ak-login__alert" />
        <el-button type="primary" size="large" class="ak-login__submit" :loading="loading" @click="submit">
          {{ text.submit }}
        </el-button>
      </el-form>

      <slot name="footer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';

/** 登录页配置契约 */
export interface LoginConfig {
  title: string;                    // 品牌标题
  subtitle?: string;                // 副标题
  logo?: string;                    // Logo 文字（图片请用 #brand 插槽）
  primaryColor?: string;            // 主色，默认 #1E5AA8
  captcha?: boolean;                // 是否启用验证码，默认 true
  usernamePlaceholder?: string;
  passwordPlaceholder?: string;
  captchaPlaceholder?: string;
  submitText?: string;
  /** 获取验证码：返回 { token, svg(dataURL) }；默认 GET /api/captcha */
  getCaptcha?: () => Promise<{ token: string; svg: string }>;
  /** 登录：入参 { username, password, captcha, captchaToken }，返回 { success, message, data } */
  login?: (payload: { username: string; password: string; captcha: string; captchaToken: string }) => Promise<{ success: boolean; message?: string; data?: any }>;
  /** 登录成功回调（存 token、跳转等由业务处理） */
  onSuccess?: (result: any) => void;
}

const props = withDefaults(defineProps<{ config: LoginConfig; text?: Partial<LoginText> }>(), { text: () => ({}) });

interface LoginText {
  usernamePlaceholder: string; passwordPlaceholder: string; captchaPlaceholder: string;
  submit: string; refreshCaptcha: string;
}
const text = computed<LoginText>(() => ({
  usernamePlaceholder: '请输入用户名',
  passwordPlaceholder: '请输入密码',
  captchaPlaceholder: '请输入验证码',
  submit: '登 录',
  refreshCaptcha: '点击获取',
  ...props.text
}));

const cssVars = computed(() => ({ '--ak-primary': props.config.primaryColor || '#1E5AA8' }));

const username = ref('');
const password = ref('');
const captcha = ref('');
const captchaToken = ref('');
const captchaImg = ref('');
const errorMsg = ref('');
const loading = ref(false);

const defaultGetCaptcha = async () => {
  const resp = await fetch('/api/captcha');
  const data = await resp.json();
  return { token: data.token, svg: data.svg };
};
const defaultLogin = async (payload: any) => {
  const resp = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  return resp.json();
};

async function loadCaptcha() {
  try {
    const r = await (props.config.getCaptcha || defaultGetCaptcha)();
    captchaImg.value = r.svg;
    captchaToken.value = r.token;
    captcha.value = '';
  } catch { errorMsg.value = '验证码加载失败，请重试'; }
}

async function submit() {
  if (!username.value || !password.value) { errorMsg.value = '请输入用户名和密码'; return; }
  if (props.config.captcha !== false && !captcha.value) { errorMsg.value = '请输入验证码'; return; }
  errorMsg.value = '';
  loading.value = true;
  try {
    const r = await (props.config.login || defaultLogin)({
      username: username.value, password: password.value,
      captcha: captcha.value, captchaToken: captchaToken.value
    });
    if (r.success) {
      if (props.config.onSuccess) props.config.onSuccess(r);
    } else {
      errorMsg.value = r.message || '登录失败';
      ElMessage.error(errorMsg.value);
      if (props.config.captcha !== false) loadCaptcha();
    }
  } catch (e: any) {
    errorMsg.value = e?.message || '网络错误，请重试';
  } finally { loading.value = false; }
}

onMounted(loadCaptcha);
defineExpose({ loadCaptcha });
</script>

<style scoped>
.ak-login { position: relative; min-height: 100vh; display: flex; align-items: center; justify-content: center; font-family: -apple-system, "Microsoft YaHei", sans-serif; }
.ak-login__bg { position: absolute; inset: 0; background: linear-gradient(135deg, var(--ak-primary) 0%, #0d3b7a 100%); }
.ak-login__card { position: relative; z-index: 1; width: 420px; max-width: 92vw; padding: 40px; border-radius: 16px; background: rgba(255,255,255,.97); box-shadow: 0 20px 60px rgba(0,0,0,.3); }
.ak-login__brand { text-align: center; margin-bottom: 24px; }
.ak-login__logo { font-size: 34px; margin-bottom: 8px; }
.ak-login__title { margin: 0; font-size: 24px; color: var(--ak-primary); }
.ak-login__subtitle { margin: 8px 0 0; color: #888; font-size: 13px; }
.ak-login__form :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px #dcdfe6 inset; }
.ak-login__ico { font-size: 15px; }
.ak-login__captcha { display: flex; gap: 10px; width: 100%; }
.ak-login__captcha-img, .ak-login__captcha-btn { height: 40px; min-width: 110px; border: 1px solid #dcdfe6; border-radius: 4px; cursor: pointer; background: #f5f7fa; }
.ak-login__captcha-btn { color: var(--ak-primary); }
.ak-login__alert { margin-bottom: 16px; }
.ak-login__submit { width: 100%; letter-spacing: 4px; }
</style>
