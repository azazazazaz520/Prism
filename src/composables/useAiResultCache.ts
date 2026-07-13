import { ref } from 'vue';

// ── 模块级单例：跨组件实例持久化 AI 结果 ──────

/** AiSummary 今日聚焦分析结果 */
const focusSummary = ref('');
const focusHasLoaded = ref(false);
const focusTooShort = ref(false);

/** AiCommandPanel 命令执行结果 */
const commandResult = ref<any>(null);
const commandError = ref('');

export function useAiResultCache() {
  function saveFocusResult(text: string, tooShort: boolean) {
    focusSummary.value = text;
    focusTooShort.value = tooShort;
    focusHasLoaded.value = true;
  }

  function clearFocusResult() {
    focusSummary.value = '';
    focusHasLoaded.value = false;
    focusTooShort.value = false;
  }

  function saveCommandResult(result: any) {
    commandResult.value = result;
    commandError.value = '';
  }

  function saveCommandError(err: string) {
    commandError.value = err;
    commandResult.value = null;
  }

  function clearCommandResult() {
    commandResult.value = null;
    commandError.value = '';
  }

  return {
    focusSummary,
    focusHasLoaded,
    focusTooShort,
    saveFocusResult,
    clearFocusResult,
    commandResult,
    commandError,
    saveCommandResult,
    saveCommandError,
    clearCommandResult,
  };
}
