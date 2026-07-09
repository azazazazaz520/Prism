import { ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import type { PromptMeta } from '../types';

/** Prompt 注册表（共享单例 ref） */
const prompts = ref<PromptMeta[]>([]);

/**
 * PromptRepo — Prompt 模板 CRUD
 *
 * 通过 Tauri 命令与后端的 PromptRegistry + 文件系统交互。
 * 单例模式：prompts 跨组件共享。
 */
export function usePromptRepo() {
  /** 从后端加载所有 Prompt 元数据 */
  async function loadAll() {
    try {
      prompts.value = await invoke<PromptMeta[]>('list_prompts');
    } catch (e) {
      console.error('加载 Prompt 列表失败:', e);
    }
  }

  /** 获取单个 Prompt 的完整内容 */
  async function getContent(name: string): Promise<string> {
    return await invoke<string>('get_prompt', { name });
  }

  /** 更新 Prompt 内容（写入文件） */
  async function update(name: string, content: string): Promise<void> {
    await invoke('update_prompt', { name, content });
    // 刷新元数据以更新 is_customized 状态
    await loadAll();
  }

  /** 重置 Prompt 为默认值（删除用户文件） */
  async function reset(name: string): Promise<void> {
    await invoke('reset_prompt', { name });
    await loadAll();
  }

  return {
    prompts,
    loadAll,
    getContent,
    update,
    reset,
  };
}
