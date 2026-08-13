<script lang="ts">
import {
  defineComponent,
  h,
  ref,
  computed,
  shallowRef,
  watch,
  onBeforeUnmount,
  onMounted,
} from 'vue';
import {
  getViewRegistrations,
  getActivePageRegistrations,
  type ViewLocation,
} from '../../plugin-api/views-impl';
import PluginErrorBoundary from './PluginErrorBoundary.vue';
import type { SandboxIcon } from '../../plugin-api/sandbox-session';

const SandboxFrame = defineComponent({
  props: {
    session: { type: Object, required: true },
    viewId: { type: String, required: true },
  },
  setup(props) {
    const host = ref<HTMLElement | null>(null);
    onMounted(() => {
      if (host.value) (props.session as any).attach(host.value, props.viewId);
    });
    onBeforeUnmount(() => {
      if (host.value) (props.session as any).detach(host.value);
    });
    return () =>
      h('div', {
        ref: host,
        class: 'plugin-sandbox-frame',
        'data-plugin': (props.session as any).pluginId,
        style: {
          flex: '1 1 0',
          minHeight: '0',
          width: '100%',
          display: 'flex',
        },
      });
  },
});

function sandboxRailIcon(icon?: SandboxIcon) {
  return (icon?.nodes ?? []).map((node) => h(node.tag, node.attrs));
}

/**
 * 插件视图宿主组件。
 *
 * 沙箱插件通过 iframe 渲染，宿主只负责挂载沙箱视图；旧版受信插件仍可使用
 * h() 渲染函数作为兼容路径。
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
              'aria-label': v.id,
              onClick: () => v.onActivate?.(),
            },
            [
              v.sandboxSession
                ? h(
                    'svg',
                    {
                      class: 'plugin-sandbox-rail-icon',
                      viewBox: v.icon?.viewBox || '0 0 24 24',
                      width: 18,
                      height: 18,
                      fill: 'none',
                      'aria-hidden': 'true',
                    },
                    sandboxRailIcon(v.icon),
                  )
                : h(PluginErrorBoundary, null, () => (v.component ? h(v.component) : null)),
            ],
          ),
        );
      }

      // ── page ──
      if (loc === 'page' && list.length > 0) {
        const v = list[0];
        const comp = v.component;
        if (v.sandboxSession && v.sandboxViewId) {
          return h('div', { class: 'plugin-page-host' }, [
            h(SandboxFrame, {
              key: `${v.pluginId}:${v.sandboxViewId}`,
              session: v.sandboxSession,
              viewId: v.sandboxViewId,
            }),
          ]);
        }
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
            if (v.sandboxSession && v.sandboxViewId) {
              return h(SandboxFrame, {
                key: v.id,
                session: v.sandboxSession,
                viewId: v.sandboxViewId,
              });
            }
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
  transition:
    background-color var(--motion-duration-hover) var(--motion-ease-standard),
    color var(--motion-duration-hover) var(--motion-ease-standard);
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

.plugin-sandbox-frame {
  flex: 1;
  min-height: 0;
  width: 100%;
  display: flex;
}

.plugin-sandbox-frame iframe {
  flex: 1;
  min-height: 0;
}
</style>
