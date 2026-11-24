<template>
  <div class="sec-settings">
    <div class="page-header">
      <h2 class="section-title"><span class="title-icon">🔐</span> 安全设置</h2>
      <p class="page-subtitle">集中管理账号安全、登录设备与密码策略</p>
    </div>

    <div class="sec-grid">
      <!-- 账号安全状态 -->
      <div class="sec-card">
        <h3>账号安全状态</h3>
        <div class="status-list">
          <div class="status-item">
            <span class="st-ico ok">✓</span>
            <div><div class="st-title">密码保护</div><div class="st-desc">密码已加密存储（bcrypt）</div></div>
          </div>
          <div class="status-item">
            <span class="st-ico ok">✓</span>
            <div><div class="st-title">登录鉴权</div><div class="st-desc">JWT Token + 会话版本控制</div></div>
          </div>
          <div class="status-item">
            <span class="st-ico ok">✓</span>
            <div><div class="st-title">暴力破解防护</div><div class="st-desc">连续失败 5 次锁定 15 分钟</div></div>
          </div>
          <div class="status-item">
            <span class="st-ico ok">✓</span>
            <div><div class="st-title">空闲自动登出</div><div class="st-desc">30 分钟无操作自动退出</div></div>
          </div>
          <div class="status-item">
            <span class="st-ico ok">✓</span>
            <div><div class="st-title">高危操作二次验证</div><div class="st-desc">删除/恢复等操作需输入登录密码</div></div>
          </div>
        </div>
      </div>

      <!-- 快捷操作 -->
      <div class="sec-card">
        <h3>安全操作</h3>
        <div class="action-list">
          <button class="sec-action" @click="$router.push('/change-password')">
            <span class="sa-ico">🔑</span>
            <div><div class="sa-title">修改密码</div><div class="sa-desc">定期更换密码，建议使用强密码</div></div>
            <span class="sa-arrow">›</span>
          </button>
          <button class="sec-action" @click="$router.push('/profile')">
            <span class="sa-ico">👤</span>
            <div><div class="sa-title">个人中心</div><div class="sa-desc">查看资料与最近登录记录</div></div>
            <span class="sa-arrow">›</span>
          </button>
          <button v-if="isAdmin" class="sec-action" @click="$router.push('/security-alerts')">
            <span class="sa-ico">🛡️</span>
            <div><div class="sa-title">安全事件监控</div><div class="sa-desc">查看登录爆破与高危操作告警</div></div>
            <span class="sa-arrow">›</span>
          </button>
        </div>
      </div>

      <!-- TOTP 二次验证 -->
      <div class="sec-card full">
        <h3>身份验证器（TOTP 二次验证）</h3>
        <TotpSetup />
      </div>

      <!-- 密码强度自测 -->
      <div class="sec-card full">
        <h3>密码强度自测</h3>
        <p class="tip">输入你想使用的密码，实时查看强度（不会保存或发送）</p>
        <el-input v-model="testPwd" type="password" show-password placeholder="输入密码测试强度" style="max-width: 420px" />
        <PasswordStrength v-model="testPwd" :username="username" />
      </div>

      <!-- 会话管理 / IP 白名单（管理员） -->
      <div v-if="isAdmin" class="sec-card full">
        <h3>会话与访问控制</h3>
        <SecurityAdmin />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import PasswordStrength from '../components/PasswordStrength.vue';
import TotpSetup from '../components/TotpSetup.vue';
import SecurityAdmin from '../components/SecurityAdmin.vue';

const testPwd = ref('');
const username = computed(() => localStorage.getItem('username') || '');
const isAdmin = computed(() => {
  const role = (localStorage.getItem('role') || '').toLowerCase();
  return role === 'admin' || localStorage.getItem('username') === 'admin';
});
</script>

<style scoped>
.sec-settings { padding: 20px 22px; }
.page-header { margin-bottom: 18px; }
.section-title { font-size: 22px; font-weight: 700; color: #1f2d3d; margin: 0 0 8px; display: flex; align-items: center; gap: 10px; }
.title-icon { color: #667eea; }
.page-subtitle { font-size: 13px; color: #909399; margin: 0; }
.sec-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.sec-card { background: #fff; border-radius: 12px; padding: 20px 22px; box-shadow: 0 1px 4px rgba(16,42,82,.07); }
.sec-card.full { grid-column: 1 / -1; }
.sec-card h3 { margin: 0 0 16px; font-size: 15px; color: #1f2d3d; }
.tip { font-size: 12px; color: #909399; margin: -8px 0 12px; }
.status-list { display: flex; flex-direction: column; gap: 14px; }
.status-item { display: flex; gap: 12px; align-items: flex-start; }
.st-ico { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 13px; }
.st-ico.ok { background: rgba(103,194,58,.12); color: #67c23a; }
.st-title { font-size: 13px; color: #2c3542; font-weight: 600; }
.st-desc { font-size: 12px; color: #909399; margin-top: 2px; }
.action-list { display: flex; flex-direction: column; gap: 10px; }
.sec-action { display: flex; align-items: center; gap: 12px; width: 100%; padding: 12px 14px; background: #f7f8fc; border: 1px solid #eef0f7; border-radius: 10px; cursor: pointer; text-align: left; font-family: inherit; transition: all .2s; }
.sec-action:hover { border-color: rgba(102,126,234,.4); background: rgba(102,126,234,.05); }
.sa-ico { font-size: 20px; }
.sa-title { font-size: 13px; font-weight: 600; color: #2c3542; }
.sa-desc { font-size: 11px; color: #909399; margin-top: 2px; }
.sa-arrow { margin-left: auto; font-size: 20px; color: #c0c4cc; }
</style>
