<template>
  <div class="login-container">
    <!-- 科技背景：网格 + 流光 + 浮动粒子 -->
    <div class="tech-bg">
      <div class="bg-grid"></div>
      <div class="bg-glow-slow"></div>
      <div class="bg-streams">
        <span class="stream stream-1"></span>
        <span class="stream stream-2"></span>
        <span class="stream stream-3"></span>
        <span class="stream stream-4"></span>
      </div>
      <div class="bg-particles"></div>
      <div class="bg-dots">
        <span v-for="(d, i) in bgDots" :key="'dot' + i" :style="d"></span>
      </div>
    </div>

    <!-- 左侧信息面板：问候/天气/节日 + 平台能力导览 -->
    <div class="login-info-panel">
      <div class="info-content">
        <div class="login-greeting">
          <div class="greet-main">
            <p class="greet-text">{{ greetText }}</p>
            <p class="greet-date">{{ todayText }}<span v-if="weather" class="greet-weather"> · {{ weather.text }} {{ weather.temp }}°C</span></p>
            <p v-if="dayTips" class="greet-festival">{{ dayTips }}</p>
            <p v-if="dailyQuote" class="greet-quote">{{ dailyQuote }}</p>
          </div>
          <div v-if="weather" class="greet-icon" v-html="weatherIcon(weather.code)"></div>
        </div>

        <div class="module-guide">
          <h2 class="guide-title">平台能力</h2>
          <div class="guide-grid">
            <div class="guide-item" v-for="m in modules" :key="m.name">
              <div class="guide-ico" :style="{ background: m.bg }" v-html="m.icon"></div>
              <span class="guide-name">{{ m.name }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 忘记密码指引 -->
    <el-dialog v-model="forgotVisible" title="忘记密码" width="460px" align-center append-to-body>
      <div class="forgot-body">
        <p class="forgot-lead">请联系本系统管理员 <b>{{ BRAND.adminContactName }}</b> 进行改密并获取新密码，获取新密码后请第一时间修改并妥善保存。</p>
      </div>
      <template #footer><el-button @click="forgotVisible = false">知道了</el-button></template>
    </el-dialog>

    <!-- 右侧登录表单 -->
    <div class="login-form-wrapper">
      <div class="login-header">
        <div class="logo">
          <span class="logo-text">{{ BRAND.logo }} {{ BRAND.title }}</span>
          <div class="logo-glow"></div>
          <div class="logo-pulse"></div>
        </div>
        <p class="login-subtitle">{{ BRAND.subtitle }}</p>
      </div>

      <el-form :model="loginForm" :rules="loginRules" ref="loginFormRef" class="login-form">
        <el-form-item prop="username">
          <label class="field-label">请输入用户名</label>
          <el-input v-model="loginForm.username" class="input-field"
            :class="{ 'input-active': activeInput === 'username' }"
            @focus="activeInput = 'username'" @blur="activeInput = ''" @keyup.enter="handleEnter" :validate-event="false" />
        </el-form-item>

        <el-form-item prop="password">
          <div class="pwd-label-row">
            <label class="field-label">请输入密码</label>
            <span class="help-link" @click="forgotVisible = true">忘记密码？</span>
          </div>
          <el-input v-model="loginForm.password" type="password" show-password class="input-field"
            :class="{ 'input-active': activeInput === 'password' }"
            @focus="activeInput = 'password'" @blur="activeInput = ''" @keyup.enter="handleEnter" :validate-event="false" />
        </el-form-item>

        <el-form-item prop="captcha">
          <label class="field-label">请输入验证码</label>
          <div class="captcha-container">
            <el-input v-model="loginForm.captcha" class="input-field captcha-input"
              :class="{ 'input-active': activeInput === 'captcha' }"
              @focus="activeInput = 'captcha'" @blur="activeInput = ''" @keyup.enter="handleEnter" :validate-event="false" />
            <div class="captcha-box">
              <img v-if="captchaImage" :src="captchaImage" alt="验证码" class="captcha-img" @click="generateCaptcha" title="点击刷新验证码" />
              <span v-else class="captcha-placeholder" @click="generateCaptcha">点击获取</span>
              <button type="button" class="captcha-refresh" @click="generateCaptcha" title="刷新验证码" aria-label="刷新验证码">
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M20 12a8 8 0 1 1-2.34-5.66" :stroke="BRAND.primaryColor" stroke-width="2" fill="none" stroke-linecap="round"/>
                  <path d="M20 3v4h-4" :stroke="BRAND.primaryColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </el-form-item>

        <el-form-item>
          <el-button type="primary" @click="handleLogin" class="login-btn" :loading="loading">
            <span class="btn-text">登录</span><div class="btn-pulse"></div>
          </el-button>
        </el-form-item>
      </el-form>

      <div class="sys-status" :class="appStatus.cls">
        <span class="status-dot"></span>
        <span class="status-text">{{ appStatus.text }}</span>
      </div>
    </div>

    <div class="bg-decorations">
      <div class="bg-circle bg-circle-1"></div>
      <div class="bg-circle bg-circle-2"></div>
      <div class="bg-line bg-line-1"></div>
      <div class="bg-line bg-line-2"></div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { useUserStore } from '../stores/user';
import { login, getCaptcha, getHealth, getWeather } from '../services/api';
import { getLunarFestivals } from '../utils/lunarFestival';
import { BRAND, LOGIN_MODULES, DAILY_QUOTES, WEATHER } from '../config';

const router = useRouter();
const userStore = useUserStore();
const loginFormRef = ref();
const loading = ref(false);
const activeInput = ref('');
const modules = LOGIN_MODULES;

// ===== 健康状态 =====
const appStatus = ref({ cls: 'unknown', text: '服务状态未知' });
const weather = ref<{ temp: number; code: number; text: string } | null>(null);
const forgotVisible = ref(false);

// ===== 节日提醒（农历算法 + 固定节日 + 二十四节气）=====
const SOLAR_TERMS = ['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
const S_TERM_BASE = [0,21208,42467,63836,85337,107014,128867,150921,173149,195551,218072,240693,263343,285989,308563,331033,353350,375494,397447,419210,440795,462224,483532,504758];
function solarTermDate(y: number, n: number) {
  return new Date((31556925974.7 * (y - 1900) + S_TERM_BASE[n - 1] * 60000) + Date.UTC(1900, 0, 6, 2, 5));
}
const FIXED_FESTIVALS = [
  { m: 1, d: 1, name: '元旦' }, { m: 3, d: 8, name: '妇女节' }, { m: 5, d: 1, name: '劳动节' },
  { m: 6, d: 1, name: '儿童节' }, { m: 9, d: 10, name: '教师节' }, { m: 10, d: 1, name: '国庆节' },
];
const FEST_DAY = 24 * 3600 * 1000;
const festivalTip = computed(() => {
  const now = new Date();
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const y = now.getFullYear();
  const events: any[] = [];
  for (const yy of [y, y + 1]) {
    for (let n = 1; n <= 24; n++) {
      const dt = solarTermDate(yy, n);
      events.push({ date: new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()), label: SOLAR_TERMS[n - 1] });
    }
    for (const f of FIXED_FESTIVALS) events.push({ date: new Date(yy, f.m - 1, f.d), label: f.name });
    for (const f of getLunarFestivals(yy)) {
      const [ly, lm, ld] = f.date.split('-').map(Number);
      events.push({ date: new Date(ly, lm - 1, ld), label: f.name });
    }
  }
  for (const e of events) if (e.date.getTime() === t.getTime()) return `今日 ${e.label}`;
  const future = events.filter((e) => e.date.getTime() > t.getTime()).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (future.length) {
    const d = Math.round((future[0].date.getTime() - t.getTime()) / FEST_DAY);
    return `距离 ${future[0].label} 还有 ${d} 天`;
  }
  return '';
});

const greetText = computed(() => {
  const h = new Date().getHours();
  if (h < 11) return '上午好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});
const dailyQuote = computed(() => {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start.getTime()) / 86400000);
  return DAILY_QUOTES[dayOfYear % DAILY_QUOTES.length] || '';
});
const todayText = (() => {
  const d = new Date();
  const week = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][d.getDay()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${week}`;
})();
const dayTips = computed(() => festivalTip.value);

// ===== 天气图标 =====
function weatherText(code: number) {
  if (code <= 1) return '晴';
  if (code === 2) return '多云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code >= 51 && code <= 67) return '小雨';
  if (code >= 71 && code <= 77) return '雪';
  if (code >= 80 && code <= 82) return '阵雨';
  if (code >= 85 && code <= 86) return '阵雪';
  if (code >= 95) return '雷阵雨';
  return '天气';
}
function weatherIcon(code: number) {
  const sun = `<circle cx="12" cy="12" r="4.5" fill="#F2C063"/>`;
  const cloud = `<path d="M7 17a4 4 0 0 1 .4-8A5 5 0 0 1 17 9a3.5 3.5 0 0 1 0 8H7z" fill="#C9DCEF"/>`;
  const rays = `<g stroke="#F2C063" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></g>`;
  const rain = `<g stroke="#9CC3E8" stroke-width="2" stroke-linecap="round"><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/></g>`;
  let body = cloud;
  if (code <= 1) body = sun + rays;
  else if (code === 2) body = sun + cloud;
  else if (code >= 51 && code <= 67) body = cloud + rain;
  else if (code >= 80 && code <= 86) body = cloud + rain;
  else if (code >= 95) body = cloud + `<path d="M13 16l-3 5h4l-3 5" stroke="#F2C063" stroke-width="2" fill="none"/>`;
  return `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">${body}</svg>`;
}

async function loadHealth() {
  try {
    const json: any = await getHealth();
    const ok = json.status === 'ok';
    appStatus.value = { cls: ok ? 'ok' : 'warn', text: ok ? '系统服务正常' : '服务波动 · 请稍候' };
  } catch { appStatus.value = { cls: 'unknown', text: '服务状态未知' }; }
}
async function loadWeather() {
  if (!WEATHER.enabled) return;
  try {
    const res = await getWeather();
    if (res.success && res.data) {
      weather.value = { temp: res.data.temp, code: res.data.code, text: weatherText(res.data.code) };
    }
  } catch { /* 天气失败不影响登录 */ }
}

// 背景粒子
const bgDots = Array.from({ length: 22 }, (_, i) => {
  const seed = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v); };
  const size = 2 + Math.round(seed(1) * 3);
  return {
    left: (seed(2) * 100).toFixed(2) + '%', top: (seed(3) * 100).toFixed(2) + '%',
    width: size + 'px', height: size + 'px', opacity: (0.18 + seed(6) * 0.4).toFixed(2),
    animationDuration: (22 + seed(4) * 26).toFixed(1) + 's', animationDelay: (-seed(5) * 45).toFixed(1) + 's',
  };
});

