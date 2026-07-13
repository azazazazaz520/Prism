<style scoped>
.dashboard {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
}

.widget-grid {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) var(--space-lg) var(--space-xs);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-sm);
  align-content: start;
}

/* ── Widget 卡片 ─────────────────────────────── */

.widget {
  background: var(--bg-panel, var(--bg-secondary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: border-color var(--transition-fast);
}
.widget:hover {
  border-color: var(--border-default);
}
[data-theme='hud'] .widget {
  border-radius: 0;
  border-color: var(--border-line);
  clip-path: polygon(
    8px 0%,
    100% 0%,
    100% calc(100% - 8px),
    calc(100% - 8px) 100%,
    0% 100%,
    0% 8px
  );
}
[data-theme='hud'] .widget:hover {
  border-color: var(--accent-dim);
}

.widget.span-2 {
  grid-column: 1 / -1;
}

/* ── Widget 头部 ─────────────────────────────── */

.widget-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-subtle);
  cursor: grab;
  user-select: none;
}
.widget-header:active {
  cursor: grabbing;
}

.w-drag {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted);
  opacity: 0.35;
}
.w-drag svg {
  width: 10px;
  height: 10px;
  stroke: currentColor;
  fill: currentColor;
  stroke-width: 0;
}

.w-title {
  flex: 1;
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-semibold);
  letter-spacing: 2px;
  text-transform: uppercase;
  color: var(--accent-dim, var(--text-muted));
}

.w-close {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}
.w-close:hover {
  color: var(--danger);
  background: var(--danger-light);
}

/* ── Widget 内容 ─────────────────────────────── */

.widget-body {
  padding: var(--space-md);
}

/* ── 添加 Widget 区域 ────────────────────────── */

.add-widget-area {
  padding: var(--space-xs) var(--space-lg) var(--space-sm);
  flex-shrink: 0;
}
.add-widget-details {
  position: relative;
}

.add-widget-btn {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-lg);
  border: 1px dashed var(--border-default);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-family: var(--font-heading);
  font-size: var(--text-xs);
  font-weight: var(--font-weight-medium);
  letter-spacing: 2px;
  text-transform: uppercase;
  width: 100%;
  justify-content: center;
  list-style: none;
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
}
.add-widget-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.add-widget-btn::-webkit-details-marker {
  display: none;
}

.add-widget-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: var(--space-xs);
  background: var(--bg-elevated, var(--bg-primary));
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
  z-index: 10;
  box-shadow: var(--shadow-md);
}
.add-widget-option {
  display: block;
  width: 100%;
  padding: var(--space-sm) var(--space-lg);
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  text-align: left;
  transition: all var(--transition-fast);
}
.add-widget-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}
</style>
