import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  DeviceSelector,
  type DeviceInfo,
  type DeviceType,
  type DeviceDirection,
} from "../DeviceSelector";
import { I18nProvider } from "../../../providers/I18nProvider";

interface Harness {
  container: HTMLElement;
  cleanup: () => void;
}

function renderSelector(props: {
  deviceType?: DeviceType;
  direction?: DeviceDirection;
  value?: string;
  devices?: DeviceInfo[];
  onChange?: (id: string) => void;
  onRefresh?: () => Promise<void>;
}): Harness {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <DeviceSelector
          deviceType={props.deviceType ?? "audio"}
          direction={props.direction ?? "input"}
          value={props.value ?? ""}
          devices={props.devices}
          onChange={props.onChange ?? vi.fn()}
          onRefresh={props.onRefresh}
        />
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

afterEach(() => {
  document.body.innerHTML = "";
});

// ── v1.23.0 Stage 1 (D2-3): fake-device filler removed — empty state, no fakes ──
describe("DeviceSelector (v1.23.0 Stage 1: mock removal)", () => {
  it("S1-T03a: 无 externalDevices → 空态提示,不渲染 select (critical)", () => {
    const { container, cleanup } = renderSelector({});

    // Empty state rendered with the i18n key resolved (v1.18: assert the key
    // resolved to actual content, not the raw-key fallback that a missing
    // key would produce).
    const empty = container.querySelector(
      '[data-testid="device-empty-state"]'
    );
    expect(empty).not.toBeNull();
    expect(empty!.textContent).not.toBe("settings.device.empty");
    expect(empty!.textContent!.trim().length).toBeGreaterThan(0);

    // No <select> rendered in the empty state (no fake options to pick).
    expect(container.querySelectorAll("select").length).toBe(0);
    // No <option> elements (no mock devices leaked in).
    expect(container.querySelectorAll("option").length).toBe(0);

    cleanup();
  });

  it("S1-T03b: 刷新后仍保持空态,不造假设备 (critical)", async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined);
    const { container, cleanup } = renderSelector({ onRefresh });

    // Empty before refresh.
    expect(
      container.querySelector('[data-testid="device-empty-state"]')
    ).not.toBeNull();

    const refreshBtn = container.querySelector("button");
    expect(refreshBtn).not.toBeNull();
    await act(async () => {
      refreshBtn!.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
    });

    // Refresh was called, but the list stays empty (no mock repopulation).
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector('[data-testid="device-empty-state"]')
    ).not.toBeNull();
    expect(container.querySelectorAll("option").length).toBe(0);

    cleanup();
  });

  it("S1-T03c: 有 externalDevices → 渲染 select + 真实选项", () => {
    const realDevices: DeviceInfo[] = [
      { id: "focusrite", name: "Focusrite Scarlett", manufacturer: "Focusrite", isAvailable: true, isDefault: true },
      { id: "builtin", name: "Built-in Mic", manufacturer: "Apple", isAvailable: true },
    ];
    const { container, cleanup } = renderSelector({
      devices: realDevices,
      value: "focusrite",
    });

    // No empty state when real devices exist.
    expect(
      container.querySelector('[data-testid="device-empty-state"]')
    ).toBeNull();
    // Select rendered with the real options.
    const select = container.querySelector("select");
    expect(select).not.toBeNull();
    expect(container.querySelectorAll("option").length).toBe(2);

    cleanup();
  });
});
