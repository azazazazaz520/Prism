<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useAuth } from '../composables/useAuth';
import { useSyncCode } from '../composables/useSyncCode';

const { isLoggedIn } = useAuth();
const { isPairing, pairError, getSyncConfig, generateSyncCode, joinProfile } = useSyncCode();

const syncCode = ref<string | null>(null);
const profileId = ref<string | null>(null);
const joinCode = ref('');
const message = ref('');

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
</script>

<template>
  <div class="sync-setup">
    <div class="sync-section">
      <h3>跨设备同步</h3>
      <p class="sync-desc">
        通过同步码将多台设备的任务数据保持同步。在一台设备上生成同步码，在另一台设备上输入即可配对。
      </p>
    </div>

    <div v-if="!isLoggedIn" class="sync-status-box">
      <span class="sync-dot dot-warn"></span>
      <span>正在连接同步服务...</span>
    </div>

    <div v-else-if="profileId" class="sync-status-box">
      <span class="sync-dot dot-ok"></span>
      <span>已配对</span>
      <button class="btn-link" @click="handleGenerate">重新生成</button>
    </div>

    <template v-else>
      <div class="sync-action">
        <button class="btn-primary" :disabled="isPairing" @click="handleGenerate">
          {{ isPairing ? '生成中...' : '生成同步码' }}
        </button>
      </div>

      <div class="sync-divider">或</div>

      <div class="sync-action">
        <input
          v-model="joinCode"
          type="text"
          placeholder="输入同步码"
          class="sync-input"
          :disabled="isPairing"
        />
        <button class="btn-primary" :disabled="isPairing || !joinCode.trim()" @click="handleJoin">
          {{ isPairing ? '配对中...' : '加入' }}
        </button>
      </div>
    </template>

    <div v-if="syncCode" class="sync-code-display">
      <label>你的同步码</label>
      <code>{{ syncCode }}</code>
    </div>

    <p v-if="message || pairError" class="sync-error">{{ message || pairError }}</p>
  </div>
</template>

<style scoped>
.sync-setup {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.sync-section h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.sync-desc {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.sync-status-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--bg-subtle);
  font-size: 13px;
}

.sync-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.dot-ok {
  background: var(--accent);
}

.dot-warn {
  background: var(--text-secondary);
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.4;
  }
  50% {
    opacity: 1;
  }
}

.sync-action {
  display: flex;
  gap: 8px;
}

.sync-input {
  flex: 1;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 13px;
  background: var(--bg);
  color: var(--text);
}

.sync-divider {
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary);
}

.btn-primary {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-link {
  margin-left: auto;
  background: none;
  border: none;
  color: var(--accent);
  font-size: 12px;
  cursor: pointer;
}

.sync-code-display {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.sync-code-display label {
  font-size: 12px;
  color: var(--text-secondary);
}

.sync-code-display code {
  padding: 8px 12px;
  background: var(--bg-subtle);
  border-radius: 6px;
  font-size: 12px;
  word-break: break-all;
  user-select: all;
}

.sync-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger, #e53e3e);
}
</style>
