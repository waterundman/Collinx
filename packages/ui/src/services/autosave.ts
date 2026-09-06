import type { AgentMusicData } from "@collinx/core";

// ---------------------------------------------------------------------------
// v1.17.0 Stage 1: 自动保存（崩溃恢复）轮转槽。
//
// 与 localStorage 主持久化（persistence.ts, 单槽"最后状态"）互补：定时把
// 完整 AgentMusicData 快照轮转写入 N 个槽，浏览器崩溃/异常退出后用户可以
// 回退到最近几次快照中的任意一次，而不是只有最后状态。
//
// 设计要点：
//  - 每槽 payload = { savedAt, data: AgentMusicData } 的 JSON。槽级 savedAt
//    是唯一可信的时间源（AgentMusicData.manifest.modifiedAt 仅辅助）。
//  - 轮转语义：新快照固定进 slot0，旧内容向高位顺移（slot0→slot1→slot2），
//    slot2 的旧内容被淘汰。最新快照永远在 slot0，但判定"最新"仍以扫描后
//    按 savedAt 降序为准（对乱序写入/手改容错）。
//  - 配额异常：静默降级 —— 先尝试淘汰最旧的非空槽重试一次，仍失败则丢弃
//    本次写入（try/catch 模式同 persistence.ts saveProjectState），绝不抛错。
//  - 容错：JSON.parse 失败 / 结构缺失（无 savedAt 字符串或无 data 对象）的
//    槽在扫描时跳过。
//  - browser-safe：全程 localStorage + JSON，无 Node API。
// ---------------------------------------------------------------------------

/** 自动保存间隔：5 分钟（DAW 惯例 5-10 分钟）。 */
export const AUTOSAVE_INTERVAL_MS = 5 * 60 * 1000;

/** 轮转槽数量：最新 3 份快照可回退。 */
export const AUTOSAVE_SLOT_COUNT = 3;

export const autosaveSlotKey = (i: number): string => `collinx.autosave.v1.slot${i}`;

/** scanAutosaveSlots 返回的单条有效快照。payload 为完整的
 *  `{ savedAt, data }` JSON 字符串，恢复侧 JSON.parse 后取 `data`。 */
export interface AutosaveSlotEntry {
  savedAt: string;
  payload: string;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // localStorage getter can throw in privacy mode / some sandboxes.
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 写入轮转槽：新快照进 slot0，旧内容顺移（slot0→slot1→slot2，原 slot2 被
 * 淘汰）。snapshotJson 是 AgentMusicData 的 JSON 字符串；savedAt 是槽级时间
 * 元信息。写入后槽内存放 `{ savedAt, data }` 信封 JSON。
 * 所有 localStorage 异常（配额/隐私模式）静默降级，不抛错。
 */
export function writeAutosaveSlot(snapshotJson: string, savedAt: string): void {
  const storage = getLocalStorage();
  if (!storage) return;

  // 快照 JSON 必须可解析（调用方传入 collectAgentMusicData 输出的
  // JSON.stringify 结果）；解析失败直接丢弃本次写入。
  let data: AgentMusicData;
  try {
    data = JSON.parse(snapshotJson) as AgentMusicData;
  } catch {
    return;
  }

  let payload: string;
  try {
    payload = JSON.stringify({ savedAt, data });
  } catch {
    return;
  }

  // 旧内容顺移：从高位往低位搬，避免覆盖未读的槽。搬移失败（配额）静默
  // 跳过 —— 最坏结果是某个高位槽保留更旧的内容，扫描按 savedAt 排序兜底。
  for (let i = AUTOSAVE_SLOT_COUNT - 1; i > 0; i--) {
    const prev = storage.getItem(autosaveSlotKey(i - 1));
    try {
      if (prev !== null) {
        storage.setItem(autosaveSlotKey(i), prev);
      } else {
        storage.removeItem(autosaveSlotKey(i));
      }
    } catch {
      // Quota / privacy mode: degrade silently.
    }
  }

  try {
    storage.setItem(autosaveSlotKey(0), payload);
  } catch {
    // Quota exceeded: 静默降级丢最旧 —— 淘汰最靠后的非空槽后重试一次；
    // 仍失败则放弃本次写入（不覆盖已有快照）。
    for (let i = AUTOSAVE_SLOT_COUNT - 1; i >= 0; i--) {
      if (storage.getItem(autosaveSlotKey(i)) !== null) {
        try {
          storage.removeItem(autosaveSlotKey(i));
        } catch {
          // ignore
        }
        break;
      }
    }
    try {
      storage.setItem(autosaveSlotKey(0), payload);
    } catch {
      // Give up: drop this write, keep existing snapshots.
    }
  }
}

/**
 * 扫描全部槽，返回按 savedAt 降序的有效快照列表。损坏（JSON.parse 失败）或
 * 结构缺失（savedAt 非字符串 / data 非对象）的条目跳过，不抛错。
 */
export function scanAutosaveSlots(): AutosaveSlotEntry[] {
  const storage = getLocalStorage();
  if (!storage) return [];

  const out: AutosaveSlotEntry[] = [];
  for (let i = 0; i < AUTOSAVE_SLOT_COUNT; i++) {
    const raw = storage.getItem(autosaveSlotKey(i));
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as {
        savedAt?: unknown;
        data?: unknown;
      };
      if (
        typeof parsed?.savedAt !== "string" ||
        !isRecord(parsed.data)
      ) {
        continue;
      }
      out.push({ savedAt: parsed.savedAt, payload: raw });
    } catch {
      // Corrupt slot: skip without throwing.
      continue;
    }
  }

  out.sort((a, b) =>
    a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0
  );
  return out;
}

/** 清空全部轮转槽（恢复完成后调用，避免提示残留）。不抛错。 */
export function clearAutosaveSlots(): void {
  const storage = getLocalStorage();
  if (!storage) return;
  for (let i = 0; i < AUTOSAVE_SLOT_COUNT; i++) {
    try {
      storage.removeItem(autosaveSlotKey(i));
    } catch {
      // ignore
    }
  }
}
