<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { usePdfToWord } from '../../composables/usePdfToWord';

const {
  config,
  health,
  errorMessage,
  isLoading,
  isSaving,
  loadConfig,
  saveConfig,
  clearToken,
  checkHealth,
} = usePdfToWord();

const baseUrl = ref('');
const token = ref('');
const tip = ref('');

const usesHttp = computed(() => baseUrl.value.trim().startsWith('http://'));

async function load() {
  await loadConfig();
  baseUrl.value = config.value.baseUrl || '';
}

async function saveAndTest() {
  tip.value = '';
  try {
    await saveConfig(baseUrl.value, token.value || null);
    token.value = '';
    if (!config.value.configured) {
      tip.value = '服务地址已保存，但尚未检测到访问令牌';
      return;
    }
    await checkHealth();
    tip.value = `服务正常 · ${health.value?.engine || '转换引擎已就绪'}`;
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

async function removeToken() {
  tip.value = '';
  try {
    await clearToken();
    tip.value = '服务令牌已清除';
  } catch {
    // 错误信息由 composable 提供给界面。
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="pdf-settings-group">
    <div class="pdf-settings-title">PDF 转 Word 服务</div>
    <div class="pdf-settings-row">
      <label for="pdf-to-word-url">服务地址</label>
      <input
        id="pdf-to-word-url"
        v-model="baseUrl"
        class="pdf-settings-input"
        type="url"
        placeholder="https://example.com"
        autocomplete="off"
      />
    </div>
    <div class="pdf-settings-row">
      <label for="pdf-to-word-token">访问令牌</label>
      <input
        id="pdf-to-word-token"
        v-model="token"
        class="pdf-settings-input"
        type="password"
        placeholder="留空以保留当前令牌"
        autocomplete="new-password"
      />
    </div>
    <p v-if="usesHttp" class="pdf-settings-warning">
      当前使用 HTTP，适合局域网或临时测试；生产环境建议配置 HTTPS。
    </p>
    <p class="pdf-settings-hint">
      地址和令牌仅用于 PDF 转 Word 请求。令牌保存在本机系统凭据存储中，不会写入配置文件。
    </p>
    <div class="pdf-settings-actions">
      <button
        type="button"
        class="about-btn"
        :disabled="isSaving || isLoading"
        @click="saveAndTest"
      >
        {{ isSaving || isLoading ? '处理中…' : '保存并测试' }}
      </button>
      <button
        v-if="config.configured"
        type="button"
        class="text-action-btn"
        :disabled="isSaving || isLoading"
        @click="removeToken"
      >
        清除令牌
      </button>
    </div>
    <p v-if="tip" class="pdf-settings-success" role="status">{{ tip }}</p>
    <p v-if="errorMessage" class="pdf-settings-error" role="alert">{{ errorMessage }}</p>
  </div>
</template>

<style scoped>
.pdf-settings-group {
  margin-top: var(--space-xl);
  padding-top: var(--space-xl);
  border-top: 1px solid var(--border-light);
}

.pdf-settings-title {
  margin-bottom: var(--space-md);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-semibold);
}

.pdf-settings-row {
  display: flex;
  align-items: center;
  gap: var(--space-lg);
  margin-bottom: var(--space-sm);
}

.pdf-settings-row label {
  width: 76px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: var(--text-sm);
}

.pdf-settings-input {
  min-width: 0;
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  outline: none;
  color: var(--text-primary);
  background: var(--bg-secondary);
  font: inherit;
  font-size: var(--text-sm);
}

.pdf-settings-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.pdf-settings-warning,
.pdf-settings-hint,
.pdf-settings-success,
.pdf-settings-error {
  margin: var(--space-sm) 0 0 94px;
  font-size: var(--text-xs);
  line-height: 1.6;
}

.pdf-settings-warning {
  color: var(--warning, #b07816);
}

.pdf-settings-hint {
  color: var(--text-muted);
}

.pdf-settings-actions {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin: var(--space-md) 0 0 94px;
}

.pdf-settings-success {
  color: var(--success, #2e9b68);
}

.pdf-settings-error {
  color: var(--danger, #c44747);
}

@media (max-width: 560px) {
  .pdf-settings-row {
    align-items: stretch;
    flex-direction: column;
    gap: var(--space-xs);
  }

  .pdf-settings-row label,
  .pdf-settings-warning,
  .pdf-settings-hint,
  .pdf-settings-actions,
  .pdf-settings-success,
  .pdf-settings-error {
    margin-left: 0;
  }

  .pdf-settings-row label {
    width: auto;
  }
}
</style>
