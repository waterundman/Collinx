import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry, AgentBus } from "@collinx/core";
import { registerBuiltinTools } from "../tools";

/**
 * composer.suggestHarmony —— AI 的和声能力。
 *
 * 验收时 AI 主动报告：「和声工具把 E 小调误判成大调、且未产出提案」。
 * 核实后发现三个问题（比 AI 说的更多）：
 *
 * 1. `const mode = "major"` **硬编码** —— 参数里的调性根本没被读，所有请求都按大调生成
 * 2. **没有 diff** —— 返回 resultType=proposal 却没有 DiffEnvelope，
 *    用户在 Agent 面板看不到任何待审提案（与 v2.4.0 修过的 generateMotif 同类）
 * 3. `root` 用 `String.fromCharCode(65 + (rootNote % 12 > 4 ? 1 : 0))`
 *    —— 只会产出 "A" 或 "B"，和弦根音名完全错
 */
describe("composer.suggestHarmony tool", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
  });

  const ctx = { type: "agent" as const, name: "test" };

  it("T01: 必须产出可审批的 diff（否则 AI 的提案到不了用户面前）(critical)", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 4, key: "E", mode: "minor" },
      ctx,
    );

    expect(result.status).toBe("ok");
    const diff = result.diff;
    expect(diff, "suggestHarmony 必须带 DiffEnvelope").toBeTruthy();
    expect(diff!.ops.length).toBeGreaterThan(0);
  });

  it("T02: E 小调生成的是**小调**和弦，不是大调 (critical)", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 4, key: "E", mode: "minor" },
      ctx,
    );
    const data = result.data as { mode: string; entries: { romanNumeral: string }[] };
    expect(data.mode).toBe("minor");

    // 走向是随机选的，不能断言某个固定和弦一定出现；
    // 但小调的和弦罗马数字**全部**是 小写 i/iv/v 或 III/VI/VII，
    // 不会出现大调的 ii/iii/vi 组合 —— 用"不含大调特征"来判定
    const romans = data.entries.map((e) => e.romanNumeral);
    expect(romans.length).toBeGreaterThan(0);
    for (const r of romans) {
      // 大调特征：ii / iii / vii° 的小写形式（小调里对应 ii° / III / VII）
      expect(["ii", "iii", "vii°"]).not.toContain(r);
    }
  });

  it("T03: 大调请求仍按大调生成（不回归）", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 4, key: "C", mode: "major" },
      ctx,
    );
    const data = result.data as { mode: string; entries: { romanNumeral: string }[] };
    expect(data.mode).toBe("major");
    expect(data.entries[0].romanNumeral).toBe("I");
  });

  it("T04: 和弦根音名必须正确（E 小调首和弦根音是 E，不是 A/B）", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 4, key: "E", mode: "minor" },
      ctx,
    );
    const data = result.data as { entries: { chord: { root: string } }[] };
    // 修复前 root 只会是 "A" 或 "B"（String.fromCharCode 的产物）。
    // 这里断言所有根音都是合法音名，且不再是那两个固定值
    const validNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    for (const e of data.entries) {
      expect(validNames).toContain(e.chord.root);
    }
    // E 小调的所有和弦根音都必须来自 E 自然小调音阶（E F# G A B C D）
    const eMinor = ["E", "F#", "G", "A", "B", "C", "D"];
    for (const e of data.entries) {
      expect(eMinor).toContain(e.chord.root);
    }
  });

  it("T05: diff 里应有和弦音符（可听到的声音，而非只有和弦名）", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 2, key: "C", mode: "major" },
      ctx,
    );
    const diff = result.diff!;
    const noteOps = diff.ops.filter((o) => o.op === "add_note_group");
    expect(noteOps.length).toBeGreaterThan(0);

    const notes = (noteOps[0] as { notes: unknown[] }).notes;
    // 三和弦 = 3 个音；这里校验"确实是多声部而非单音"
    expect(notes.length).toBeGreaterThanOrEqual(3);
  });

  it("T06: 缺省 mode 时按大调（向后兼容既有调用）", async () => {
    const result = await registry.call(
      "composer.suggestHarmony",
      { bars: 2, key: "C" },
      ctx,
    );
    expect(result.status).toBe("ok");
    const data = result.data as { mode: string };
    expect(data.mode).toBe("major");
  });
});

describe("suggestHarmony 调式来源容错（v2.8.0）", () => {
  const call = async (params: Record<string, unknown>) => {
    const registry = new ToolRegistry();
    registerBuiltinTools(registry, new AgentBus());
    return registry.call("composer.suggestHarmony", params, { type: "agent", name: "test" });
  };

  it("用 scale 表达调式也应生效（AI 习惯这么传）(critical)", async () => {
    // 实测：AI 在对话里说 E 小调，但它把调式放在 scale 字段，
    // 工具只认 mode → 静默退化成大调，落进工程的仍是大调和弦
    const result = await call({ bars: 4, key: "E", scale: "natural_minor" });
    expect(result.status).toBe("ok");
    const data = result.data as { mode: string };
    expect(data.mode).toBe("minor");
  });

  it("mode 优先于 scale", async () => {
    const result = await call({ bars: 4, key: "C", mode: "major", scale: "minor" });
    expect((result.data as { mode: string }).mode).toBe("major");
  });

  it("两者都没给时按大调", async () => {
    const result = await call({ bars: 4, key: "C" });
    expect((result.data as { mode: string }).mode).toBe("major");
  });
});
