<template>
  <div class="change-password-page">
    <div class="page-card">
      <h2>修改密码</h2>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" style="max-width: 420px; margin-top: 20px;">
        <el-form-item label="旧密码" prop="oldPassword">
          <el-input v-model="form.oldPassword" type="password" show-password placeholder="请输入旧密码" />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="form.newPassword" type="password" show-password placeholder="至少10位，含大小写字母、数字和特殊字符" />
          <template #error></template>
        </el-form-item>
        <PasswordStrength v-model="form.newPassword" :username="username" />
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="form.confirmPassword" type="password" show-password placeholder="请再次输入新密码" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="submitting" @click="submit">确认修改</el-button>
          <el-button @click="$router.push('/')">返回</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import PasswordStrength from '../components/PasswordStrength.vue'

const router = useRouter()
const formRef = ref<any>(null)
const submitting = ref(false)
const form = reactive({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})
const rules = {
  oldPassword: [{ required: true, message: '请输入旧密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 10, message: '密码长度不能少于10位', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (!value) return callback()
        if (!/[a-z]/.test(value)) return callback(new Error('密码必须包含小写字母'))
        if (!/[A-Z]/.test(value)) return callback(new Error('密码必须包含大写字母'))
        if (!/\d/.test(value)) return callback(new Error('密码必须包含数字'))
        if (!/[^A-Za-z0-9]/.test(value)) return callback(new Error('密码必须包含特殊字符'))
        callback()
      },
      trigger: 'blur'
    }
  ],
  confirmPassword: [
    { required: true, message: '请确认新密码', trigger: 'blur' },
    {
      validator: (_rule: any, value: string, callback: any) => {
        if (value !== form.newPassword) callback(new Error('两次输入的密码不一致'))
        else callback()
      },
      trigger: 'blur'
    }
  ]
}

// 当前用户名（密码强度组件用于校验"不含用户名"）
const username = computed(() => localStorage.getItem('username') || '')

const submit = async () => {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  submitting.value = true
  try {
    const username = localStorage.getItem('username') || ''
    const token = localStorage.getItem('token') || ''
    const res = await fetch('/api/user/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username, oldPassword: form.oldPassword, newPassword: form.newPassword })
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('密码修改成功，请重新登录')
      localStorage.clear()
      router.push('/login')
    } else {
      ElMessage.error(json.message || '修改失败')
    }
  } catch {
    ElMessage.error('修改密码失败')
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.change-password-page {
  padding: 40px;
  display: flex;
  justify-content: center;
}
.page-card {
  background: #fff;
  border-radius: 12px;
  padding: 40px;
  width: 100%;
  max-width: 520px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.08);
}
.page-card h2 {
  margin: 0 0 8px 0;
  color: #333;
}
</style>
