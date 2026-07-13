<script setup lang="ts">
import { usePluginSystem } from '../composables/usePluginSystem';
import { useTaskStore } from '../composables/useTaskStore';
import { invoke } from '@tauri-apps/api/core';
import type { PluginContext } from '../types';

const { enabledPlugins, registerCleanup } = usePluginSystem();
const { tasks, addTask, toggleTask, deleteTask } = useTaskStore();

// ── 处理来自 iframe 的消息 ──────────────────────

function handleMessage(pluginId: string, event: MessageEvent) {
  const { type, id, payload } = event.data || {};
  if (!type) return;

  // 构建 PluginContext（权限校验在此处）
  const ctx: Partial<PluginContext> = {
    getTasks: async () => tasks.value,
    addTask: async (title, dueDate, tags, important, pinned, isDaily) => {
      await addTask(title, dueDate, tags, important, pinned, isDaily);
      return tasks.value.find((t) => t.title === title)!;
    },
    toggleTask: async (taskId: string) => {
      await toggleTask(taskId);
    },
    deleteTask: async (taskId: string) => {
      await deleteTask(taskId);
    },
    aiExecute: async (mode, input) => {
      const result: any = await invoke('ai_execute', { mode, input });
      return result.text || '';
    },
    notify: (title, body) => {
      // ponytail: 用 Notification API，后续可升级为 Tauri 通知
      new Notification(title, { body });
    },
  };

  // ponytail: 简化消息处理，只处理已知类型
  if (type === 'invoke' && ctx[payload.method as keyof typeof ctx]) {
    const method = ctx[payload.method as keyof typeof ctx] as Function;
    Promise.resolve(method(...(payload.args || []))).then((result) => {
      event.source?.postMessage({ id, type: 'result', payload: result }, { targetOrigin: '*' });
    });
  }
}

// ── 外部插件列表（非内建） ──────────────────────

const externalPlugins = () => enabledPlugins().filter((p) => !p.builtin);
</script>

<template>
  <div v-for="plugin in externalPlugins()" :key="plugin.manifest.id" class="plugin-frame">
    <iframe
      :id="`plugin-${plugin.manifest.id}`"
      class="plugin-iframe"
      :src="`/plugins/${plugin.dirName}/widget.html`"
      sandbox="allow-scripts allow-forms"
      :title="plugin.manifest.name"
      @load="
        (e: Event) => {
          const iframe = e.target as HTMLIFrameElement;
          iframe.contentWindow?.postMessage(
            { type: 'init', payload: { pluginId: plugin.manifest.id } },
            '*',
          );
        }
      "
    />
    <!-- 消息转发：iframe → 宿主 -->
    <!-- ponytail: 统一在 window 层监听，按 pluginId 分发 -->
  </div>
</template>

<style scoped>
.plugin-frame {
  display: none;
} /* 隐藏 iframe，插件 Widget 通过 Dashboard 加载 */
.plugin-iframe {
  width: 100%;
  height: 100%;
  border: none;
}
</style>
