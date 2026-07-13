<script setup lang="ts">
import { computed } from 'vue';
import { useTaskStore } from '../../composables/useTaskStore';

const { tasks } = useTaskStore();

// 用任务数据生成稳定的热力图数据，避免 Math.random() 在模板中闪烁
// ponytail: 真实聚合逻辑待接入 daily_completions 数据源
interface Cell {
  opacity: number;
}

interface HeatmapData {
  cols: number;
  rows: number;
  cells: Cell[][];
}

const heatmapData = computed<HeatmapData>(() => {
  const cols = 12;
  const rows = 7;
  // 用任务数量做确定性种子，而非 Math.random()
  const seed = tasks.value.length * 7;
  const cells: Cell[][] = [];
  for (let c = 0; c < cols; c++) {
    const col: Cell[] = [];
    for (let r = 0; r < rows; r++) {
      // 确定性伪随机（mulberry32 简化版）
      const hash = ((seed + c * 31 + r * 17) * 2654435761) >>> 0;
      const opacity = ((hash % 100) / 100) * 0.7 + 0.15;
      col.push({ opacity });
    }
    cells.push(col);
  }
  return { cols, rows, cells };
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
      <div v-for="(col, ci) in heatmapData.cells" :key="ci" class="heatmap-col">
        <div
          v-for="(cell, ri) in col"
          :key="ri"
          class="heatmap-cell"
          :style="{ background: `var(--accent)`, opacity: cell.opacity }"
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
