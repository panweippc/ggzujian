<template>
  <div class="cropper-wrap">
    <input ref="fileInput" type="file" accept="image/*" hidden @change="onFile" />
    <div class="cropper-body" v-if="src">
      <div class="cropper-stage">
        <img ref="imgEl" :src="src" @load="initCrop" alt="裁剪预览" />
        <div class="crop-box" :style="boxStyle">
          <span class="crop-corner tl"></span><span class="crop-corner tr"></span>
          <span class="crop-corner bl"></span><span class="crop-corner br"></span>
        </div>
      </div>
      <div class="cropper-controls">
        <label>缩放 <input type="range" min="0.5" max="3" step="0.05" v-model.number="zoom" @input="draw" /></label>
        <label>尺寸 {{ cropSize }}px</label>
        <el-button size="small" type="primary" :loading="uploading" @click="cropAndUpload">裁剪并上传</el-button>
        <el-button size="small" @click="clear">重选</el-button>
      </div>
    </div>
    <div v-else class="cropper-drop" @click="fileInput?.click()" @dragover.prevent @drop.prevent="onDrop">
      <span class="drop-ico">🖼</span>
      <span>点击或拖拽图片到此处</span>
      <span class="drop-tip">支持 JPG / PNG / WEBP，自动裁剪为正方形</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';

/**
 * 图片裁剪上传：原生 canvas 实现（居中正方形裁剪 + 缩放），零第三方依赖。
 * uploadUrl 传入后端上传接口；内部用 fetch 带 token 上传，成功后 emit('uploaded', url)。
 */
const props = withDefaults(defineProps<{ uploadUrl?: string; cropSize?: number; maxSizeMB?: number }>(), {
  uploadUrl: '/api/user/avatar', cropSize: 256, maxSizeMB: 2
});
const emit = defineEmits<{ uploaded: [url: string]; error: [e: Error] }>();

const fileInput = ref<HTMLInputElement>();
const imgEl = ref<HTMLImageElement>();
const src = ref('');
const zoom = ref(1);
const uploading = ref(false);
const boxStyle = computed(() => ({ width: `${props.cropSize}px`, height: `${props.cropSize}px` }));

function pick() { fileInput.value?.click(); }
function onDrop(e: DragEvent) { const f = e.dataTransfer?.files[0]; if (f) loadFile(f); }
function onFile(e: Event) { const f = (e.target as HTMLInputElement).files?.[0]; if (f) loadFile(f); }
function loadFile(file: File) {
  if (!file.type.startsWith('image/')) return ElMessage.error('请选择图片文件');
  if (file.size > props.maxSizeMB * 1024 * 1024) return ElMessage.error(`图片不能超过 ${props.maxSizeMB}MB`);
  const reader = new FileReader();
  reader.onload = () => { src.value = String(reader.result); };
  reader.readAsDataURL(file);
}
function initCrop() { zoom.value = 1; draw(); }
function draw() { /* 缩放仅供预览提示，实际裁剪在 cropAndUpload 中按 zoom 计算 */ }

function cropAndUpload() {
  const img = imgEl.value;
  if (!img) return;
  const size = props.cropSize;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // 取图片中心正方形区域，按 zoom 缩放
  const side = Math.min(img.naturalWidth, img.naturalHeight) / zoom.value;
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  canvas.toBlob(async (blob) => {
    if (!blob) return;
    uploading.value = true;
    try {
      const token = localStorage.getItem('token');
      const fd = new FormData();
      fd.append('file', blob, 'avatar.png');
      const res = await fetch(props.uploadUrl, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd
      });
      const json = await res.json();
      if (json.success) {
        const url = json.data?.avatar || json.data?.url || json.url || '';
        ElMessage.success('上传成功');
        emit('uploaded', url);
      } else {
        throw new Error(json.message || '上传失败');
      }
    } catch (e: any) {
      ElMessage.error(e.message || '上传失败');
      emit('error', e);
    } finally { uploading.value = false; }
  }, 'image/png');
}
function clear() { src.value = ''; if (fileInput.value) fileInput.value.value = ''; }
defineExpose({ pick, clear });
</script>

<style scoped>
.cropper-wrap { width: 100%; }
.cropper-drop {
  border: 2px dashed #dcdfe6; border-radius: 12px; padding: 32px; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; gap: 8px; color: #909399;
  transition: all .2s; font-size: 14px;
}
.cropper-drop:hover { border-color: #667eea; color: #667eea; background: rgba(102,126,234,.04); }
.drop-ico { font-size: 36px; }
.drop-tip { font-size: 12px; color: #c0c4cc; }
.cropper-body { display: flex; flex-direction: column; gap: 16px; align-items: center; }
.cropper-stage { position: relative; max-height: 340px; overflow: hidden; border-radius: 8px; background: #f5f7fa; display: inline-block; }
.cropper-stage img { display: block; max-height: 340px; max-width: 100%; }
.crop-box {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  border: 2px solid #667eea; box-shadow: 0 0 0 9999px rgba(0,0,0,.4); pointer-events: none;
}
.crop-corner { position: absolute; width: 12px; height: 12px; border: 2px solid #fff; }
.crop-corner.tl { top: -2px; left: -2px; border-right: none; border-bottom: none; }
.crop-corner.tr { top: -2px; right: -2px; border-left: none; border-bottom: none; }
.crop-corner.bl { bottom: -2px; left: -2px; border-right: none; border-top: none; }
.crop-corner.br { bottom: -2px; right: -2px; border-left: none; border-top: none; }
.cropper-controls { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; font-size: 13px; color: #5c6675; }
.cropper-controls label { display: inline-flex; align-items: center; gap: 6px; }
</style>
