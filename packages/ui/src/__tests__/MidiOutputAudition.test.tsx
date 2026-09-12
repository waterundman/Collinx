/**
 * v1.29.0 Stage 1 (S1-T02 / S1-T03): App 试听接线 + computeAuditionVelocity 纯函数。
 *
 * 断言策略（S1-T02，App 实际传参核实——v1.16 教训）：
 *   1. vi.mock('../hooks/useMidiOutput') 注入 { isAvailable:true, playNote }，
 *      隔离真实 Web MIDI，直接观测 playNote 收到的参数；
 *   2. vi.mock('../components/PianoRoll/PianoRollView') 用一个"捕获 props 后
 *      返回 null"的替身，替代真实组件 —— 这样无需 canvas / ResizeObserver /
 *      音符命中坐标即可取到 App 实际下传的 onNoteAudition 闭包，直接调用它以
 *      验证"App 层参数 → playNote"整段接线（比 prop 层 spy 更贴近真实调用链，
 *      且不依赖易碎的事件坐标）。理由：真实链路中 onNoteAudition 由交互层在
 *      clean click 时调用，其参数为 NoteEvent 字段；此处直调闭包即等价验证
 *      App 侧的映射逻辑（computeAuditionVelocity + 固定时长）。
 *
 * 数值推导（禁魔法数）：
 *   computeAuditionVelocity(v) = clamp(round(v * 127), 1, 127)
 *     v=0.5 → 0.5*127 = 63.5 → round = 64
 *     v=0   → 0        → round = 0   → clamp 下界 1
 *     v=1   → 127      → round = 127
 *     v=1.5 → 190.5    → round = 191 → clamp 上界 127
 *     v=-0.2→ -25.4    → round = -25 → clamp 下界 1
 *   第三参 durationMs 恒为 App 模块级常量 AUDITION_DURATION_MS = 300。
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { I18nProvider } from "../providers/I18nProvider";
import { ProjectProvider } from "../providers/ProjectProvider";
import { SettingsProvider } from "../contexts/SettingsContext";
import { SETTINGS_STORAGE_KEY } from "../types/settings";
import { App, computeAuditionVelocity } from "../App";

// vi.hoisted：工厂在模块导入时执行，不能引用普通顶层 const（TDZ）。
const { playNoteMock, captured } = vi.hoisted(() => ({
  playNoteMock: vi.fn(),
  captured: { props: null as null | Record<string, unknown> },
}));

vi.mock("../hooks/useMidiOutput", () => ({
  useMidiOutput: () => ({ isAvailable: true, playNote: playNoteMock }),
}));

vi.mock("../components/PianoRoll/PianoRollView", () => ({
  PianoRollView: (props: Record<string, unknown>) => {
    captured.props = props;
    return null;
  },
}));

/** App.tsx 模块级常量 AUDITION_DURATION_MS（未导出，此处按定义取 300）。 */
const AUDITION_DURATION_MS = 300;

// jsdom 缺失 Web API（App 内其他组件布局依赖，与被测语义无关）
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderApp(): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
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
      });
      container.remove();
    },
  };
}

beforeAll(() => {
  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverStub,
  });
});

beforeEach(() => {
  playNoteMock.mockClear();
  captured.props = null;
});

afterEach(() => {
  document.body.innerHTML = "";
  localStorage.removeItem(SETTINGS_STORAGE_KEY);
});

describe("v1.29.0 App 试听接线 (S1-T02)", () => {
  it("S1-T02: App 实际下传 onNoteAudition → 直调后 playNote 收到 (pitch, clamp(round(v*127)), 300) (critical)", () => {
    const { cleanup } = renderApp();

    const onNoteAudition = captured.props?.onNoteAudition as
      | ((pitchMidi: number, velocity01: number) => void)
      | undefined;
    // App 必须真实把 onNoteAudition 传给 PianoRollView（否则试听闭环不成立）
    expect(typeof onNoteAudition).toBe("function");

    // v=0.5 → 64；pitchMidi 原样透传；第三参恒为 AUDITION_DURATION_MS
    act(() => {
      onNoteAudition!(60, 0.5);
    });
    expect(playNoteMock).toHaveBeenLastCalledWith(60, 64, AUDITION_DURATION_MS);

    // v=0 → clamp 下界 1
    act(() => {
      onNoteAudition!(62, 0);
    });
    expect(playNoteMock).toHaveBeenLastCalledWith(62, 1, AUDITION_DURATION_MS);

    // v=1 → 127
    act(() => {
      onNoteAudition!(64, 1);
    });
    expect(playNoteMock).toHaveBeenLastCalledWith(64, 127, AUDITION_DURATION_MS);

    expect(playNoteMock).toHaveBeenCalledTimes(3);

    cleanup();
  });
});

describe("v1.29.0 computeAuditionVelocity 纯函数 (S1-T03)", () => {
  it("S1-T03: 矩阵 0→1 / 0.5→64 / 1→127 / 1.5→127 / -0.2→1 (non-critical)", () => {
    expect(computeAuditionVelocity(0)).toBe(1); // round(0)=0 → clamp 下界 1
    expect(computeAuditionVelocity(0.5)).toBe(64); // 0.5*127=63.5 → round 64
    expect(computeAuditionVelocity(1)).toBe(127); // 1*127=127
    expect(computeAuditionVelocity(1.5)).toBe(127); // 190.5 → clamp 上界 127
    expect(computeAuditionVelocity(-0.2)).toBe(1); // -25.4 → clamp 下界 1
  });
});
