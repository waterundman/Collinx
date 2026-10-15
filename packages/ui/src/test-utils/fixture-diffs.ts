import { createDiffEnvelope, createNoteEvent } from "@collinx/core";
import type { DiffEnvelope } from "@collinx/core";

/**
 * v2.4.0 S5：待审批提案的测试夹具。
 *
 * 背景：生产代码原先在首次进入时**预置 2 条示例提案**（actor 硬编码标
 * gpt-4o / claude-3），属于"假 AI"。该行为已被移除，`pendingDiffs` 初始为空。
 * 依赖"初始恰好 2 条"的既有测试改为**显式注入本夹具**，从而继续严格保护
 * 队列 / 审批 / 持久化 / 回滚等语义，而不是被放宽断言。
 *
 * 注意：`baseRevision` 填占位值即可 —— ProjectProvider 在注入路径上会把
 * 提案的 baseRevision 对齐到真实图的 revision（见 ProjectProvider 的
 * useReducer 初始化）。这里**不得**调用 createInitialState：那会创建
 * 额外的 TasteStore / Mixer 实例并产生持久化副作用，污染被测状态。
 */
const PLACEHOLDER_REVISION = "fixture-base-revision";

/**
 * 返回 count 条可被正常审批的提案。奇数下标为 `add_note_group`（对齐原预置
 * 的 "bass fill" 提案），偶数下标为 `add_node` Phrase —— 保持与原预置 2 条提案
 * 相同的"两种 op 都有"覆盖，使既有断言（含 add_note_group 的 diff 会产生
 * NoteSpan 节点等）继续成立。
 */
export function makeFixtureDiffs(count = 2): DiffEnvelope[] {
  return Array.from({ length: count }, (_, i) => {
    const isNote = i % 2 === 1;
    return createDiffEnvelope({
      baseRevision: PLACEHOLDER_REVISION,
      actor: { type: "agent", name: "TestFixture" },
      permissionScope: "proposal_only",
      summary: isNote ? `fixture note proposal ${i + 1}` : `fixture proposal ${i + 1}`,
      ops: isNote
        ? [
            {
              op: "add_note_group" as const,
              path: "/",
              notes: [
                createNoteEvent({
                  trackId: "bass",
                  bar: 2,
                  beat: 1,
                  durQn: 0.5,
                  pitchMidi: 43,
                }),
              ],
            },
          ]
        : [
            {
              op: "add_node" as const,
              path: "/",
              nodeType: "Phrase",
              data: {
                name: `Fixture ${i + 1}`,
                formRole: "verse",
                startBar: 1,
                endBar: 2,
                motifIds: [],
              },
            },
          ],
    });
  });
}

/** 单条夹具。 */
export function makeFixtureDiff(): DiffEnvelope {
  return makeFixtureDiffs(1)[0];
}

/** 追加音符的夹具（用于验证会改变 notes 的提案）。 */
export function makeNoteFixtureDiff(): DiffEnvelope {
  return createDiffEnvelope({
    baseRevision: PLACEHOLDER_REVISION,
    actor: { type: "agent", name: "TestFixture" },
    permissionScope: "proposal_only",
    summary: "fixture note proposal",
    ops: [
      {
        op: "add_note_group",
        path: "/",
        notes: [createNoteEvent({ trackId: "melody", bar: 4, beat: 1, durQn: 1, pitchMidi: 72 })],
      },
    ],
  });
}

/**
 * v2.4.0 S5：与原生产预置的 2 条示例提案**逐字段等价**的夹具。
 *
 * 原 `initialPendingDiffs`（已删除）的内容就是这两条：一条 Chorus Phrase，
 * 一条 bar 2 的 bass fill。依赖具体文案/名称的测试（v118-stage0 断言卡片文案
 * "Add a chorus phrase"、乐段名 "Chorus" + 角色 "副歌"）改用本夹具注入，
 * 从而保持原有断言强度不变。
 */
export function makeLegacySeedDiffs(): DiffEnvelope[] {
  return [
    createDiffEnvelope({
      baseRevision: PLACEHOLDER_REVISION,
      actor: { type: "agent", name: "HarmonyBot", model: "gpt-4o" },
      permissionScope: "proposal_only",
      summary: "Add a chorus phrase to the arrangement",
      ops: [
        {
          op: "add_node",
          path: "/",
          nodeType: "Phrase",
          data: { name: "Chorus", formRole: "chorus", startBar: 4, endBar: 5, motifIds: [] },
        },
      ],
    }),
    createDiffEnvelope({
      baseRevision: PLACEHOLDER_REVISION,
      actor: { type: "agent", name: "BassAgent", model: "claude-3" },
      permissionScope: "proposal_only",
      summary: "Add a bass fill in bar 2",
      ops: [
        {
          op: "add_note_group",
          path: "/",
          notes: [createNoteEvent({ trackId: "bass", bar: 2, beat: 1, durQn: 0.5, pitchMidi: 43 })],
        },
      ],
    }),
  ];
}
