/**
 * 录制型 AudioContext 桩（v2.9.0）——把「接线」变成可断言对象。
 *
 * jsdom 没有 Web Audio，本项目此前的做法是只测纯函数（`audio-preview.test.ts`）
 * 或为单个链路手写假 ctx（`master-chain.test.ts`）。而 v2.9.0 的核心命题
 * 恰恰是「混音台控件有没有真的接进音频图」——这属于拓扑问题，
 * 纯函数测不到，真机又无法在 CI 里跑。
 *
 * 这里把 master-chain 的写法推广成通用基建：
 * 记录**节点创建、连接关系、AudioParam 的每次写入**，测试据此断言
 * 「推子接到了 fader」「静音 = -Infinity」「FX 类型出现在链上」。
 *
 * 明确边界：本桩只证明**拓扑与参数**，不证明声音好听/正确。
 * 真实幅度由离线渲染的数值验收（`.audit/acceptance/mix`）把关。
 */

export interface FakeAudioParam {
  value: number;
  setValueAtTime(value: number, time: number): void;
  setTargetAtTime(value: number, startTime: number, timeConstant: number): void;
  linearRampToValueAtTime(value: number, endTime: number): void;
  exponentialRampToValueAtTime(value: number, endTime: number): void;
  cancelScheduledValues(startTime: number): void;
}

export interface FakeAudioNode {
  kind: string;
  connect(target: FakeAudioNode): FakeAudioNode;
  disconnect(): void;
  /** 每条连接记录（含 from/to 的 kind） */
  [key: string]: unknown;
}

export interface ParamWrite {
  nodeKind: string;
  param: string;
  method: "value" | "setValueAtTime" | "setTargetAtTime" | "linearRamp" | "exponentialRamp" | "cancel";
  value?: number;
}

export interface ConnectionRecord {
  from: string;
  to: string;
}

/** 带节点引用的连接（用于"这条支路接去哪"的精确断言） */
export interface DetailedConnection {
  fromNode: FakeAudioNode;
  toNode: FakeAudioNode;
}

export interface FakeAudioContext {
  ctx: BaseAudioContext;
  nodes: FakeAudioNode[];
  connections: ConnectionRecord[];
  detailedConnections: DetailedConnection[];
  paramWrites: ParamWrite[];
  /** 按 kind 取节点（如 "StereoPanner"） */
  nodesOfKind(kind: string): FakeAudioNode[];
  /** 某节点的某参数最终值（最后一次写入） */
  finalParam(nodeKind: string, param: string): number | undefined;
  /** 所有连向某 kind 的源节点 */
  sourcesInto(kind: string): FakeAudioNode[];
  /** 直接造一个节点（用于充当 input/output 端点） */
  makeNode(kind: string): FakeAudioNode;
}

function createParam(
  nodeKind: string,
  param: string,
  initial: number,
  writes: ParamWrite[],
): FakeAudioParam {
  let current = initial;
  const record = (method: ParamWrite["method"], value?: number) => {
    writes.push({ nodeKind, param, method, value });
  };
  return {
    get value() {
      return current;
    },
    set value(v: number) {
      current = v;
      record("value", v);
    },
    setValueAtTime(value: number) {
      current = value;
      record("setValueAtTime", value);
    },
    setTargetAtTime(value: number) {
      // 记录目标值即可：断言关心「最终送到多少」，不模拟时间常数
      current = value;
      record("setTargetAtTime", value);
    },
    linearRampToValueAtTime(value: number) {
      current = value;
      record("linearRamp", value);
    },
    exponentialRampToValueAtTime(value: number) {
      current = value;
      record("exponentialRamp", value);
    },
    cancelScheduledValues() {
      record("cancel");
    },
  };
}

export function createFakeAudioContext(opts: { sampleRate?: number } = {}): FakeAudioContext {
  const nodes: FakeAudioNode[] = [];
  const connections: ConnectionRecord[] = [];
  const detailedConnections: DetailedConnection[] = [];
  const paramWrites: ParamWrite[] = [];

  const makeNode = (kind: string, params: Record<string, number> = {}): FakeAudioNode => {
    const node: FakeAudioNode = {
      kind,
      connect(target: FakeAudioNode) {
        connections.push({ from: kind, to: target?.kind ?? "?" });
        detailedConnections.push({ fromNode: node, toNode: target });
        return target;
      },
      disconnect() {
        // 与真实 AudioNode 一致：断开该节点的全部出边。
        // 必须实现，否则「重建 FX 链时忘了断直通支路」这类 bug 测不出来
        // （真实浏览器里会变成信号并联叠加）。
        for (let i = detailedConnections.length - 1; i >= 0; i--) {
          if (detailedConnections[i].fromNode === node) {
            detailedConnections.splice(i, 1);
            connections.splice(i, 1);
          }
        }
      },
    };
    for (const [name, initial] of Object.entries(params)) {
      node[name] = createParam(kind, name, initial, paramWrites);
    }
    nodes.push(node);
    return node;
  };

  const destination = makeNode("destination");
  const sampleRate = opts.sampleRate ?? 44100;

  const ctx = {
    sampleRate,
    currentTime: 0,
    state: "running",
    destination,
    createGain: () => makeNode("Gain", { gain: 1 }),
    createAnalyser: () => {
      const node = makeNode("Analyser");
      node.fftSize = 512;
      node.getFloatTimeDomainData = () => 0;
      return node;
    },
    createStereoPanner: () => makeNode("StereoPanner", { pan: 0 }),
    createBiquadFilter: () =>
      makeNode("BiquadFilter", { frequency: 350, Q: 1, gain: 0 }),
    createDynamicsCompressor: () =>
      makeNode("DynamicsCompressor", {
        threshold: -24,
        knee: 30,
        ratio: 12,
        attack: 0.003,
        release: 0.25,
      }),
    createDelay: () => makeNode("Delay", { delayTime: 0 }),
    createConvolver: () => makeNode("Convolver"),
    createWaveShaper: () => {
      const node = makeNode("WaveShaper");
      node.curve = null;
      return node;
    },
    createBuffer: (channels: number, length: number) => {
      // 每个声道持有稳定的数组：混响 IR 的确定性断言要读回写入的样本
      const data = Array.from({ length: channels }, () => new Float32Array(length));
      return {
        numberOfChannels: channels,
        length,
        sampleRate,
        duration: length / sampleRate,
        getChannelData: (channel: number) => data[channel],
      };
    },
    createOscillator: () => {
      const node = makeNode("Oscillator", { frequency: 440, detune: 0 });
      node.type = "sine";
      node.start = () => undefined;
      node.stop = () => undefined;
      return node;
    },
    createBufferSource: () => {
      const node = makeNode("BufferSource");
      node.start = () => undefined;
      node.stop = () => undefined;
      return node;
    },
  } as unknown as BaseAudioContext;

  return {
    ctx,
    nodes,
    connections,
    detailedConnections,
    paramWrites,
    nodesOfKind: (kind: string) => nodes.filter((n) => n.kind === kind),
    sourcesInto: (kind: string) =>
      detailedConnections.filter((c) => c.toNode?.kind === kind).map((c) => c.fromNode),
    makeNode,
    finalParam: (nodeKind: string, param: string) => {
      const relevant = paramWrites.filter((w) => w.nodeKind === nodeKind && w.param === param);
      const last = relevant[relevant.length - 1];
      return last?.value;
    },
  };
}
