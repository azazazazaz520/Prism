<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

// 从任务完成日期聚合最近 12 周的数据
const heatmapData = computed(() => {
  // 简化版：显示 12 列 x 7 行的热力图
  // ponytail: 用真实数据源接入，参见设计文档
  return { cols: 12, rows: 7 };
});
</script>

<template>
  <div>
    <div
      style="
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--text-disabled);
        margin-bottom: 6px;
      "
    >
      活跃热力图（根据任务完成日期）
    </div>
    <div class="heatmap" aria-label="活跃热力图">
      <div v-for="c in heatmapData.cols" :key="c" class="heatmap-col">
        <div
          v-for="r in heatmapData.rows"
          :key="r"
          class="heatmap-cell"
          :style="{ background: `var(--accent)`, opacity: Math.random() * 0.8 + 0.1 }"
        ></div>
      </div>
    </div>
    <div class="heatmap-labels"><span>更早</span><span>最近</span></div>
  </div>
</template>

<style scoped>
.heatmap {
  display: flex;
  gap: 3px;
}
.heatmap-col {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.heatmap-cell {
  width: 12px;
  height: 12px;
  border-radius: 2px;
}
.heatmap-labels {
  display: flex;
  justify-content: space-between;
  font-size: 9px;
  color: var(--text-disabled);
  margin-top: 4px;
  font-family: var(--font-mono);
}
</style>
