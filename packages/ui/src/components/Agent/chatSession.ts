import type { ChatMessage } from "./AgentChat";

/**
 * v2.5.0：AI 对话会话缓存。
 *
 * 问题（loop-tester P0）：消息此前存在 AgentChat 的组件内 state，而 App 只在
 * `activeTab === "agent"` 时挂载它 —— 用户切到别的标签页再切回来，整段对话
 * 被静默清空（工具时间线还在，说明请求其实成功，只是消息没了）。
 *
 * 方案：sessionStorage 会话缓存。切 tab 保留、刷新也保留（同一标签页会话内），
 * 关闭标签页自然过期。**仅当调用方显式传入 persistKey 时才启用**，
 * 避免测试之间互相污染。
 */

const STORAGE_PREFIX = "collinx.agent.chat.v1:";

type SerializedMessage = Omit<ChatMessage, "timestamp"> & { timestamp: string };

export function loadChatSession(key: string): ChatMessage[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return (parsed as SerializedMessage[]).map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));
  } catch {
    return [];
  }
}

export function saveChatSession(key: string, messages: ChatMessage[]): void {
  try {
    const payload: SerializedMessage[] = messages.map((m) => ({
      ...m,
      timestamp: m.timestamp instanceof Date ? m.timestamp.toISOString() : String(m.timestamp),
    }));
    sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(payload));
  } catch {
    // 配额不足 / 隐私模式：静默降级为"不持久化"，不影响对话本身
  }
}

export function clearChatSession(key: string): void {
  try {
    sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    /* ignore */
  }
}
