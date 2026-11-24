<template>
  <div class="totp-setup">
    <div v-if="status.enabled" class="totp-enabled">
      <div class="totp-state"><span class="dot on"></span> 已启用 TOTP 二次验证</div>
      <p class="hint">登录时需输入身份验证器 App 的 6 位动态码。</p>
      <div class="totp-action">
        <el-input v-model="disableToken" placeholder="输入 6 位动态码以关闭" maxlength="6" style="width:220px" />
        <el-button size="small" @click="close">关闭验证</el-button>
      </div>
    </div>
    <div v-else-if="secret" class="totp-flow">
      <p class="hint">1. 用身份验证器 App（如 Google Authenticator）扫描二维码：</p>
      <div class="qr-box"><img :src="qrDataUrl" alt="TOTP 二维码" /></div>
      <p class="hint">或手动输入密钥：<code>{{ secret }}</code></p>
      <p class="hint">2. 输入 App 生成的 6 位动态码完成启用：</p>
      <div class="totp-action">
        <el-input v-model="enableToken" placeholder="6 位动态码" maxlength="6" style="width:180px" />
        <el-button type="primary" size="small" @click="enable">启用</el-button>
        <el-button size="small" @click="secret = ''">取消</el-button>
      </div>
    </div>
    <div v-else class="totp-start">
      <p class="hint">为账号绑定身份验证器，登录时多一层保护。</p>
      <el-button type="primary" size="small" @click="setup">开始绑定</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import QRCode from 'qrcode';
import { getTotpStatus, setupTotp, enableTotp, disableTotp } from '../services/api';

const status = ref({ enabled: false, enabledAt: null as string | null });
const secret = ref('');
const qrDataUrl = ref('');
const enableToken = ref('');
const disableToken = ref('');

async function load() {
  try { const r = await getTotpStatus(); status.value = r.data || { enabled: false }; } catch {}
}
async function setup() {
  try {
    const r = await setupTotp();
    secret.value = r.data.secret;
    qrDataUrl.value = await QRCode.toDataURL(r.data.otpauth, { width: 180, margin: 1 });
  } catch { ElMessage.error('生成密钥失败'); }
}
async function enable() {
  if (!/^\d{6}$/.test(enableToken.value)) return ElMessage.error('请输入 6 位动态码');
  try { await enableTotp(enableToken.value); ElMessage.success('TOTP 已启用'); secret.value = ''; await load(); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '启用失败'); }
}
async function close() {
  if (!/^\d{6}$/.test(disableToken.value)) return ElMessage.error('请输入 6 位动态码');
  try { await disableTotp(disableToken.value); ElMessage.success('TOTP 已关闭'); disableToken.value = ''; await load(); }
  catch (e: any) { ElMessage.error(e?.response?.data?.message || '关闭失败'); }
}
onMounted(load);
</script>

<style scoped>
.hint { font-size: 12px; color: var(--text-secondary); margin: 6px 0 10px; line-height: 1.6; }
.totp-state { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-color); }
.dot { width: 8px; height: 8px; border-radius: 50%; }
.dot.on { background: #67c23a; box-shadow: 0 0 0 3px rgba(103,194,58,.15); }
.qr-box { display: inline-block; padding: 10px; background: #fff; border: 1px solid var(--border-color); border-radius: 10px; }
.qr-box img { display: block; width: 180px; height: 180px; }
code { background: var(--hover-bg); color: var(--primary-color); padding: 2px 6px; border-radius: 4px; word-break: break-all; }
.totp-action { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
