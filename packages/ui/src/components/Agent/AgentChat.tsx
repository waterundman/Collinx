import React, { useState, useRef, useEffect, useCallback } from "react";
import { useI18n } from "../../i18n";
import styles from "./AgentChat.module.css";

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  agentName?: string;
}

export interface AgentChatProps {
  messages: ChatMessage[];
  onSendMessage: (message: string) => void;
  isTyping?: boolean;
  agentName?: string;
}

export function AgentChat({
  messages,
  onSendMessage,
  isTyping = false,
  agentName = "Agent",
}: AgentChatProps) {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping, scrollToBottom]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (!trimmed) return;
      onSendMessage(trimmed);
      setInputValue("");
      inputRef.current?.focus();
    },
    [inputValue, onSendMessage]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
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