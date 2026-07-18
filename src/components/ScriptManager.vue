<script setup lang="ts">
import { onMounted } from 'vue';
import { useScriptRunner } from '../composables/useScriptRunner';

const { scripts, loadScripts, runScript } = useScriptRunner();

onMounted(() => {
  loadScripts();
});

function statusLabel(s: string): string {
  switch (s) {
    case 'running':
      return '执行中…';
    case 'done':
      return '完成';
    case 'error':
      return '失败';
    default:
      return '就绪';
  }
}

function statusClass(s: string): string {
  if (s === 'done') return 'status-on';
  if (s === 'error') return 'status-err';
  if (s === 'running') return 'status-running';
  return 'status-off';
}
</script>

<template>
  <div class="script-manager">
    <div class="sm-header">
      <h3 class="sm-title">脚本</h3>
      <span class="sm-count">{{ scripts.length }} 个</span>
    </div>

    <div v-if="scripts.length === 0" class="sm-empty">
      <div class="sm-empty-icon">
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
      </div>
      <p class="sm-empty-text">
        暂无脚本。将 .js 文件放入 <code>~/.prism/scripts/</code> 后点击重新扫描。
      </p>
      <p class="sm-empty-hint">
        脚本格式：以 <code>// ==PrismScript==</code> 开头，用 <code>// @permission</code> 声明权限
      </p>
    </div>

    <div v-else class="sm-list">
      <div v-for="(s, i) in scripts" :key="s.name" class="sm-card">
        <div class="sm-card-main">
          <div class="sm-card-info">
            <span class="sm-card-name">{{ s.name }}</span>
            <span v-if="s.description" class="sm-card-desc">{{ s.description }}</span>
            <span class="sm-card-perms">{{
              s.permissions.length ? s.permissions.join(', ') : '无权限'
            }}</span>
          </div>
          <div class="sm-card-meta">
            <span :class="['sm-card-status', statusClass(s.status)]">
              {{ statusLabel(s.status) }}
            </span>
            <button class="sm-run-btn" :disabled="s.status === 'running'" @click="runScript(i)">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              运行
            </button>
          </div>
        </div>
        <div v-if="s.lastOutput" class="sm-card-output">{{ s.lastOutput }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.script-manager {
  padding: 16px 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.sm-header {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.sm-title {
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin: 0;
}

.sm-count {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-disabled);
}

.sm-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 32px 16px;
  text-align: center;
}

.sm-empty-icon {
  color: var(--text-disabled);
  opacity: 0.4;
}

.sm-empty-text {
  font-size: 12px;
  color: var(--text-disabled);
  line-height: 1.6;
  margin: 0;
}

.sm-empty-text code,
.sm-empty-hint code {
  font-family: var(--font-mono);
  font-size: 11px;
  background: var(--bg-hover);
  padding: 1px 6px;
  border-radius: var(--radius-sm);
}

.sm-empty-hint {
  font-size: 11px;
  color: var(--text-disabled);
  margin: 0;
}

.sm-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sm-card {
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 12px;
}

[data-theme='hud'] .sm-card {
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

.sm-card-main {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.sm-card-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sm-card-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.sm-card-desc {
  font-size: 11px;
  color: var(--text-secondary);
}

.sm-card-perms {
  font-family: var(--font-mono);
  font-size: 9px;
  color: var(--text-disabled);
}

.sm-card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.sm-card-status {
  font-family: var(--font-heading);
  font-size: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.status-on {
  color: var(--accent);
}
.status-err {
  color: var(--danger);
}
.status-running {
  color: var(--warning);
}
.status-off {
  color: var(--text-disabled);
}

.sm-run-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  font-size: 10px;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.sm-run-btn:hover:not(:disabled) {
  background: var(--accent);
  color: #fff;
}

.sm-run-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

[data-theme='hud'] .sm-run-btn {
  border-radius: 0;
  clip-path: polygon(
    4px 0%,
    100% 0%,
    100% calc(100% - 4px),
    calc(100% - 4px) 100%,
    0% 100%,
    0% 4px
  );
}

.sm-card-output {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--text-secondary);
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}
</style>
