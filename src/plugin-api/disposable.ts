import type { Disposable } from '../types';
import { diagnosticsLogger } from '../diagnostics/invoke-logged';

/**
 * 批量 Disposable 容器。
 * dispose 时按 LIFO 顺序释放所有已注册资源。
 * 幂等：重复 dispose 不抛异常。
 */
export class DisposableStore implements Disposable {
  private _disposables: Disposable[] = [];
  private _disposed = false;

  /** 注册一个 Disposable，返回它自身以便链式调用 */
  add<T extends Disposable>(d: T): T {
    if (this._disposed) {
      // 已释放则立即 dispose 新资源
      d.dispose();
      return d;
    }
    this._disposables.push(d);
    return d;
  }

  /** track 是 add 的别名，语义更清晰 */
  track<T extends Disposable>(d: T): T {
    return this.add(d);
  }

  /** 释放所有已注册 Disposable（LIFO 顺序） */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;

    // LIFO: 从后往前释放
    while (this._disposables.length > 0) {
      const d = this._disposables.pop()!;
      try {
        d.dispose();
      } catch (e) {
        diagnosticsLogger.warn('plugin', 'plugin.dispose_failed', '插件资源释放异常', {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}
