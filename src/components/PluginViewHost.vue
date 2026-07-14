<script setup lang="ts">
import { computed, shallowRef, watch, onBeforeUnmount, type Component } from 'vue';
import {
  getViewRegistrations,
  type ViewRegistration,
  type ViewLocation,
} from '../plugin-api/views-impl';

const props = defineProps<{
  location: ViewLocation;
}>();

// 响应式视图列表
const views = computed(() => getViewRegistrations(props.location));

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
      if (v.domMount && !v.domUnmount) {
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
  <div v-if="views.length > 0" class="plugin-view-host" :data-location="location">
    <template v-for="v in views" :key="v.id">
      <!-- Vue 组件视图 -->
      <div v-if="v.component" class="plugin-vue-view" :data-plugin="v.pluginId">
        <component :is="v.component as Component" />
      </div>
      <!-- Raw DOM 视图 -->
      <div
        v-else-if="v.domMount"
        :ref="(el: unknown) => setDomRef(v.id, el as HTMLElement | null)"
        class="plugin-dom-view"
        :data-plugin="v.pluginId"
      ></div>
    </template>
  </div>
</template>

<style scoped>
.plugin-view-host {
  display: contents;
}

.plugin-vue-view,
.plugin-dom-view {
  /* 插件视图容器由宿主提供边界 */
}

[data-theme='hud'] .plugin-vue-view,
[data-theme='hud'] .plugin-dom-view {
  /* HUD 主题下插件视图继承切角风格 */
}
</style>
