<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useSyncCode } from '../composables/useSyncCode';

const { isLoggedIn } = useAuth();
const { isPairing, pairError, getSyncConfig, generateSyncCode, joinProfile } = useSyncCode();

const syncCode = ref<string | null>(null);
const profileId = ref<string | null>(null);
const joinCode = ref('');
const message = ref('');
const copied = ref(false);

const canJoin = computed(() => joinCode.value.trim().length > 0 && !isPairing.value);

onMounted(async () => {
  try {
    const config = await getSyncConfig();
    syncCode.value = config.sync_code;
    profileId.value = config.profile_id;
  } catch {
    // 首次运行
  }
});

async function handleGenerate() {
  try {
    const code = await generateSyncCode();
    syncCode.value = code;
    const config = await getSyncConfig();
    profileId.value = config.profile_id;
    message.value = '';
  } catch (e) {
    message.value = e instanceof Error ? e.message : '生成失败';
  }
}

async function handleJoin() {
  if (!joinCode.value.trim()) return;
  try {
    await joinProfile(joinCode.value.trim());
    const config = await getSyncConfig();
    syncCode.value = config.sync_code;
    profileId.value = config.profile_id;
    joinCode.value = '';
    message.value = '';
  } catch (e) {
    message.value = e instanceof Error ? e.message : '配对失败';
  }
}

async function handleCopy() {
  if (!syncCode.value) return;
  try {
    await navigator.clipboard.writeText(syncCode.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    // clipboard unavailable
  }
}
</script>

<template>
  <div class="sync-setup">
    <!-- Header -->
    <div class="sync-section">
      <h3>跨设备同步</h3>
      <p class="sync-desc">
        通过同步码将多台设备的任务数据保持同步。在一台设备上生成同步码，在另一台设备上输入即可配对。
      </p>
    </div>

    <!-- Connecting -->
    <div v-if="!isLoggedIn" class="status-bar">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="spin-icon"
      >
        <polyline points="1 4 1 10 7 10" />
        <polyline points="23 20 23 14 17 14" />
        <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
      </svg>
      <span>正在连接同步服务...</span>
    </div>

    <!-- Paired -->
    <div v-else-if="profileId" class="paired-block">
      <div class="status-bar success">
        <span class="status-dot" />
        <span class="status-label">已配对</span>
        <span class="status-sub">跨设备同步已激活</span>
      </div>

      <!-- Sync code card -->
      <div v-if="syncCode" class="code-card">
        <div class="code-label">同步码</div>
        <div class="code-row">
          <code class="code-text">{{ syncCode }}</code>
          <button class="icon-btn" title="复制同步码" @click="handleCopy">
            <svg
              v-if="copied"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--success)"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <svg
              v-else
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          </button>
        </div>
      </div>

      <p class="sync-hint">
        在其他设备上输入此同步码即可共享任务数据。请妥善保管，丢失后无法恢复。
      </p>

      <button class="btn-secondary" @click="handleGenerate">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="1 4 1 10 7 10" />
          <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
        </svg>
        <span>重新生成同步码</span>
      </button>
    </div>

    <!-- Unpaired -->
    <template v-else>
      <div class="action-card">
        <button class="btn-primary btn-block" :disabled="isPairing" @click="handleGenerate">
          <svg
            v-if="!isPairing"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>{{ isPairing ? '生成中...' : '生成同步码' }}</span>
        </button>
      </div>

      <div class="divider">或通过已有同步码加入</div>

      <div class="join-block">
        <label class="field-label" for="join-code">同步码</label>
        <div class="join-row">
          <input
            id="join-code"
            v-model="joinCode"
            type="text"
            class="sync-input"
            placeholder="输入已有的同步码"
            :disabled="isPairing"
            @keyup.enter="handleJoin"
          />
          <button class="btn-secondary" :disabled="!canJoin" @click="handleJoin">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{{ isPairing ? '配对中...' : '配对' }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- Error -->
    <div v-if="message || pairError" class="error-banner">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--danger)" stroke="none">
        <path
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"
        />
      </svg>
      <span>{{ message || pairError }}</span>
    </div>
  </div>
