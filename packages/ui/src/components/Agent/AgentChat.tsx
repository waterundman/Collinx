import React, { useState, useRef, useEffect, useCallback } from "react";
import { randomUUID } from "@collinx/core";
import { useI18n } from "../../i18n";
import { useProjectStore } from "../../hooks/useProjectStore";
import { useSettings } from "../../hooks/useSettings";
import {
  AGENT_SYSTEM_PROMPT,
  LlmError,
  isLlmConfigured,
  runAgentLoop,
} from "../../services/llm";
import type { LlmErrorKind, LlmMessage } from "../../services/llm";
import { Icon } from "../Icon/Icon";
import { renderMarkdown } from "./markdown";
import { loadChatSession, saveChatSession } from "./chatSession";
import styles from "./AgentChat.module.css";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  agentName?: string;
  /** 该条回复是否为错误提示（不进入后续 LLM 上下文） */
  isError?: boolean;
}

export interface AgentChatProps {
  /** Optional seed messages shown when the chat first renders. */
  initialMessages?: ChatMessage[];
  agentName?: string;
  /** 未配置模型时"去设置"按钮的回调 */
  onOpenSettings?: () => void;
  /**
   * v2.5.0：会话持久化键。传入后，对话在标签页切换与页面刷新后都会保留
   * （App 传入；测试不传，避免用例间互相污染）。
   */
  persistKey?: string;
}

/** 快捷提示词（空状态展示，点击直接发送） */
const SUGGESTION_KEYS = [
  "agentChat.suggestionMotif",
  "agentChat.suggestionHarmony",
  "agentChat.suggestionArrange",
  "agentChat.suggestionMix",
] as const;

const ERROR_MESSAGE_KEYS: Record<LlmErrorKind, string> = {
  config: "agentChat.errorConfig",
  auth: "agentChat.errorAuth",
  rate_limit: "agentChat.errorRateLimit",
  network: "agentChat.errorNetwork",
  bad_request: "agentChat.errorBadRequest",
  server: "agentChat.errorServer",
  aborted: "agentChat.errorUnknown",
  unknown: "agentChat.errorUnknown",
};

function toLlmHistory(messages: ChatMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (m.isError) continue;
    if (m.role === "user") out.push({ role: "user", content: m.content });
    else if (m.role === "agent") out.push({ role: "assistant", content: m.content });
  }
  return out;
}

