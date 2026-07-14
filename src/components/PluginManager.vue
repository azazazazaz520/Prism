<script setup lang="ts">
import { onMounted } from 'vue';
import { usePluginLoader } from '../composables/usePluginLoader';

const { loadPlugins, entries, togglePlugin } = usePluginLoader();

onMounted(() => {
  loadPlugins();
});

function statusLabel(state: string): string {
  switch (state) {
    case 'active':
      return '运行中';
    case 'activating':
      return '激活中…';
    case 'deactivating':
      return '停用中…';
    default:
      return '已停用';
  }
}

function statusClass(state: string): string {
  return state === 'active' || state === 'activating' ? 'status-on' : 'status-off';
}
</script>

<template>
  <div class="plugin-manager">
    <div class="pm-header">
      <h3 class="pm-title">已安装插件</h3>
      <span class="pm-count">{{ entries.length }} 个</span>
    </div>

    <div v-if="entries.length === 0" class="pm-empty">
      <div class="pm-empty-icon">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      </div>
      <p class="pm-empty-text">
        暂无安装的插件。将插件文件夹放入
        <code>~/.prism/plugins/</code>
        后点击重新扫描。
      </p>
    </div>

    <div v-else class="pm-list">
      <div
        v-for="entry in entries"
        :key="entry.manifest.id"
        class="pm-card"
        :class="{ 'pm-card-error': entry.diagnostics.status === 'error' }"
      >
        <div class="pm-card-main">
          <div class="pm-card-info">
            <span class="pm-card-name">{{ entry.manifest.name }}</span>
            <span class="pm-card-version">v{{ entry.manifest.version }}</span>
            <span class="pm-card-author">{{ entry.manifest.author }}</span>
          </div>
          <div class="pm-card-meta">
            <span :class="['pm-card-status', statusClass(entry.state)]">
              {{ statusLabel(entry.state) }}
            </span>
            <label class="pm-toggle">
              <input
                type="checkbox"
                :checked="entry.enabled"
                @change="togglePlugin(entry.manifest.id)"
              />
              <span class="pm-toggle-track"></span>
            </label>
          </div>
        </div>
        <p v-if="entry.manifest.description" class="pm-card-desc">
          {{ entry.manifest.description }}
        </p>
        <div
          v-if="entry.diagnostics.status === 'error' && entry.diagnostics.lastError"
          class="pm-card-error-msg"
        >
          {{ entry.diagnostics.lastError }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.plugin-manager {
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.pm-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pm-title {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0;
}

.pm-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-disabled);
}

.pm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 16px;
  text-align: center;
}

.pm-empty-icon {
  color: var(--text-disabled);
  opacity: 0.4;
}

.pm-empty-text {
  font-size: 12px;
  color: var(--text-disabled);
  line-height: 1.6;
  margin: 0;
}

.pm-empty-text code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.pm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pm-card {
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

[data-theme='hud'] .pm-card {
  border-radius: 0;
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
}

.pm-card-error {
  border-color: var(--danger);
}

.pm-card-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.pm-card-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.pm-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.pm-card-version {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-disabled);
}

.pm-card-author {
  font-size: 10px;
  color: var(--text-tertiary, var(--text-muted));
}

.pm-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.pm-card-status {
  font-family: var(--font-heading);
  font-size: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.status-on {
  color: var(--accent);
}

.status-off {
  color: var(--text-disabled);
}

.pm-toggle {
  position: relative;
  display: inline-block;
  width: 32px;
  height: 18px;
  cursor: pointer;
}

.pm-toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.pm-toggle-track {
  position: absolute;
  inset: 0;
  background: var(--gray-200);
  border-radius: 9px;
  transition: background var(--transition-fast);
}

.pm-toggle-track::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  background: white;
  border-radius: 50%;
  transition: transform var(--transition-fast);
}

.pm-toggle input:checked + .pm-toggle-track {
  background: var(--accent);
}

.pm-toggle input:checked + .pm-toggle-track::after {
  transform: translateX(14px);
}

.pm-card-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin: 6px 0 0;
  line-height: 1.5;
}

.pm-card-error-msg {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--danger);
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--danger-light);
  border-radius: var(--radius-sm);
}
</style>
