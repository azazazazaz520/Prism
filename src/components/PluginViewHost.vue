<script setup lang="ts">
import { computed, shallowRef, watch, onBeforeUnmount, type Component } from 'vue';
import {
  getViewRegistrations,
  getActivePageRegistrations,
  type ViewRegistration,
  type ViewLocation,
} from '../plugin-api/views-impl';
import PluginErrorBoundary from './PluginErrorBoundary.vue';

const props = defineProps<{
  location: ViewLocation;
}>();

// 响应式视图列表
const views = computed(() =>
  props.location === 'page' ? getActivePageRegistrations() : getViewRegistrations(props.location),
);

// DomView 容器引用
const domContainers = shallowRef<Map<string, HTMLElement>>(new Map());

function setDomRef(id: string, el: HTMLElement | null) {
  if (el) {
    domContainers.value.set(id, el);
  } else {
    domContainers.value.delete(id);
  }
}

// 监听新注册的 DomView，触发 mount
watch(
  views,
  (newViews) => {
    for (const v of newViews) {
      if (v.domMount) {
        // 需要等 DOM 渲染后才能 mount，用 nextTick
        const container = domContainers.value.get(v.id);
        if (container) {
          v.domMount(container);
        }
      }
    }
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  domContainers.value.clear();
});
</script>

<template>
  <!-- icon-rail 按钮：独立渲染每个组件并绑定点击 -->
  <template v-if="location === 'rail'">
    <button
      v-for="v in views"
      :key="v.id"
      class="rail-btn plugin-rail-btn"
      :data-plugin="v.pluginId"
      :data-tooltip="v.id"
      @click="v.onActivate?.()"
    >
      <PluginErrorBoundary>
        <component :is="v.component as Component" />
      </PluginErrorBoundary>
    </button>
  </template>

  <!-- 页面视图：全屏渲染 -->
  <div v-else-if="location === 'page' && views.length > 0" class="plugin-page-host">
    <template v-for="v in views" :key="v.id">
      <div v-if="v.component" class="plugin-page-view" :data-plugin="v.pluginId">
        <PluginErrorBoundary>
          <component :is="v.component as Component" />
        </PluginErrorBoundary>
      </div>
    </template>
  </div>

  <!-- 其他位置：panel / sidebar / settings -->
  <div v-else-if="views.length > 0" class="plugin-view-host" :data-location="location">
    <template v-for="v in views" :key="v.id">
      <div v-if="v.component" class="plugin-vue-view" :data-plugin="v.pluginId">
        <PluginErrorBoundary>
          <component :is="v.component as Component" />
        </PluginErrorBoundary>
      </div>
      <div
        v-else-if="v.domMount"
        :ref="(el: unknown) => setDomRef(v.id, el as HTMLElement | null)"
        class="plugin-dom-view"
        :data-plugin="v.pluginId"
      ></div>
    </template>
  </div>
</template>

<style>
/* ── 插件 rail 按钮：继承宿主 .rail-btn 样式 ── */
.plugin-rail-btn {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--text-tertiary);
  cursor: pointer;
  position: relative;
  transition: all 0.2s;
}

.plugin-rail-btn:hover {
  background: var(--accent-glow-s);
  color: var(--text-secondary);
}

.plugin-rail-btn svg {
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}

[data-theme='hud'] .plugin-rail-btn {
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
</style>

<style scoped>
.plugin-view-host {
  display: contents;
}

.plugin-vue-view,
.plugin-dom-view {
  /* 插件视图容器由宿主提供边界 */
}

/* ── 插件图标轨按钮 ────────────────────── */
.plugin-rail-btn {
  /* 继承 .rail-btn 样式，额外保证 SVG 不溢出 */
}

.plugin-rail-btn :deep(svg) {
  width: 18px;
  height: 18px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
}

/* ── 插件全屏页面 ──────────────────────── */
.plugin-page-host {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.plugin-page-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}

[data-theme='hud'] .plugin-vue-view,
[data-theme='hud'] .plugin-dom-view,
[data-theme='hud'] .plugin-page-view {
  /* HUD 主题下插件视图继承切角风格 */
}
</style>
