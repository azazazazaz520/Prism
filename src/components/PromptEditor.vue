<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';
import { usePromptRepo } from '../composables/usePromptRepo';
import type { PromptMeta } from '../types';

const { prompts, loadAll, getContent, update, reset } = usePromptRepo();

const selected = ref<PromptMeta | null>(null);
const editorContent = ref('');
const isDirty = ref(false);
const saving = ref(false);
const statusMsg = ref('');

function normalizeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

onMounted(() => {
  loadAll();
});

async function selectPrompt(p: PromptMeta) {
  selected.value = p;
  try {
    editorContent.value = await getContent(p.name);
    isDirty.value = false;
    statusMsg.value = '';
  } catch (e) {
    diagnosticsLogger.error('prompt', 'prompt.load_failed', '加载 Prompt 失败', e);
    statusMsg.value = `加载失败: ${normalizeError(e)}`;
  }
}

function onInput() {
  isDirty.value = true;
}

async function save() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await update(selected.value.name, editorContent.value);
    isDirty.value = false;
    statusMsg.value = '已保存 ✓';
  } catch (e) {
    diagnosticsLogger.error('prompt', 'prompt.save_failed', '保存 Prompt 失败', e);
    statusMsg.value = `保存失败: ${normalizeError(e)}`;
  } finally {
    saving.value = false;
  }
}

/** 将变量名渲染为 {{var}} 显示字符串（避免模板中嵌套插值语法冲突） */
function varDisplay(v: string): string {
  return `{{${v}}}`;
}

async function resetPrompt() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await reset(selected.value.name);
    editorContent.value = await getContent(selected.value.name);
    isDirty.value = false;
    statusMsg.value = '已恢复默认 ✓';
  } catch (e) {
    diagnosticsLogger.error('prompt', 'prompt.reset_failed', '重置 Prompt 失败', e);
    statusMsg.value = `重置失败: ${normalizeError(e)}`;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <div class="prompt-editor">
    <div class="prompt-list">
      <h3 class="list-title">Prompt 模板</h3>
      <div
        v-for="p in prompts"
        :key="p.name"
        class="prompt-item"
        :class="{ active: selected?.name === p.name }"
        @click="selectPrompt(p)"
      >
        <div class="prompt-name">{{ p.name }}</div>
        <div class="prompt-meta">
          <span v-if="p.vars.length" class="vars-chip">
            {{ p.vars.join(', ') }}
          </span>
          <span v-if="p.is_customized" class="customized-badge">已自定义</span>
        </div>
      </div>
    </div>

    <div class="prompt-detail" v-if="selected">
      <div class="detail-header">
        <div class="detail-title">{{ selected.name }}</div>
        <div class="detail-actions">
          <button
            class="btn btn-danger-outline"
            @click="resetPrompt"
            :disabled="saving || !selected.is_customized"
          >
            恢复默认
          </button>
          <button class="btn btn-primary" @click="save" :disabled="saving || !isDirty">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </div>
      <div v-if="selected.vars.length" class="vars-hint">
        可用变量:
        <code v-for="v in selected.vars" :key="v" class="var-tag">{{ varDisplay(v) }}</code>
      </div>
      <textarea
        class="editor-area"
        v-model="editorContent"
        @input="onInput"
        spellcheck="false"
      ></textarea>
      <div v-if="statusMsg" class="status-msg">{{ statusMsg }}</div>
    </div>

    <div class="prompt-detail empty" v-else>
      <p class="text-muted">选择一个 Prompt 以编辑</p>
    </div>
  </div>
</template>

<style scoped>
.prompt-editor {
  display: grid;
  grid-template-columns: 240px 1fr;
  flex: 1;
  min-height: 0;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  overflow: hidden;
}

.prompt-list {
  background: var(--bg-secondary, #f8fafc);
  border-right: 1px solid var(--border-color, #e2e8f0);
  overflow-y: auto;
  padding: 12px;
}

.list-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.prompt-item {
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 2px;
  transition: background 0.15s;
}
.prompt-item:hover {
  background: var(--bg-hover, #e2e8f0);
}
.prompt-item.active {
  background: var(--accent-bg, #eef2ff);
}

.prompt-name {
  font-size: 13px;
  font-weight: 500;
  font-family: monospace;
}
.prompt-meta {
  display: flex;
  gap: 4px;
  margin-top: 3px;
  flex-wrap: wrap;
}
.vars-chip {
  font-size: 10px;
  color: var(--text-muted, #94a3b8);
  background: var(--bg-tertiary, #f1f5f9);
  padding: 1px 5px;
  border-radius: 3px;
  font-family: monospace;
}
.customized-badge {
  font-size: 10px;
  color: #d97706;
  background: #fef3c7;
  padding: 1px 5px;
  border-radius: 3px;
}

.prompt-detail {
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
}
.prompt-detail.empty {
  align-items: center;
  justify-content: center;
}
.text-muted {
  color: var(--text-muted, #94a3b8);
  font-size: 14px;
}

.detail-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.detail-title {
  font-size: 15px;
  font-weight: 600;
  font-family: monospace;
}
.detail-actions {
  display: flex;
  gap: 6px;
}

.vars-hint {
  font-size: 12px;
  color: var(--text-secondary, #64748b);
  margin-bottom: 10px;
}
.var-tag {
  background: var(--bg-tertiary, #f1f5f9);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 11px;
  margin-left: 3px;
}

.editor-area {
  flex: 1;
  min-height: 300px;
  font-family: monospace;
  font-size: 13px;
  line-height: 1.6;
  padding: 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  resize: vertical;
  background: var(--bg-primary, #fff);
  color: var(--text-primary, #0f172a);
}

.status-msg {
  margin-top: 8px;
  font-size: 12px;
  color: var(--text-secondary, #64748b);
}

.btn {
  padding: 5px 14px;
  border-radius: var(--radius-sm);
  font-family: var(--font-heading);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all var(--transition-fast);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-primary {
  background: var(--accent);
  color: #fff;
}
.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}
.btn-danger-outline {
  background: transparent;
  color: var(--danger);
  border-color: var(--danger);
}
.btn-danger-outline:hover:not(:disabled) {
  background: var(--danger-light);
}

[data-theme='hud'] .btn {
  border-radius: 0;
  clip-path: polygon(
    5px 0%,
    100% 0%,
    100% calc(100% - 5px),
    calc(100% - 5px) 100%,
    0% 100%,
    0% 5px
  );
}
[data-theme='hud'] .btn-primary {
  color: #0f1118;
}
</style>