export function AgentChat({
  initialMessages,
  agentName = "Agent",
  onOpenSettings,
  persistKey,
}: AgentChatProps) {
  const { t } = useI18n();
  const { actions, pendingDiffs } = useProjectStore();
  const { settings } = useSettings();
  // v2.5.0：对话内进度反馈（思考 / 执行工具），取代此前无信息的三个点
  const [activeTool, setActiveTool] = useState<string | null>(null);
  // v2.5.0：对话历史从会话缓存恢复 —— 此前切标签页会静默清空整段对话
  const [messages, setMessages] = useState<ChatMessage[]>(
    () => initialMessages ?? (persistKey ? loadChatSession(persistKey) : []),
  );
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const llm = settings.agent.llm;
  const configured = isLlmConfigured(llm);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, streamingText, scrollToBottom]);

  // v2.5.0：对话变更写回会话缓存（切换标签页/刷新后不丢）
  useEffect(() => {
    if (persistKey) saveChatSession(persistKey, messages);
  }, [persistKey, messages]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const sendPrompt = useCallback(
    async (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed || isTyping) return;

      if (!configured) {
        pushMessage({
          id: `agent-${Date.now()}`,
          role: "agent",
          content: t("agentChat.errorConfig"),
          timestamp: new Date(),
          agentName,
          isError: true,
        });
        return;
      }

      setInputValue("");
      inputRef.current?.focus();

      const history: LlmMessage[] = [
        ...toLlmHistory(messages),
        { role: "user", content: trimmed },
      ];

      pushMessage({
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      });
      setIsTyping(true);
      setStreamingText("");

      const correlationId = randomUUID();
      actions.recordToolCall({
        toolName: "agent.chat",
        params: { prompt: trimmed, model: llm.model },
        resultSummary: t("toolCalls.result.waiting"),
        status: "running",
        agentName: "compose",
        correlationId,
      });

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const result = await runAgentLoop({
          config: llm,
          messages: history,
          systemPrompt: AGENT_SYSTEM_PROMPT,
          signal: controller.signal,
          onDelta: (delta) => setStreamingText((prev) => prev + delta),
          executor: {
            list: () => actions.listAgentTools(),
            execute: (name, args) => actions.runAgentTool(name, args),
          },
          // 让用户在等待期间看到"正在执行哪个工具"，而不是三个无信息的点
          onToolCall: (inv) => setActiveTool(inv.name),
        });

        const proposalCount = result.toolInvocations.reduce(
          (sum, inv) => sum + (inv.ok ? inv.diffCount : 0),
          0,
        );

        let content = result.content.trim();
        if (proposalCount > 0) {
          content = content
            ? `${content}\n\n${t("agentChat.proposalsCreated", { count: proposalCount })}`
            : t("agentChat.proposalsCreated", { count: proposalCount });
        }
        if (!content) {
          content = t("agentChat.errorUnknown");
        }

        actions.recordToolCall({
          toolName: "agent.chat",
          params: { prompt: trimmed, model: llm.model },
          resultSummary: t("toolCalls.result.responseReceived"),
          status: "success",
          agentName: "compose",
          correlationId,
        });

        pushMessage({
          id: `agent-${Date.now()}`,
          role: "agent",
          content,
          timestamp: new Date(),
          agentName,
        });
      } catch (err) {
        const kind: LlmErrorKind = err instanceof LlmError ? err.kind : "unknown";
        const aborted = kind === "aborted";

        actions.recordToolCall({
          toolName: "agent.chat",
          params: { prompt: trimmed, model: llm.model },
          resultSummary: t("agentChat.errorResponse", { name: agentName }),
          status: "error",
          agentName: "compose",
          correlationId,
        });

        if (!aborted) {
          pushMessage({
            id: `agent-${Date.now()}`,
            role: "agent",
            content: t(ERROR_MESSAGE_KEYS[kind]),
            timestamp: new Date(),
            agentName,
            isError: true,
          });
        }
      } finally {
        abortRef.current = null;
        setIsTyping(false);
        setStreamingText("");
        setActiveTool(null);
      }
    },
    [actions, agentName, configured, isTyping, llm, messages, pushMessage, t]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void sendPrompt(inputValue);
    },
    [inputValue, sendPrompt]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void sendPrompt(inputValue);
      }
    },
    [inputValue, sendPrompt]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={styles.chatContainer} data-testid="agent-chat">
      <div className={styles.chatHeader}>
        <div className={styles.headerInfo}>
          <span className={styles.agentBadge}>
            <Icon name="spark" size={15} strokeWidth={1.6} aria-hidden />
          </span>
          <div className={styles.headerText}>
            <span className={styles.agentName}>{agentName}</span>
            <span className={styles.status} data-testid="agent-chat-status">
              {isTyping ? t("agentChat.typing") : t("agentChat.online")}
            </span>
          </div>
        </div>
        {!configured && (
          <button
            type="button"
            className={styles.headerAction}
            data-testid="agent-chat-open-settings"
            onClick={onOpenSettings}
          >
            {t("agentChat.configureNow")}
          </button>
        )}
      </div>

      <div className={styles.messagesContainer} data-testid="agent-chat-messages">
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>
              <Icon name="chat" size={26} strokeWidth={1.4} aria-hidden />
            </div>
            <div className={styles.emptyText}>
              {t("agentChat.startConversation", { name: agentName })}
            </div>
            <div className={styles.emptyHint}>
              {configured
                ? t("agentChat.inputHint")
                : t("agentChat.notConfigured")}
            </div>
            {configured ? (
              <div className={styles.suggestions} data-testid="agent-chat-suggestions">
                <div className={styles.suggestionsTitle}>{t("agentChat.suggestionsTitle")}</div>
                {SUGGESTION_KEYS.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className={styles.suggestionChip}
                    data-testid={`agent-chat-suggestion-${key.split(".")[1]}`}
                    onClick={() => void sendPrompt(t(key))}
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            ) : (
              <button
                type="button"
                className={styles.suggestionChip}
                data-testid="agent-chat-open-settings-empty"
                onClick={onOpenSettings}
              >
                {t("agentChat.configureNow")}
              </button>
            )}
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${styles[msg.role]}${msg.isError ? ` ${styles.error}` : ""}`}
            >
              {msg.role === "agent" && (
                <div className={styles.messageAvatar}>
                  <Icon name="spark" size={14} strokeWidth={1.8} aria-hidden />
                </div>
              )}
              <div className={styles.messageContent}>
                {msg.role === "agent" && (
                  <div className={styles.messageAgentName}>
                    {msg.agentName || agentName}
                  </div>
                )}
                <div className={styles.messageBubble}>
                  <div className={styles.messageText}>{renderMarkdown(msg.content)}</div>
                  <div className={styles.messageTime}>
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
              {msg.role === "user" && (
                <div className={styles.messageAvatar}>
                  <Icon name="user" size={14} strokeWidth={1.8} aria-hidden />
                </div>
              )}
            </div>
          ))
        )}
        {isTyping && (
          <div className={`${styles.message} ${styles.agent}`}>
            <div className={styles.messageAvatar}>
              <Icon name="spark" size={14} strokeWidth={1.8} aria-hidden />
            </div>
            <div className={styles.messageContent}>
              <div className={styles.messageBubble}>
                {streamingText ? (
                  <div className={styles.messageText} data-testid="agent-chat-streaming">
                    {renderMarkdown(streamingText)}
                  </div>
                ) : (
                  <div className={styles.progress} data-testid="agent-chat-progress">
                    <Icon
                      name="wave"
                      size={14}
                      strokeWidth={1.6}
                      className={styles.progressIcon}
                      aria-hidden
                    />
                    <span className={styles.progressText}>
                      {activeTool
                        ? t("agentChat.toolRunning", { tool: activeTool })
                        : t("agentChat.thinking")}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* v2.5.0：AI 的产出在对话内可见可操作 —— 不必切到 Agent 面板才知道
          AI 生成了什么、也不用跳转才能审批。 */}
      {pendingDiffs.length > 0 && (
        <div className={styles.proposalBar} data-testid="agent-chat-proposals">
          <span className={styles.proposalIcon}>
            <Icon name="layers" size={14} strokeWidth={1.6} aria-hidden />
          </span>
          <span className={styles.proposalText}>
            {t("agentChat.pendingProposals", { count: pendingDiffs.length })}
          </span>
          <button
            type="button"
            className={styles.proposalAction}
            data-testid="agent-chat-apply-all"
            onClick={() => {
              for (const diff of pendingDiffs) {
                actions.applyDiff(diff);
              }
            }}
          >
            {t("agentChat.applyAll")}
          </button>
        </div>
      )}

      <form className={styles.inputContainer} data-testid="agent-chat-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          data-testid="agent-chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            configured ? t("agentChat.inputPlaceholder") : t("agentChat.notConfigured")
          }
          rows={1}
          disabled={isTyping}
        />
        {isTyping ? (
          <button
            type="button"
            data-testid="agent-chat-stop"
            className={styles.stopButton}
            onClick={handleStop}
          >
            {t("agentChat.stop")}
          </button>
        ) : (
          <button
            type="submit"
            data-testid="agent-chat-send"
            className={styles.sendButton}
            disabled={!inputValue.trim()}
          >
            {t("agentChat.send")}
          </button>
        )}
      </form>
    </div>
  );
}

export default AgentChat;
