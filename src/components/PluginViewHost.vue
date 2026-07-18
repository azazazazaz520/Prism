<script lang="ts">
import { defineComponent, h, ref, computed, shallowRef, watch, onBeforeUnmount } from 'vue';
import {
  getViewRegistrations,
  getActivePageRegistrations,
  type ViewLocation,
} from '../plugin-api/views-impl';
import PluginErrorBoundary from './PluginErrorBoundary.vue';

/**
 * 插件视图宿主组件。
 *
 * 使用 h() 渲染函数而非 <component :is> 来渲染插件组件。
 * 后者在 Vue 3 生产构建中，对通过 new Function() 创建的组件
 * 可能触发内部 refs 访问异常。
 * h() 直出 VNode 避免了模板编译器对组件对象的代理包装。
 */

export default defineComponent({
  props: {
    location: { type: String as () => ViewLocation, required: true },
  },

  setup(props) {
    const views = computed(() =>
      props.location === 'page'
        ? getActivePageRegistrations()
        : getViewRegistrations(props.location),
    );

    const domContainers = shallowRef<Map<string, HTMLElement>>(new Map());

    function setDomRef(id: string, el: HTMLElement | null) {
      if (el) domContainers.value.set(id, el);
      else domContainers.value.delete(id);
    }

    watch(
      views,
      (newViews) => {
        for (const v of newViews) {
          if (v.domMount) {
            const container = domContainers.value.get(v.id);
            if (container) v.domMount(container);
          }
        }
      },
      { flush: 'post' },
    );

    onBeforeUnmount(() => domContainers.value.clear());

    return () => {
      const list = views.value;
      const loc = props.location;

      // ── rail ──
      if (loc === 'rail') {
        return list.map((v) =>
          h(
            'button',
            {
              key: v.id,
              class: 'rail-btn plugin-rail-btn',
              'data-plugin': v.pluginId,
              'data-tooltip': v.id,
              onClick: () => v.onActivate?.(),
            },
            [h(PluginErrorBoundary, null, () => (v.component ? h(v.component) : null))],
          ),
        );
      }

      // ── page ──
      if (loc === 'page' && list.length > 0) {
        const v = list[0];
        const comp = v.component;
        if (comp) {
          return h('div', { class: 'plugin-page-host' }, [
            h(
              'div',
              {
                key: v.id,
                class: 'plugin-page-view',
                'data-plugin': v.pluginId,
              },
              [h(PluginErrorBoundary, null, () => h(comp))],
            ),
          ]);
        }
      }

      // ── panel / sidebar / settings ──
      if (list.length > 0) {
        return h(
          'div',
          { class: 'plugin-view-host', 'data-location': loc },
          list.map((v) => {
            if (v.component) {
              return h(
                'div',
                {
                  key: v.id,
                  class: 'plugin-vue-view',
                  'data-plugin': v.pluginId,
                },
                [h(PluginErrorBoundary, null, () => h(v.component!))],
              );
            }
            if (v.domMount) {
              return h('div', {
                key: v.id,
                class: 'plugin-dom-view',
                'data-plugin': v.pluginId,
                ref: (el: unknown) => setDomRef(v.id, el as HTMLElement | null),
              });
            }
            return null;
          }),
        );
      }

      return null;
    };
  },
});
</script>

<style>
/* ── 插件 rail 按钮 ── */
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
</style>
