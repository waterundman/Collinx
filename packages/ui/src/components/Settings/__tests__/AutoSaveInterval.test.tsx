import { describe, it, expect, afterEach } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AutoSaveSettings } from "../AutoSaveSettings";
import { SettingsProvider } from "../../../contexts/SettingsContext";
import { I18nProvider } from "../../../providers/I18nProvider";

/**
 * v2.9.3：自动保存选项的 value 是**秒**。
 *
 * 此前 value 写成 1/2/5（本意是分钟）却被当秒用 —— 选「30 分钟」实际
 * 30 秒；默认值 300 也不在选项里，下拉框显示空白。
 */
function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <AutoSaveSettings />
        </SettingsProvider>
      </I18nProvider>,
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

describe("AutoSaveSettings 间隔单位", () => {
  afterEach(() => {
    localStorage.clear();
    document.body.innerHTML = "";
  });

  it("选项 value 是秒，默认 300 秒命中「5 分钟」", () => {
    const { container, cleanup } = render();
    const select = container.querySelector("select") as HTMLSelectElement | null;
    expect(select).not.toBeNull();

    const values = Array.from(select!.options).map((o) => o.value);
    expect(values).toEqual(["60", "120", "300", "600", "900", "1800"]);
    expect(select!.value).toBe("300");
    cleanup();
  });

  it("切换间隔写回设置（秒）", () => {
    const { container, cleanup } = render();
    const select = container.querySelector("select") as HTMLSelectElement;

    act(() => {
      select.value = "1800";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const stored = JSON.parse(localStorage.getItem("collinx_settings") ?? "{}");
    expect(stored.general?.autoSave?.interval).toBe(1800);
    cleanup();
  });
});
