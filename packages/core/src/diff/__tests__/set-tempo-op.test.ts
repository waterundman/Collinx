import { describe, it, expect } from "vitest";
import { ProjectGraph } from "../../graph/project-graph";
import { DiffEngine } from "../diff-engine";
import { createDiffEnvelope } from "../diff-envelope";

/**
 * set_tempo —— 增量改速度的 op。
 *
 * 为什么需要新 op，而不是复用 update_meta：
 * `update_meta` 里 `meta.tempo_map` 的语义是**整体赋值**
 * （diff-engine.ts: `meta.tempo_map = op.data.tempo_map`）。
 * 而 agent 工具是无状态纯函数，拿不到当前图 —— 它只能表达
 * 「在 bar N 设为 bpm X」这一个意图，无法构造完整的 tempo_map。
 *
 * 若强行用 update_meta，后果是**数据破坏**：
 * 工程原本有 bar1=120、bar9=60 两个速度点，AI 改 bar1 → bar9 的 60 BPM 被抹掉，
 * 且用户只看到"改了个速度"，不会意识到丢了别的东西。
 *
 * 因此需要 op 级增量语义，与既有 SET_TEMPO action 的
 * 「overwrite / append / sort-asc」规则对齐。
 */
function makeGraphWithTwoTempos(): ProjectGraph {
  // withMeta 是 immutable 的（返回新图），不是原地修改
  return ProjectGraph.create("Tempo Test").withMeta({
    tempo_map: [{ bar: 1, bpm: 120 }, { bar: 9, bpm: 60 }],
  });
}

describe("withMeta 不得清空节点（v2.1.0 SEV1 回归守卫）", () => {
  it("改 meta 后原有 NoteSpan 仍然存在", () => {
    const base = ProjectGraph.create("Guard");
    base.addNode("NoteSpan", { pitchMidi: 60, bar: 1, beat: 1 });
    expect(base.getNodesByType("NoteSpan")).toHaveLength(1);

    const patched = base.withMeta({ tempo_map: [{ bar: 1, bpm: 90 }] });

    // 历史事故：withMeta 曾用 new ProjectGraph({...meta}) 重建，导致 nodes/edges
    // 变成空 Map —— 一次 tempo 编辑清空作品全部音符。这条断言专门守它。
    expect(patched.getNodesByType("NoteSpan")).toHaveLength(1);
    expect(patched.getMeta().tempo_map[0].bpm).toBe(90);
  });
});

describe("set_tempo op（增量语义）", () => {
  it("T01: 覆盖同 bar 的 bpm，保留其它小节的速度点 (critical)", () => {
    const graph = makeGraphWithTwoTempos();
    const engine = new DiffEngine();

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "Transport" },
      permissionScope: "proposal_only",
      summary: "设置第 1 小节速度为 90 BPM",
      ops: [{ op: "set_tempo", path: "/", bar: 1, bpm: 90 }],
    });

    // apply 是 immutable 的：参数为 (diff, graph)，返回 { graph, appliedOps }
    const result = engine.apply(diff, graph);
    expect(result.appliedOps).toBe(1);

    const tempoMap = result.graph.getMeta().tempo_map;
    expect(tempoMap).toHaveLength(2);
    expect(tempoMap.find((t) => t.bar === 1)?.bpm).toBe(90);
    // bar 9 的 60 BPM 必须还在 —— 这正是 update_meta 做不到的地方
    expect(tempoMap.find((t) => t.bar === 9)?.bpm).toBe(60);
  });

  it("T02: bar 不存在时追加，并按 bar 升序排列", () => {
    const graph = makeGraphWithTwoTempos();
    const engine = new DiffEngine();

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "Transport" },
      permissionScope: "proposal_only",
      summary: "在第 5 小节插入 100 BPM",
      ops: [{ op: "set_tempo", path: "/", bar: 5, bpm: 100 }],
    });

    const result = engine.apply(diff, graph);
    expect(result.appliedOps).toBe(1);

    const bars = result.graph.getMeta().tempo_map.map((t) => t.bar);
    expect(bars).toEqual([1, 5, 9]);
    expect(result.graph.getMeta().tempo_map.find((t) => t.bar === 5)?.bpm).toBe(100);
  });

  it("T03: 首个速度点被改后仍保持 bar 升序", () => {
    const graph = makeGraphWithTwoTempos();
    const engine = new DiffEngine();

    const diff = createDiffEnvelope({
      baseRevision: graph.getRevisionId(),
      actor: { type: "agent", name: "Transport" },
      permissionScope: "proposal_only",
      summary: "改第 9 小节",
      ops: [{ op: "set_tempo", path: "/", bar: 9, bpm: 75 }],
    });

    const result = engine.apply(diff, graph);
    expect(result.appliedOps).toBe(1);
    expect(result.graph.getMeta().tempo_map.map((t) => t.bar)).toEqual([1, 9]);
    expect(result.graph.getMeta().tempo_map[1].bpm).toBe(75);
  });
});
