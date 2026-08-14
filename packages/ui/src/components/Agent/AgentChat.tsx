import React, { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "../../i18n";
import { useProjectStore } from "../../hooks/useProjectStore";
import styles from "./AgentChat.module.css";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  agentName?: string;
}

export interface AgentChatProps {
  /** Optional seed messages shown when the chat first renders. */
  initialMessages?: ChatMessage[];
  agentName?: string;
}

const USER_AGENT_ID = "user";
const COMPOSE_AGENT_ID = "compose";

function extractAgentText(response: unknown, fallback: string): string {
  if (response && typeof response === "object") {
    const text = (response as { text?: unknown }).text;
    if (typeof text === "string" && text.length > 0) return text;
  }
  if (typeof response === "string" && response.length > 0) return response;
  return fallback;
}

export function AgentChat({ initialMessages, agentName = "Agent" }: AgentChatProps) {
  const { t } = useI18n();
  // Stage 1: the chat talks through the real AgentBus owned by the project store.
  const { bus, actions } = useProjectStore();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages ?? []);
  const [isTyping, setIsTyping] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const pushMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;

      setInputValue("");
      inputRef.current?.focus();

      pushMessage({
        id: `user-${Date.now()}`,
        role: "user",
        content: trimmed,
        timestamp: new Date(),
      });
      setIsTyping(true);

      // Stage 1: leave a "running" trace entry so the timeline shows the
      // request as in-flight while the AgentBus round-trips.
      actions.recordToolCall({
        toolName: "agent.chat",
        params: { prompt: trimmed },
        resultSummary: t("toolCalls.result.waiting"),
        status: "running",
        agentName: COMPOSE_AGENT_ID,
      });

      try {
        // Real request/response round-trip through the AgentBus. The "compose"
        // agent is pre-registered by ProjectProvider and answers with a rule-based
        // response carried in the response payload.
        const response = await bus.request(USER_AGENT_ID, COMPOSE_AGENT_ID, {
          prompt: trimmed,
        });
        // Stage 1: append the success entry (the timeline is append-only, so
        // the running entry above stays visible as the in-flight snapshot).
        actions.recordToolCall({
          toolName: "agent.chat",
          params: { prompt: trimmed },
          resultSummary: t("toolCalls.result.responseReceived"),
          status: "success",
          agentName: COMPOSE_AGENT_ID,
        });
        pushMessage({
          id: `agent-${Date.now()}`,
          role: "agent",
          content: extractAgentText(response, trimmed),
          timestamp: new Date(),
          agentName,
        });
      } catch {
        actions.recordToolCall({
          toolName: "agent.chat",
          params: { prompt: trimmed },
          resultSummary: t("agentChat.errorResponse", { name: agentName }),
          status: "error",
          agentName: COMPOSE_AGENT_ID,
        });
        pushMessage({
          id: `agent-${Date.now()}`,
          role: "agent",
          content: t("agentChat.errorResponse", { name: agentName }),
          timestamp: new Date(),
          agentName,
        });
      } finally {
        setIsTyping(false);
      }
    },
    [bus, actions, inputValue, pushMessage, agentName, t]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit(e);
      }
    },
    [handleSubmit]
  );

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className={styles.chatContainer} data-testid="agent-chat">
      <div className={styles.chatHeader}>
        <div className={styles.headerInfo}>
          <span className={styles.agentAvatar}>🤖</span>
          <div className={styles.headerText}>
            <span className={styles.agentName}>{agentName}</span>
            <span className={styles.status} data-testid="agent-chat-status">
              {isTyping ? t('agentChat.typing') : t('agentChat.online')}
            </span>
          </div>
        </div>
      </div>

      <div className={styles.messagesContainer} data-testid="agent-chat-messages">
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>💬</div>
            <div className={styles.emptyText}>
              {t('agentChat.startConversation', { name: agentName })}
            </div>
            <div className={styles.emptyHint}>
              {t('agentChat.inputHint')}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`${styles.message} ${styles[msg.role]}`}
            >
              {msg.role === "agent" && (
                <div className={styles.messageAvatar}>🤖</div>
              )}
              <div className={styles.messageContent}>
                {msg.role === "agent" && (
                  <div className={styles.messageAgentName}>
                    {msg.agentName || agentName}
                  </div>
                )}
                <div className={styles.messageBubble}>
                  <div className={styles.messageText}>{msg.content}</div>
                  <div className={styles.messageTime}>
                    {formatTime(msg.timestamp)}
                  </div>
                </div>
              </div>
              {msg.role === "user" && (
                <div className={styles.messageAvatar}>👤</div>
              )}
            </div>
          ))
        )}
        {isTyping && (
          <div className={`${styles.message} ${styles.agent}`}>
            <div className={styles.messageAvatar}>🤖</div>
            <div className={styles.messageContent}>
              <div className={styles.messageBubble}>
                <div className={styles.typingIndicator}>
                  <span></span>
                  <span></span>
                  <span></span>
                </div>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <form className={styles.inputContainer} data-testid="agent-chat-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className={styles.input}
          data-testid="agent-chat-input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('agentChat.inputPlaceholder')}
          rows={1}
          disabled={isTyping}
        />
        <button
          type="submit"
          data-testid="agent-chat-send"
          className={styles.sendButton}
          disabled={!inputValue.trim() || isTyping}
        >
          {t('agentChat.send')}
        </button>
      </form>
    </div>
  );
}

export default AgentChat;