// ===== 登录 =====
const loginForm = reactive({ username: '', password: '', captcha: '' });
const captchaToken = ref('');
const captchaImage = ref('');
const generateCaptcha = async () => {
  try {
    const r = await getCaptcha();
    captchaImage.value = r.svg;
    captchaToken.value = r.token;
  } catch { captchaImage.value = ''; captchaToken.value = ''; }
};
const loginRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
  captcha: [{ required: true, message: '请输入验证码', trigger: 'blur' }],
};
function handleEnter(e: KeyboardEvent) {
  if ((e as any).isComposing || e.keyCode === 229 || loading.value) return;
  handleLogin();
}
const handleLogin = async () => {
  if (loading.value) return;
  try {
    const valid = await loginFormRef.value?.validate().catch(() => false);
    if (!valid) return;
    loading.value = true;
    const res = await login({ ...loginForm, captchaToken: captchaToken.value });
    if (res.success && res.data?.token) {
      userStore.setSession(res.data);
      // 首次登录（未看过引导）跳新手引导页
      router.push(localStorage.getItem('onboarding-done') === '1' ? '/' : '/onboarding');
    } else {
      ElMessage.error(res.message || '用户名或密码错误');
      loginForm.captcha = '';
      generateCaptcha();
    }
  } catch (e: any) {
    const data = e?.response?.data;
    // 登录失败锁定提示：显示剩余次数 / 锁定分钟数
    if (data?.locked && data?.retryAfterMin) {
      ElMessage({
        type: 'error',
        message: `账号已锁定，请在 ${data.retryAfterMin} 分钟后重试`,
        duration: 6000,
      });
    } else if (typeof data?.remaining === 'number' && data.remaining > 0 && data.remaining < 5) {
      ElMessage({
        type: 'warning',
        message: `${data.message || '账号或密码错误'}，还可尝试 ${data.remaining} 次，之后将锁定 15 分钟`,
        duration: 5000,
      });
    } else {
      ElMessage.error(data?.message || '登录失败，请重试');
    }
    loginForm.captcha = '';
    generateCaptcha();
  } finally { loading.value = false; }
};

onMounted(() => {
  generateCaptcha();
  loadHealth();
  loadWeather();
  if (localStorage.getItem('token')) router.push('/');
});
</script>

<style scoped src="../assets/login.css"></style>
