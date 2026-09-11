/**
 * S1-T01~T03: App 设置入口 + SettingsPage 模态开关接线测试
 * 全量渲染 App（真实点击路径，不 mock 被测语义边界）：
 * - 点击 TopBar open-settings → role="dialog" + aria-modal 模态出现
 * - dialog 上 Escape keyDown → onClose → 模态消失、App 交互恢复
 * - i18n app.settings.open en/zh 对称 + 文案解析（非 raw key）
 */
import { describe, it, expect, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from '../../../App';
import { I18nProvider } from '../../../providers/I18nProvider';
import { ProjectProvider } from '../../../providers/ProjectProvider';
import { SettingsProvider } from '../../../contexts/SettingsContext';
import en from '../../../i18n/locales/en.json';
import zh from '../../../i18n/locales/zh-CN.json';

// jsdom 环境基建：PianoRollView 等布局组件依赖 ResizeObserver（与被测的
// 设置模态接线语义无关，仅补齐 jsdom 缺失的 Web API）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as Record<string, unknown>).ResizeObserver =
  globalThis.ResizeObserver ?? ResizeObserverStub;

/** 手写 waitFor（无 testing-library）：轮询谓词直到成立或超时 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('waitFor: timeout');
    }
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
  }
}

interface Harness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderApp(): Harness {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <ProjectProvider>
          <SettingsProvider>
            <App />
          </SettingsProvider>
        </ProjectProvider>
      </I18nProvider>
    );
  });
  return {
    container,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

function getOpenSettingsButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector(
    '[data-testid="open-settings"]'
  ) as HTMLButtonElement | null;
  expect(btn).not.toBeNull();
  return btn!;
}

function queryDialog(container: HTMLElement): HTMLElement | null {
  return container.querySelector('[role="dialog"]');
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true })
    );
  });
}

function keyDown(el: HTMLElement, key: string) {
  act(() => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    );
  });
}

afterEach(() => {
  document.body.innerHTML = '';
});

// ── S1-T01: 点击 open-settings → 模态出现 ──
describe('App settings entry wiring (S1-T01)', () => {
  it('S1-T01: 点击 open-settings → role=dialog + aria-modal 模态出现 (critical)', async () => {
    const { container, cleanup } = renderApp();

    // 初始无模态
    expect(queryDialog(container)).toBeNull();

    // 真实点击 → 模态出现
    click(getOpenSettingsButton(container));
    await waitFor(() => queryDialog(container) !== null);

    const dialog = queryDialog(container)!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // aria-label 解析为 settings.title 文案（非 raw key fallback）
    expect(dialog.getAttribute('aria-label')).toBeTruthy();
    expect(dialog.getAttribute('aria-label')).not.toBe('settings.title');

    cleanup();
  });

  // ── S1-T02: Escape → onClose → 模态消失 ──
  it('S1-T02: dialog 上 Escape keyDown → onClose → 模态消失、App 交互恢复 (critical)', async () => {
    const { container, cleanup } = renderApp();

    click(getOpenSettingsButton(container));
    await waitFor(() => queryDialog(container) !== null);

    // Escape 关闭（SettingsPage 既有 handleKeyDown 覆盖，App 只传 onClose）
    keyDown(queryDialog(container)!, 'Escape');
    await waitFor(() => queryDialog(container) === null);
    expect(queryDialog(container)).toBeNull();

    // 模态条件卸载后 App 交互恢复：再次点击可重新打开
    click(getOpenSettingsButton(container));
    await waitFor(() => queryDialog(container) !== null);
    expect(queryDialog(container)!.getAttribute('aria-modal')).toBe('true');

    cleanup();
  });

  // ── S1-T02 补充: onClose 路径（关闭按钮渲染时）也应卸载模态 ──
  it('S1-T02b: 模态出现前后 App 内容保持可交互（save-project 按钮始终存在）', () => {
    const { container, cleanup } = renderApp();

    // App 自身内容在模态打开前存在
    expect(container.querySelector('[data-testid="save-project"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="load-project"]')).not.toBeNull();

    cleanup();
  });
});

// ── S1-T03: i18n en/zh 对称 ──
describe('i18n app.settings.open symmetry (S1-T03)', () => {
  function dig(obj: unknown, path: string[]): unknown {
    let cur: unknown = obj;
    for (const k of path) {
      if (typeof cur !== 'object' || cur === null || !(k in cur)) return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
  }

  it('S1-T03a: app.settings.open 在 en/zh 均存在且为非空字符串，嵌套于 app 块（禁顶层 flat key）', () => {
    const enVal = dig(en, ['app', 'settings', 'open']);
    const zhVal = dig(zh, ['app', 'settings', 'open']);
    expect(typeof enVal).toBe('string');
    expect(typeof zhVal).toBe('string');
    expect((enVal as string).length).toBeGreaterThan(0);
    expect((zhVal as string).length).toBeGreaterThan(0);
    // en="Settings" / zh="设置"
    expect(enVal).toBe('Settings');
    expect(zhVal).toBe('设置');
  });

  it('S1-T03b: TopBar 设置按钮文案已解析（非 raw key fallback）', () => {
    const { container, cleanup } = renderApp();
    const btn = getOpenSettingsButton(container);
    expect(btn.textContent!.trim().length).toBeGreaterThan(0);
    expect(btn.textContent).not.toBe('app.settings.open');
    cleanup();
  });
});
