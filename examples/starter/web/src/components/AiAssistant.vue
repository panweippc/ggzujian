<template>
  <div class="ai-assistant">
    <Transition name="pop">
      <div v-if="open" class="ai-panel">
        <div class="ai-head">
          <span class="ai-avatar">🤖</span>
          <div>
            <h3>智能助手</h3>
            <p>有问题随时问我</p>
          </div>
          <button class="ai-close" @click="open = false">✕</button>
        </div>
        <div class="ai-messages" ref="msgBox">
          <div v-for="(m, i) in messages" :key="i" class="ai-msg" :class="m.role">
            <div class="msg-bubble">{{ m.content }}</div>
          </div>
          <div v-if="thinking" class="ai-msg assistant"><div class="msg-bubble typing">思考中<span>···</span></div></div>
        </div>
        <div class="ai-quick">
          <button v-for="q in quickQuestions" :key="q" @click="send(q)">{{ q }}</button>
        </div>
        <div class="ai-input">
          <el-input v-model="input" placeholder="输入问题，回车发送..." @keyup.enter="send()" size="small" />
          <el-button type="primary" size="small" @click="send()" :loading="thinking">发送</el-button>
        </div>
      </div>
    </Transition>
    <button class="ai-fab" :class="{ open }" @click="open = !open" :title="open ? '收起助手' : '智能助手'">
      <span v-if="!open">🤖</span><span v-else>✕</span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue';

/**
 * AI 助手悬浮球（骨架演示版，零后端依赖）。
 * 默认用本地规则回复；真实项目把 askAI() 换成后端 /api/ai/chat 即可。
 */
interface Msg { role: 'user' | 'assistant'; content: string }
const open = ref(false);
const input = ref('');
const thinking = ref(false);
const msgBox = ref<HTMLElement>();
const messages = ref<Msg[]>([
  { role: 'assistant', content: '你好！我是系统智能助手，可以帮你快速了解这个骨架的功能。' }
]);
const quickQuestions = ['有哪些公共组件？', '如何切换主题？', '怎么新增菜单？'];

function scrollBottom() { nextTick(() => { if (msgBox.value) msgBox.value.scrollTop = msgBox.value.scrollHeight; }); }

async function send(preset?: string) {
  const text = (preset || input.value).trim();
  if (!text || thinking.value) return;
  messages.value.push({ role: 'user', content: text });
  input.value = '';
  thinking.value = true;
  scrollBottom();
  const answer = await askAI(text);
  setTimeout(() => {
    messages.value.push({ role: 'assistant', content: answer });
    thinking.value = false;
    scrollBottom();
  }, 400);
}

// 骨架演示：本地规则回复。真实项目替换为 fetch('/api/ai/chat', ...) 即可。
async function askAI(q: string): Promise<string> {
  if (/组件|功能/.test(q)) return '骨架自带：消息中心、全局搜索、回收站、数据字典、富文本、图片裁剪、Excel 导入导出、主题切换、多标签页、系统监控等，可在「公共组件」菜单查看。';
  if (/主题|颜色|暗/.test(q)) return '点击右上角 🎨 按钮，在「布局与主题设置」抽屉里切换亮色/暗色/紫蓝主题，设置会自动保存。';
  if (/菜单|新增|扩展/.test(q)) return '编辑 src/config.ts 的 SIDE_MENUS 加菜单项，在 router.ts 加对应路由和页面组件即可。所有品牌/菜单配置都在这两个文件。';
  if (/登录|密码|账号/.test(q)) return '默认账号 admin / Admin@2026pass。修改密码在右上角账号下拉菜单中。';
  return '这是骨架的演示助手。接入真实 AI：把 src/components/AiAssistant.vue 里的 askAI() 换成调用后端 /api/ai/chat 即可。';
}
</script>

<style scoped>
.ai-assistant { position: fixed; right: 24px; bottom: 24px; z-index: 1500; }
.ai-fab {
  width: 54px; height: 54px; border-radius: 50%; border: none; margin-left: auto; display: flex;
  align-items: center; justify-content: center; font-size: 26px; cursor: pointer; color: #fff;
  background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end));
  box-shadow: 0 6px 20px rgba(102,126,234,.45); transition: transform .2s;
}
.ai-fab:hover { transform: scale(1.08); }
.ai-panel {
  width: 360px; height: 480px; background: var(--card-bg); border-radius: 16px; margin-bottom: 12px;
  box-shadow: 0 12px 40px rgba(0,0,0,.18); display: flex; flex-direction: column; overflow: hidden;
  border: 1px solid var(--border-color);
}
.ai-head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end)); color: #fff; }
.ai-avatar { font-size: 26px; }
.ai-head h3 { margin: 0; font-size: 15px; }
.ai-head p { margin: 2px 0 0; font-size: 11px; opacity: .85; }
.ai-close { margin-left: auto; background: none; border: none; color: #fff; cursor: pointer; font-size: 14px; }
.ai-messages { flex: 1; overflow-y: auto; padding: 14px; background: var(--hover-bg); }
.ai-msg { display: flex; margin-bottom: 12px; }
.ai-msg.user { justify-content: flex-end; }
.msg-bubble { max-width: 80%; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.5; background: var(--card-bg); color: var(--text-color); }
.ai-msg.user .msg-bubble { background: linear-gradient(135deg, var(--primary-gradient-start), var(--primary-gradient-end)); color: #fff; border-bottom-right-radius: 3px; }
.ai-msg.assistant .msg-bubble { border-bottom-left-radius: 3px; }
.typing span { animation: blink 1s infinite; }
@keyframes blink { 50% { opacity: .3; } }
.ai-quick { display: flex; gap: 6px; padding: 8px 12px; flex-wrap: wrap; }
.ai-quick button { font-size: 11px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--card-bg); color: var(--primary-color); cursor: pointer; font-family: inherit; }
.ai-quick button:hover { background: rgba(102,126,234,.08); }
.ai-input { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid var(--border-color); }
.pop-enter-active, .pop-leave-active { transition: all .25s; transform-origin: bottom right; }
.pop-enter-from, .pop-leave-to { opacity: 0; transform: scale(.9) translateY(10px); }
@media (max-width: 600px) { .ai-panel { width: 300px; height: 420px; } }
</style>
