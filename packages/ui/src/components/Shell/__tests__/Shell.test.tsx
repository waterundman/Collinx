import { describe, it, expect, afterEach, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TopBar } from "../TopBar";
import { TabPill } from "../TabPill";

// ---------------------------------------------------------------------------
// v1.14 Stage 3: TopBar / TabPill component tests.
//
// T01 (component, critical): TopBar renders brand + status + children (the
// tab pills) with the data-testid contract preserved ("tab-bar",
// "header-status").
//
// T02 (component, critical): TabPill toggles the active pill style when the
// active tab changes, and reports the clicked id through onSelect.
// ---------------------------------------------------------------------------

function render(el: React.ReactElement) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;

  act(() => {
    root = createRoot(container);
    root.render(el);
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

/** Fire a real bubbling click through React's synthetic event system. */
function click(el: Element | null) {
  if (!el) throw new Error("click target not found");
  act(() => {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  });
}

/** CSS modules hash class names, so match on the base name suffix. */
function hasClass(el: Element | null, base: string): boolean {
  return !!el && (el.className as string).includes(base);
}

describe("Shell components (v1.14 Stage 3)", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("T01: TopBar 渲染 brand + status + children tabs (critical)", () => {
    const { container, cleanup } = render(
      <TopBar brand="Collinx" status="9 notes">
        <TabPill id="compose" active onSelect={() => {}}>
          Compose
        </TabPill>
        <TabPill id="score" onSelect={() => {}}>
          Score
        </TabPill>
      </TopBar>
    );

    // header + brand text (E2E asserts the "Collinx" text).
    expect(container.querySelector("header")).not.toBeNull();
    expect(container.textContent).toContain("Collinx");

    // Tab container contract.
    const tabBar = container.querySelector('[data-testid="tab-bar"]');
    expect(tabBar).not.toBeNull();

    // Status contract + content.
    const status = container.querySelector('[data-testid="header-status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe("9 notes");

    // Children pills render inside the tab bar, order preserved.
    const pills = Array.from(
      tabBar?.querySelectorAll('[data-testid^="tab-"]') ?? [],
    );
    expect(pills.length).toBe(2);
    expect(pills[0]?.getAttribute("data-testid")).toBe("tab-compose");
    expect(pills[1]?.getAttribute("data-testid")).toBe("tab-score");

    cleanup();
  });

  it("T02: TabPill 激活态样式切换 (critical)", () => {
    const onSelect = vi.fn();

    // Stateful harness: clicking a pill moves the active style to it.
    function Harness() {
      const [active, setActive] = React.useState("compose");
      return (
        <TopBar brand="Collinx" status="ok">
          <TabPill
            id="compose"
            active={active === "compose"}
            onSelect={(id) => {
              setActive(id);
              onSelect(id);
            }}
          >
            Compose
          </TabPill>
          <TabPill
            id="score"
            active={active === "score"}
            onSelect={(id) => {
              setActive(id);
              onSelect(id);
            }}
          >
            Score
          </TabPill>
        </TopBar>
      );
    }

    const { container, cleanup } = render(<Harness />);

    const compose = container.querySelector('[data-testid="tab-compose"]');
    const score = container.querySelector('[data-testid="tab-score"]');

    // Initial state: compose is active (white pill), score is not.
    expect(hasClass(compose, "pillActive")).toBe(true);
    expect(hasClass(score, "pillActive")).toBe(false);
    expect(hasClass(score, "pill")).toBe(true);

    // Click score: active style switches to score, onSelect reports the id.
    click(score);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith("score");
    expect(hasClass(score, "pillActive")).toBe(true);
    expect(hasClass(compose, "pillActive")).toBe(false);

    // Click compose again: active style moves back.
    click(compose);
    expect(onSelect).toHaveBeenLastCalledWith("compose");
    expect(hasClass(compose, "pillActive")).toBe(true);
    expect(hasClass(score, "pillActive")).toBe(false);

    cleanup();
  });
});
