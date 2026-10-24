import type { ToolRegistry, AgentBus, NoteEvent, HarmonyEntry, DiffOperation, ToolResult } from "@collinx/core";
import { randomUUID, TempoMap, createSection, FormRole, createDiffEnvelope, mixerToDiff } from "@collinx/core";
import { Composer } from "./composer";
import { Arranger } from "./arranger";
import { Planner } from "./planner";
import { Orchestrator } from "./orchestrator";
import { EngravingAgent } from "./engraving";
import { TeachingAgent } from "./teaching";
import { TasteMemoryAgent } from "./taste-memory";
import { MixingAgent } from "./mixing/mixing-agent";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Maps a coarse style hint to a target energy level for the Arranger. */
function styleToEnergy(style: string | undefined): number {
  switch (style) {
    case "cinematic":
      return 0.8;
    case "pop":
      return 0.6;
    case "jazz":
      return 0.45;
    case "classical":
      return 0.4;
    case "ambient":
      return 0.25;
    default:
      return 0.6;
  }
}

export function registerBuiltinTools(
  registry: ToolRegistry,
  bus: AgentBus
): void {
  const composer = new Composer(registry);
  const planner = new Planner(registry, bus);

  registry.register({
    name: "composer.generateMotif",
    description: "生成旋律动机/种子",
    permission: "proposal_only",
    parameters: [
      { name: "bars", type: "number", required: true, description: "小节数" },
      { name: "register", type: "string", required: true, description: "音区: low/mid/high" },
      { name: "styleHint", type: "string", required: false, description: "风格提示: classical/jazz/pop/rock/electronic/minimal" },
      { name: "key", type: "string", required: false, description: "调性根音: C/C#/Db/D/Eb/E/F/F#/G/Ab/A/Bb/B；也可写成合成串（如 \"E minor\"），调式会一并解析" },
      {
        name: "scale",
        type: "string",
        required: false,
        description:
          "调式/音阶。合法取值: major / minor（=natural_minor）/ harmonic_minor / melodic_minor / ionian / dorian / phrygian / lydian / mixolydian / aeolian / locrian / pentatonic_major / pentatonic_minor / blues。" +
          "也接受自然语言写法（\"E minor\"、\"Natural Minor\"、\"自然小调\"），大小写与空格无关。缺省 major。",
      },
      {
        name: "mode",
        type: "string",
        required: false,
        description: "调式的别名参数（minor/natural_minor/harmonic_minor/...）。与 scale 等价，二者都给时以 scale 为准。",
      },
    ],
    handler: async (params) => {
      return composer.generateMotif({
        bars: params.bars as number,
        register: params.register as "low" | "mid" | "high",
        styleHint: params.styleHint as string | undefined,
        key: params.key as string | undefined,
        scale: params.scale as string | undefined,
        // v2.8.1：AI 从 suggestHarmony 迁移过来时习惯传 mode，
        // 以前 generateMotif 不认这个字段，参数被静默丢掉 → 生成大调
        mode: params.mode as string | undefined,
      });
    },
  });

  /**
   * project.stats —— 读取工程统计。
   *
   * 真实验收里 AI 说过「同样无法查询，没有音符统计类工具」，因为 tool handler
   * 原先只收 params、拿不到图。为此给 ToolRegistry 加了可选的 ToolContext
   * （只读图视图），这是第一个用到它的工具。
   *
   * 设计要点：
   * - 权限 read_only：不产出 diff、不需要用户审批
   * - **没有图上下文时明确报错**，而不是返回 0 —— 否则用户会以为工程是空的
   */
  registry.register({
    name: "project.stats",
    description: "读取当前工程的统计：音符数、轨道数、小节数、当前速度",
    permission: "read_only",
    parameters: [],
    handler: async (_params, ctx) => {
      const graph = ctx?.readGraph?.();
      if (!graph) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: "缺少图上下文（readGraph），无法读取工程统计",
        };
      }

      const noteNodes = graph.getNodesByType("NoteSpan");
      const trackIds = new Set<string>();
      let maxBar = 0;

      for (const node of noteNodes) {
        const data = node.data as { trackId?: unknown; bar?: unknown };
        if (typeof data.trackId === "string") trackIds.add(data.trackId);
        const bar = Number(data.bar);
        if (Number.isFinite(bar) && bar > maxBar) maxBar = bar;
      }

      const tempoMap = graph.getMeta().tempo_map;
      const bpm = tempoMap.length > 0 ? tempoMap[0].bpm : 120;

      return {
        status: "ok",
        resultType: "data",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: {
          notes: noteNodes.length,
          tracks: trackIds.size,
          bars: maxBar,
          bpm,
        },
      };
    },
  });

  /**
   * harmony.inspect —— 让 AI 看见和弦轨（v2.9.1）。
   *
   * 和弦此前只存在于图的 ChordEvent 节点里：`project.stats` 只数音符与轨道，
   * 模型看不到「第 3 小节是什么和弦」，也就无法据此改写/配器。
   */
  registry.register({
    name: "harmony.inspect",
    description: "读取和弦轨：每个小节的和弦（根音/性质/低音）与调性。改写和声或配器前应先调用它",
    permission: "read_only",
    parameters: [],
    handler: async (_params, ctx) => {
      const graph = ctx?.readGraph?.();
      if (!graph) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: "缺少图上下文（readGraph），无法读取和弦轨",
        };
      }
      const chords = graph
        .getNodesByType("ChordEvent")
        .map((n) => {
          const data = n.data as {
            bar?: unknown;
            chord?: { root?: unknown; quality?: unknown; bass?: unknown };
          };
          const root = typeof data.chord?.root === "string" ? data.chord.root : "";
          if (!root) return null;
          return {
            bar: Number(data.bar) || 0,
            root,
            quality: typeof data.chord?.quality === "string" ? data.chord.quality : "maj",
            ...(typeof data.chord?.bass === "string" ? { bass: data.chord.bass } : {}),
          };
        })
        .filter((c): c is { bar: number; root: string; quality: string; bass?: string } => c !== null)
        .sort((a, b) => a.bar - b.bar);

      const keyMap = graph.getMeta().key_map ?? [];
      const key = keyMap[0]
        ? { tonic: keyMap[0].tonic, mode: keyMap[0].mode }
        : { tonic: "C", mode: "major" };

      return {
        status: "ok",
        resultType: "data",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: { key, chords },
      };
    },
  });

  /**
   * mixer.inspect —— 让 AI 看见混音台（v2.9.0）。
   *
   * 此前 `project.stats` 只有 notes/tracks/bars/bpm：混音状态（增益/声像/
   * 静音/独奏/FX）完全在图外，模型对「把贝斯静音」「整体太亮」这类请求
   * 只能空谈。只读、不产生 diff —— 与所有读工具一致。
   */
  registry.register({
    name: "mixer.inspect",
    description:
      "读取混音台状态：每轨增益(dB)/声像/静音/独奏/实际是否静音/音色/FX 链，以及 master 增益。混音相关的建议或修改前应先调用它",
    permission: "read_only",
    parameters: [],
    handler: async (_params, ctx) => {
      const mixer = ctx?.readMixer?.();
      if (!mixer) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: "缺少混音上下文（readMixer），无法读取混音台",
        };
      }
      return {
        status: "ok",
        resultType: "data",
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
        data: mixer,
      };
    },
  });

  /**
   * transport.setTempo —— 让 AI 能改速度。
   *
   * 真实点击验收发现：用户说「把速度改成 90 BPM」，AI 答「我没有改 BPM 的工具，
   * 你去面板手动改」。最高频的参数修改反而没有工具，是能力面最大的缺口。
   *
   * 用 set_tempo 这个增量 op（而不是 update_meta）：后者对 tempo_map 是整体赋值，
   * 而本工具是无状态纯函数、拿不到当前图，无法构造完整 tempo_map ——
   * 硬用 update_meta 会抹掉其它小节的速度点（真实数据破坏）。
   * set_tempo 由 diff-engine 按「同 bar 覆盖 / 否则追加 / 按 bar 升序」应用。
   */
  registry.register({
    name: "transport.setTempo",
    description: "修改指定小节的速度（BPM）",
    permission: "proposal_only",
    parameters: [
      { name: "bpm", type: "number", required: true, description: "速度，20-400" },
      { name: "bar", type: "number", required: false, description: "起始小节，默认 1" },
    ],
    handler: async (params) => {
      const bpm = Number(params.bpm);
      if (!Number.isFinite(bpm) || bpm < 20 || bpm > 400) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: `bpm 必须在 20..400 之间，收到 ${String(params.bpm)}`,
        };
      }

      const bar = params.bar === undefined ? 1 : Number(params.bar);
      if (!Number.isInteger(bar) || bar < 1) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: `bar 必须是正整数，收到 ${String(params.bar)}`,
        };
      }

      return {
        status: "ok",
        resultType: "proposal",
        data: { bpm, bar },
        diff: createDiffEnvelope({
          baseRevision: "",
          actor: { type: "agent", name: "Transport" },
          permissionScope: "proposal_only",
          summary: `设置第 ${bar} 小节速度为 ${bpm} BPM`,
          // v2.8.0：用 set_tempo（增量）而不是 update_meta（整体替换 tempo_map），
          // 否则多 tempo 点的工程会被抹掉其它小节的速度（见 core/diff 的 T01 守卫）
          ops: [{ op: "set_tempo", path: "/", bar, bpm }],
        }),
        confidence: 0.9,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "composer.suggestHarmony",
    description: "生成和声进行建议",
    permission: "proposal_only",
    parameters: [
      { name: "bars", type: "number", required: true, description: "小节数" },
      { name: "key", type: "string", required: true, description: "调性" },
      { name: "style", type: "string", required: false, description: "风格" },
    ],
    handler: async (params) => {
      return composer.suggestHarmony({
        bars: params.bars as number,
        key: params.key as string,
        style: params.style as string | undefined,
        // v2.8.0：此前没透传 mode，composer 里又硬编码 "major"，
        // 用户要小调也只拿到大调和弦
        mode: params.mode as string | undefined,
        // AI 常把调式放在 scale 字段（"natural_minor"），也要透传
        scale: params.scale as string | undefined,
      });
    },
  });

  registry.register({
    name: "planner.planTask",
    description: "将自然语言目标转为任务图",
    permission: "read_only",
    parameters: [
      { name: "intent", type: "string", required: true, description: "用户意图" },
    ],
    handler: async (params) => {
      const graph = planner.planTask(params.intent as string, {});
      return {
        status: "ok",
        resultType: "data",
        data: graph,
        confidence: 0.8,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "orchestrator.voicingPlan",
    description: "生成配器/声部编排方案",
    permission: "proposal_only",
    parameters: [
      { name: "harmony", type: "array", required: true, description: "和声条目 JSON（HarmonyEntry[]：bar/beat/chord{root,quality}/durationQn）" },
      { name: "players", type: "array", required: true, description: "目标乐器ID列表" },
      { name: "phraseRef", type: "string", required: false, description: "乐句引用（元数据，仅用于审计/关联，不参与计算）" },
      { name: "style", type: "string", required: false, description: "风格: classical/pop/cinematic/jazz" },
      { name: "playabilityPolicy", type: "string", required: false, description: "可演奏性策略: strict/moderate/lenient" },
      { name: "doubleOctaves", type: "boolean", required: false, description: "允许八度重复" },
      { name: "maxVoices", type: "number", required: false, description: "最大声部数" },
    ],
    handler: async (params) => {
      const harmony = params.harmony;
      if (!Array.isArray(harmony)) {
        return {
          status: "error",
          resultType: "data",
          data: { message: "参数 harmony 必须为 HarmonyEntry[] 数组" },
          confidence: 0,
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
        };
      }

      const orchestrator = new Orchestrator();
      const result = orchestrator.orchestrate(harmony as HarmonyEntry[], {
        players: params.players as string[],
        style: (params.style as "classical" | "pop" | "cinematic" | "jazz") ?? "classical",
        playabilityPolicy: (params.playabilityPolicy as "strict" | "moderate" | "lenient") ?? "moderate",
        doubleOctaves: params.doubleOctaves as boolean | undefined,
        maxVoices: params.maxVoices as number | undefined,
      });
      return {
        status: "ok",
        resultType: "proposal",
        data: {
          voicingPlan: result.voicingPlan,
          perPlayerNotes: Array.from(result.perPlayerNotes).map(([k, v]) => [k, v.length]),
          conflicts: result.conflicts,
          suggestions: result.suggestions,
          confidence: result.confidence,
        },
        diffs: result.diffs,
        confidence: result.confidence,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  /**
   * mixer.setTrackVolume —— 让 AI 能调音量/声像。
   *
   * 与 transport.setTempo 同源的缺口：AI 能"建议 FX 链"，却不能把某轨调到 -6 dB。
   *
   * ⚠️ mixer 的架构特殊性（与音符不同）：
   * 混音状态**不在 ProjectGraph 里**，是 store 的独立状态 `state.mixer`，
   * 走独立的 diff 通道（UI 侧用 baseRevision `mixer://state-v1` 对齐）。
   * 因此这里沿用 mixing agent 的既有做法 `mixerToDiff(changes, "HEAD")`，
   * 由 UI 的 alignRevision 在入队时对齐 —— 不要在工具里猜 revision。
   */
  registry.register({
    name: "mixer.setTrackVolume",
    description: "设置某条轨道的音量（dB）与声像",
    permission: "proposal_only",
    parameters: [
      { name: "trackId", type: "string", required: true, description: "轨道 ID，如 melody" },
      { name: "gainDb", type: "number", required: false, description: "增益 dB，+12 ~ -60" },
      { name: "pan", type: "number", required: false, description: "声像 -1（左）~ 1（右）" },
    ],
    handler: async (params) => {
      const trackId = params.trackId;
      if (typeof trackId !== "string" || trackId.trim() === "") {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: "trackId 必须是非空字符串",
        };
      }

      const changes: { gainDb?: string; pan?: string } = {};

      if (params.gainDb !== undefined) {
        const gainDb = Number(params.gainDb);
        if (!Number.isFinite(gainDb) || gainDb > 12 || gainDb < -60) {
          return {
            status: "error",
            requiresUserConfirmation: false,
            auditRef: randomUUID(),
            data: `gainDb 必须在 -60..12 之间，收到 ${String(params.gainDb)}`,
          };
        }
        // MixerTrack.gainDb 在模型里是字符串
        changes.gainDb = String(gainDb);
      }

      if (params.pan !== undefined) {
        const pan = Number(params.pan);
        if (!Number.isFinite(pan) || pan < -1 || pan > 1) {
          return {
            status: "error",
            requiresUserConfirmation: false,
            auditRef: randomUUID(),
            data: `pan 必须在 -1..1 之间，收到 ${String(params.pan)}`,
          };
        }
        changes.pan = String(pan);
      }

      if (changes.gainDb === undefined && changes.pan === undefined) {
        return {
          status: "error",
          requiresUserConfirmation: false,
          auditRef: randomUUID(),
          data: "至少要给出 gainDb 或 pan 之一（空操作没有意义）",
        };
      }

      const summaryParts: string[] = [];
      if (changes.gainDb !== undefined) summaryParts.push(`音量 ${changes.gainDb} dB`);
      if (changes.pan !== undefined) summaryParts.push(`声像 ${changes.pan}`);

      return {
        status: "ok",
        resultType: "proposal",
        data: { trackId, changes },
        diff: mixerToDiff([{ trackId, changes }], "HEAD"),
        confidence: 0.9,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
        summary: `把 ${trackId} 的${summaryParts.join("、")}`,
      } as ToolResult;
    },
  });

  registry.register({
    name: "mixing.suggestChain",
    description: "建议效果链",
    permission: "proposal_only",
    parameters: [
      { name: "trackId", type: "string", required: false, description: "目标轨道ID" },
      { name: "style", type: "string", required: false, description: "风格提示" },
    ],
    handler: async (params) => {
      const mixing = new MixingAgent();
      const sourceId = (params.trackId as string) ?? "default";
      const chain = mixing.suggestChain(sourceId);
      return {
        status: "ok" as const,
        resultType: "proposal" as const,
        data: {
          sourceId,
          fxChain: chain,
          slotCount: chain.length,
        },
        confidence: 0.8,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "engraving.reflowLayout",
    description: "重新排布乐谱布局",
    permission: "proposal_only",
    parameters: [
      { name: "layoutId", type: "string", required: true, description: "布局ID" },
      { name: "houseStyle", type: "string", required: false, description: "乐谱风格: henle/schirmer/peters/modern" },
      { name: "collisionPolicy", type: "string", required: false, description: "冲突处理策略: auto_fix/report_only" },
    ],
    handler: async (params) => {
      const engraving = new EngravingAgent();
      const diff = engraving.reflowLayout(
        params.layoutId as string,
        (params.houseStyle as string) ?? "modern",
        (params.collisionPolicy as "auto_fix" | "report_only") ?? "report_only"
      );
      return {
        status: "ok",
        resultType: "proposal",
        data: {
          layoutId: params.layoutId,
          ops: diff.ops,
          collisionSummary: diff.summary,
        },
        diff,
        confidence: 0.8,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "engraving.reportCollisions",
    description: "报告乐谱排版冲突",
    permission: "read_only",
    parameters: [
      { name: "layoutId", type: "string", required: true, description: "布局ID" },
    ],
    handler: async (params) => {
      const engraving = new EngravingAgent();
      const report = engraving.reportCollisions(params.layoutId as string);
      return {
        status: "ok",
        resultType: "data",
        data: report,
        confidence: 0.9,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "engraving.extractParts",
    description: "从总谱中提取分谱声部",
    permission: "proposal_only",
    parameters: [
      { name: "layoutId", type: "string", required: true, description: "总谱布局ID" },
    ],
    handler: async (params) => {
      const engraving = new EngravingAgent();
      const diffs = engraving.extractParts(params.layoutId as string);
      const parts = diffs
        .flatMap((d) => d.ops)
        .filter(
          (op): op is Extract<DiffOperation, { op: "add_node" }> =>
            op.op === "add_node" && op.nodeType === "PartLayout"
        )
        .map((op) => op.data)
        .filter(
          (d): d is { instrumentId: string; instrumentName: string; barCount: number } =>
            typeof d === "object" &&
            d !== null &&
            typeof (d as { instrumentId?: unknown }).instrumentId === "string" &&
            typeof (d as { instrumentName?: unknown }).instrumentName === "string" &&
            typeof (d as { barCount?: unknown }).barCount === "number"
        );
      return {
        status: "ok",
        resultType: "data",
        data: {
          layoutId: params.layoutId,
          parts,
          diffCount: diffs.length,
        },
        diffs,
        confidence: 0.9,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainDecision",
    description: "解释某个音乐决策",
    permission: "read_only",
    parameters: [
      { name: "diffId", type: "string", required: true, description: "Diff ID" },
      { name: "userLevel", type: "string", required: false, description: "用户水平: beginner/intermediate/advanced/expert" },
      { name: "compareWithAlt", type: "boolean", required: false, description: "是否包含替代方案" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainDecision(
        params.diffId as string,
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate",
        (params.compareWithAlt as boolean) ?? false
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainHarmony",
    description: "解释和声进行",
    permission: "read_only",
    parameters: [
      { name: "chordProgression", type: "array", required: true, description: "和弦进行，支持两种格式：1) 罗马数字数组（如 ['I','IV','V','I']）；2) 音名和弦数组（如 ['E-G#-B']，每条为连字符拼接的音名序列），此时必须同时传 key 以指定调性（如 'C major' / 'A minor'），内部会转换为罗马数字再匹配模板。" },
      { name: "key", type: "string", required: true, description: "调性" },
      { name: "userLevel", type: "string", required: false, description: "用户水平" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainHarmony(
        params.chordProgression as string[],
        params.key as string,
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate"
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "teaching.explainOrchestration",
    description: "解释配器决策",
    permission: "read_only",
    parameters: [
      { name: "instrumentChoices", type: "array", required: true, description: "乐器ID列表" },
      { name: "context", type: "string", required: false, description: "配器上下文" },
      { name: "userLevel", type: "string", required: false, description: "用户水平" },
    ],
    handler: async (params) => {
      const teaching = new TeachingAgent();
      const explanation = teaching.explainOrchestration(
        params.instrumentChoices as string[],
        (params.context as string) ?? "general",
        (params.userLevel as "beginner" | "intermediate" | "advanced" | "expert") ?? "intermediate"
      );
      return {
        status: "ok",
        resultType: "data",
        data: explanation,
        confidence: 0.85,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "taste.analyzeExport",
    description: "分析导出版本并生成口味证据",
    permission: "read_only",
    parameters: [
      { name: "exportRef", type: "string", required: true, description: "导出引用" },
    ],
    handler: async (params) => {
      const taste = new TasteMemoryAgent();
      const notes: any[] = [];
      const tempoMap = TempoMap.default();
      const result = taste.analyzeExport(notes, tempoMap, params.exportRef as string);
      return {
        status: "ok",
        resultType: "data",
        data: {
          exportId: result.exportId,
          evidenceCount: result.evidenceSet.length,
          comparisonCount: result.genomeComparison.length,
          tasteDiffSummary: result.tasteDiffSummary,
        },
        confidence: 0.75,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "taste.rankWithTaste",
    description: "使用品味排序候选方案",
    permission: "read_only",
    parameters: [
      { name: "candidates", type: "array", required: true, description: "候选方案列表" },
    ],
    handler: async (params) => {
      const taste = new TasteMemoryAgent();
      const candidatesList = (params.candidates as any[]) ?? [];
      const ranked = taste.rankWithTaste(candidatesList, {});
      return {
        status: "ok",
        resultType: "data",
        data: { ranked: ranked.map((r) => ({ rank: r.rank, totalScore: r.score.totalScore })) },
        confidence: 0.8,
        requiresUserConfirmation: false,
        auditRef: randomUUID(),
      };
    },
  });

  registry.register({
    name: "arranger.expandSection",
    description: "展开/扩展乐段",
    permission: "proposal_only",
    parameters: [
      { name: "source", type: "array", required: false, description: "源乐句音符(NoteEvent[])" },
      { name: "bars", type: "number", required: false, description: "扩展小节数" },
      { name: "style", type: "string", required: false, description: "风格提示" },
      { name: "formTemplate", type: "string", required: false, description: "曲式模板(如 pop_ababcb)" },
      { name: "energyTarget", type: "number", required: false, description: "目标能量 0-1" },
      { name: "variantCount", type: "number", required: false, description: "变体数量" },
    ],
    handler: async (params) => {
      const arranger = new Arranger();
      const source = Array.isArray(params.source)
        ? (params.source as NoteEvent[])
        : [];
      const bars =
        typeof params.bars === "number" ? Math.max(1, params.bars) : 4;
      const energyTarget =
        typeof params.energyTarget === "number"
          ? clamp01(params.energyTarget)
          : styleToEnergy(params.style as string | undefined);

      const target = createSection({
        id: `section-${randomUUID()}`,
        name: `Section (${bars} bars)`,
        formRole: FormRole.Verse,
        startBar: 1,
        endBar: bars,
        energyLevel: energyTarget,
        motifIds: [],
        phraseIds: [],
      });

      const result = arranger.expandSection(source, target, {
        formTemplate:
          typeof params.formTemplate === "string" && params.formTemplate.length > 0
            ? params.formTemplate
            : "pop_ababcb",
        barCount: bars,
        energyTarget,
        variantCount:
          typeof params.variantCount === "number" ? params.variantCount : 3,
      });

      const variants = result.variants.map((v) => ({
        id: v.id,
        notes: v.notes,
        operations: v.operations,
        variationScore: v.variationScore,
        description: v.description,
      }));

      const selectedIndex = Math.max(
        0,
        result.variants.findIndex((v) => v.id === result.selectedVariant.id)
      );

      return {
        status: "ok",
        resultType: "proposal",
        data: {
          variants,
          selectedVariant: variants[selectedIndex] ?? variants[0] ?? null,
          formStructure: result.formStructure,
          section: target,
          energyCurvePoints: result.energyCurve.getPoints(),
          confidence: result.confidence,
        },
        // DiffEnvelope[] proposals for Agent-panel review (same plural-key
        // convention the orchestrator.voicingPlan handler uses).
        diffs: result.diffs,
        diff: result.diffs[selectedIndex],
        confidence: result.confidence,
        requiresUserConfirmation: true,
        auditRef: randomUUID(),
      };
    },
  });
}