</template>

<style scoped>
/* ── Container ──────────────────────────── */
.sync-setup {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg);
}

/* ── Header ────────────────────────────── */
.sync-section h3 {
  margin: 0 0 4px;
  font-size: var(--text-base);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.sync-desc {
  margin: 0;
  font-size: var(--text-sm);
  color: var(--text-secondary);
  line-height: 1.5;
}

/* ── Status bar ─────────────────────────── */
.status-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  font-size: var(--text-sm);
  color: var(--text-secondary);
}

.status-bar.success {
  background: var(--accent-light);
  color: var(--accent);
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--success);
  box-shadow: 0 0 6px var(--success);
  animation: status-pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

.status-label {
  font-weight: var(--font-weight-semibold);
}

.status-sub {
  margin-left: auto;
  font-size: var(--text-xs);
  color: var(--text-muted);
}

/* ── Paired block ───────────────────────── */
.paired-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* ── Code card ──────────────────────────── */
.code-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
}

.code-label {
  font-size: var(--text-xs);
  color: var(--text-muted);
  margin-bottom: var(--space-xs);
}

.code-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.code-text {
  flex: 1;
  font-family: var(--font-sans);
  font-size: var(--text-xs);
  color: var(--text-secondary);
  letter-spacing: 0.02em;
  word-break: break-all;
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
}

/* ── Hint ───────────────────────────────── */
.sync-hint {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-muted);
  line-height: 1.5;
}

/* ── Action card (generate) ─────────────── */
.action-card {
  display: flex;
  flex-direction: column;
}

/* ── Join block ─────────────────────────── */
.join-block {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.field-label {
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
  padding-left: 2px;
}

.join-row {
  display: flex;
  gap: var(--space-sm);
}

/* ── Input ──────────────────────────────── */
.sync-input {
  flex: 1;
  height: 36px;
  padding: 0 var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  outline: none;
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.sync-input::placeholder {
  color: var(--text-disabled);
}

.sync-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.sync-input:disabled {
  opacity: 0.5;
}

/* ── Divider ────────────────────────────── */
.divider {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-xs);
  color: var(--text-muted);
}

.divider::before,
.divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border-light);
}

/* ── Buttons ────────────────────────────── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-lg);
  border: none;
  border-radius: var(--radius-sm);
  background: var(--accent);
  color: #fff;
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--transition-fast),
    transform var(--transition-fast);
  height: 36px;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:active:not(:disabled) {
  transform: scale(0.97);
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-block {
  width: 100%;
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--text-sm);
  font-weight: var(--font-weight-medium);
  font-family: var(--font-sans);
  cursor: pointer;
  white-space: nowrap;
  transition: all var(--transition-fast);
  height: 36px;
}

.btn-secondary:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
  border-color: var(--accent);
}

.btn-secondary:active:not(:disabled) {
  transform: scale(0.97);
}

.btn-secondary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* ── Icon button ────────────────────────── */
.icon-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition: all var(--transition-fast);
}

.icon-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.icon-btn:active {
  transform: scale(0.94);
}

/* ── Error banner ───────────────────────── */
.error-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--danger-light);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  color: var(--danger);
  line-height: 1.4;
}

.error-banner svg {
  flex-shrink: 0;
  margin-top: 1px;
}

/* ── Spin animation ─────────────────────── */
.spin-icon {
  animation: spin 1.2s linear infinite;
}

/* ── Keyframes ──────────────────────────── */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes status-pulse {
  0%,
  100% {
    box-shadow: 0 0 4px var(--success);
  }
  50% {
    box-shadow: 0 0 10px var(--success);
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot,
  .spin-icon {
    animation: none;
  }
}
</style>
