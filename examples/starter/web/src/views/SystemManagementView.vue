<template>
  <div class="sys-mgmt">
    <!-- 页头：照搬 qygl 的标题+副标题+盾牌图标结构 -->
    <div class="page-header">
      <h2 class="section-title">
        <span class="title-icon">
          <svg viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>
          </svg>
        </span>
        {{ systemPage.title }}
      </h2>
      <p class="page-subtitle">{{ systemPage.subtitle }}</p>
    </div>

    <!-- Tab 按钮横排：照搬 qygl -->
    <div class="tabs-section">
      <div class="tab-buttons">
        <button
          v-for="tab in systemTabs"
          :key="tab.name"
          class="tab-btn"
          :class="{ active: activeTab === tab.name }"
          @click="activeTab = tab.name"
        >
          <span class="tab-icon">{{ tab.icon }}</span>{{ tab.label }}
        </button>
      </div>

      <div class="tab-content">
        <!-- 已接真实接口的三块：用户/角色/备份 -->
        <UserManagementTab v-if="activeTab === 'users'" />
        <RoleManagementTab v-else-if="activeTab === 'roles'" />
        <BackupManagementTab v-else-if="activeTab === 'backup'" />
        <!-- 菜单/权限 tab：qygl 接口已迁移，UI 骨架待接 -->
        <el-empty v-else :description="`「${currentTabLabel}」接口已就绪，UI 待接入`">
          <el-tag size="small" type="info" effect="plain">接口已迁移</el-tag>
        </el-empty>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import UserManagementTab from '../components/UserManagementTab.vue';
import RoleManagementTab from '../components/RoleManagementTab.vue';
import BackupManagementTab from '../components/BackupManagementTab.vue';
import { SYSTEM_TABS, SYSTEM_PAGE } from '../config';

const systemTabs = SYSTEM_TABS;
const systemPage = SYSTEM_PAGE;
const activeTab = ref(SYSTEM_TABS[0]?.name || 'roles');
const currentTabLabel = computed(() => systemTabs.find((t) => t.name === activeTab.value)?.label || '');
</script>

<style scoped>
.sys-mgmt { padding: 20px 22px; }

/* 页头 */
.page-header { margin-bottom: 20px; }
.section-title { font-size: 22px; font-weight: 700; color: #1f2d3d; display: flex; align-items: center; gap: 10px; margin: 0 0 8px; }
.title-icon { width: 30px; height: 30px; color: #667eea; display: flex; align-items: center; }
.title-icon svg { width: 100%; height: 100%; }
.page-subtitle { font-size: 13px; color: #909399; margin: 0; }

/* tab 容器 */
.tabs-section { background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 4px rgba(16, 42, 82, .07); }
.tab-buttons { display: flex; border-bottom: 1px solid #e8ecf4; background: #f7f9fc; }
.tab-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 15px 10px; font-size: 14px; font-weight: 500; color: #606266;
  cursor: pointer; border: none; background: none; border-bottom: 2px solid transparent;
  transition: all .25s; font-family: inherit; white-space: nowrap;
}
.tab-btn:hover { color: #667eea; background: rgba(102, 126, 234, .05); }
.tab-btn.active { color: #667eea; border-bottom-color: #667eea; background: #fff; font-weight: 700; }
.tab-icon { font-size: 17px; }
.tab-content { padding: 22px; min-height: 260px; }
</style>
