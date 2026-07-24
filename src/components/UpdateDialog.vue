<script setup lang="ts">
import { watch, onUnmounted } from 'vue';
import { invokeWithDiagnostics as invoke } from '../diagnostics/invoke-logged';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import type { ReleaseInfo } from '../types';
import { renderMarkdown } from '../composables/useMarkdown';

const props = defineProps<{
  visible: boolean;
  release: ReleaseInfo | null;
}>();

const emit = defineEmits<{
  close: [];
}>();

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault();
    emit('close');
  }
}

watch(
  () => props.visible,
  (v) => {
    if (v) {
      document.addEventListener('keydown', onKeyDown);
    } else {
      document.removeEventListener('keydown', onKeyDown);
    }
  },
);

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown);
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
}

function openDownload(url: string) {
  // 防御性校验：仅允许 http / https 协议
  if (!/^https?:\/\//i.test(url)) {
    diagnosticsLogger.warn('update', 'update.rejected_external_url', '拒绝打开非 http/https URL', {
      url,
    });
    return;
  }
  invoke('open_url', { url });
}

/** 安全渲染 Markdown 发布说明 */
function formatReleaseBody(body: string): string {
  return renderMarkdown(body);
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible && release" class="dialog-overlay" @click.self="emit('close')">
        <div class="dialog-container">
          <div class="dialog-header">
            <h3 class="dialog-title">发现新版本</h3>
          </div>
          <div class="dialog-body">
            <p class="update-version">{{ release.name || release.tag_name }}</p>
            <p class="update-date">{{ formatDate(release.published_at) }}</p>
            <div class="update-body" v-html="formatReleaseBody(release.body)"></div>
          </div>
          <div class="dialog-footer">
            <button class="dialog-btn dialog-btn-cancel" @click="emit('close')">以后再说</button>
            <button
              v-if="release.release_url"
              class="dialog-btn dialog-btn-secondary"
              @click="openDownload(release.release_url!)"
            >
              查看 Release
            </button>
            <button class="dialog-btn dialog-btn-confirm" @click="openDownload(release.html_url)">
              前往下载
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.dialog-container {
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  min-width: 420px;
  max-width: 520px;
  animation: dialog-slide 0.2s ease-out;
}

@keyframes dialog-slide {
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.dialog-header {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--border-subtle);
}

.dialog-title {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: 0;
}

.dialog-body {
  padding: var(--space-lg);
  max-height: 360px;
  overflow-y: auto;
}

.update-version {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--accent);
  margin: 0 0 var(--space-xs) 0;
}

.update-date {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin: 0 0 var(--space-md) 0;
}

.update-body {
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.6;
}

/* Markdown 渲染内容样式 */
.update-body :deep(h2) {
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--text-primary);
  margin: var(--space-md) 0 var(--space-sm);
}
.update-body :deep(ul) {
  padding-left: var(--space-lg);
  margin: 0;
}
.update-body :deep(li) {
  margin-bottom: 2px;
}
.update-body :deep(a) {
  color: var(--accent);
  text-decoration: none;
}
.update-body :deep(a:hover) {
  opacity: 0.8;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-top: 1px solid var(--border-subtle);
}

.dialog-btn {
  padding: var(--space-sm) var(--space-md);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--border-default);
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.dialog-btn:hover {
  background: var(--bg-hover);
}

.dialog-btn-confirm {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}

.dialog-btn-confirm:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

.dialog-btn-secondary {
  background: transparent;
  color: var(--accent);
  border-color: var(--accent);
}

.dialog-btn-secondary:hover {
  background: var(--accent-bg);
}

/* HUD 主题 */
[data-theme='hud'] .dialog-container,
[data-theme='hud'] .dialog-container {
  background: var(--bg-elevated);
  border: 1px solid var(--border-line);
  clip-path: polygon(
    12px 0%,
    100% 0%,
    100% calc(100% - 12px),
    calc(100% - 12px) 100%,
    0% 100%,
    0% 12px
  );
  border-radius: 0;
}

[data-theme='hud'] .dialog-btn,
[data-theme='hud'] .dialog-btn {
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
  background: var(--bg-secondary);
  border-color: var(--border-line);
}

[data-theme='hud'] .dialog-btn-confirm,
[data-theme='hud'] .dialog-btn-confirm {
  background: var(--accent);
  color: #0f1118;
  border-color: var(--accent);
}

[data-theme='hud'] .dialog-btn-confirm:hover,
[data-theme='hud'] .dialog-btn-confirm:hover {
  background: var(--accent-hover);
  box-shadow: 0 0 12px var(--accent-glow);
}

[data-theme='hud'] .dialog-btn-secondary,
[data-theme='hud'] .dialog-btn-secondary {
  background: transparent;
  color: var(--accent-dim);
  border-color: var(--accent-dim);
  clip-path: polygon(
    6px 0%,
    100% 0%,
    100% calc(100% - 6px),
    calc(100% - 6px) 100%,
    0% 100%,
    0% 6px
  );
  border-radius: 0;
}

[data-theme='hud'] .dialog-btn-secondary:hover,
[data-theme='hud'] .dialog-btn-secondary:hover {
  background: var(--accent-glow);
}

/* 过渡动画 */
.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 0.2s;
}
.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
