import { describe, it, expect, afterEach, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentChat } from "../AgentChat";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ProjectProvider } from "../../../providers/ProjectProvider";
import { useProjectStore } from "../../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../../store/project-store";

/**
 * Stage 4 + v1.14 Stage 2: AgentChat -> AgentBus -> recordToolCall wiring
 * test. The chat component is the ONLY place in the UI that records agent.chat
 * tool calls. Sending a message records a "running" entry with a correlationId
 * minted once per round-trip; the AgentBus round-trip upserts that entry to
 * "success" (same correlationId), so the timeline is exactly ONE card — the
 * running snapshot is never left behind as a second append.
 */
function renderChat() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root: Root;
  let current: ProjectStoreValue | null = null;

  function Probe() {
    current = useProjectStore();
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(
      <I18nProvider>
        <ProjectProvider title="Chat Test">
          <AgentChat agentName="HarmonyBot" />
          <Probe />
        </ProjectProvider>
      </I18nProvider>
    );
  });

  const submit = (text: string) => {
    act(() => {
      const input = container.querySelector(
        '[data-testid="agent-chat-input"]'
      ) as HTMLTextAreaElement;
      // React tracks controlled input values via a value setter; setting
      // .value directly bypasses the tracker so onChange never fires. Use the
      // native setter the way React Testing Library does.
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set!;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      const form = container.querySelector(
        '[data-testid="agent-chat-form"]'
      ) as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  };

  return {
    get store(): ProjectStoreValue {
      if (!current) throw new Error("Store not initialized");
      return current;
    },
    container,
    submit,
    cleanup() {
      act(() => {
        root.unmount();
        container.remove();
      });
    },
  };
}

afterEach(() => {
  document.body.innerHTML = "";
});

// jsdom has no layout engine, so the component's auto-scroll must be stubbed
// for AgentChat to mount in tests.
beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
});

describe("AgentChat (Stage 1 wiring + v1.14 Stage 2 single-card)", () => {
  it("T01: 发送消息后时间线留下恰 1 张 agent.chat 卡(最终 success,参数完整) (critical)", async () => {
    const chat = renderChat();
    expect(chat.store.toolCalls.length).toBe(0);

    chat.submit("Suggest a chord progression for bars 1-4");

    // The compose agent answers synchronously inside AgentBus.request, so the
    // running entry is immediately upserted to success by correlationId. Poll
    // until the settled card lands (state update is async through React).
    let settled: {
      toolName: string;
      status: string;
      params: Record<string, unknown>;
      agentName?: string;
      correlationId?: string;
      timestamp?: string;
    } | undefined;
    const deadline = Date.now() + 2000;
    while (!settled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      settled = chat.store.toolCalls.find(
        (r) => r.toolName === "agent.chat" && r.status === "success"
      );
    }

    expect(settled).toBeDefined();
    expect(settled!.toolName).toBe("agent.chat");
    expect(settled!.status).toBe("success");
    expect(settled!.params).toEqual({ prompt: "Suggest a chord progression for bars 1-4" });
    expect(settled!.agentName).toBe("compose");
    expect(typeof settled!.timestamp).toBe("string");
    // Single-card contract: the running snapshot was upserted, not appended.
    expect(chat.store.toolCalls.filter((r) => r.toolName === "agent.chat").length).toBe(1);

    chat.cleanup();
  });

  it("T02: 同一 correlationId 复用,无 running 残留(时间线彻底单卡) (critical)", async () => {
    const chat = renderChat();

    chat.submit("Mix the drums louder");

    let settled:
      | { toolName: string; status: string; correlationId?: string }
      | undefined;
    const deadline = Date.now() + 2000;
    while (!settled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      settled = chat.store.toolCalls.find(
        (r) => r.toolName === "agent.chat" && r.status === "success"
      );
    }

    expect(settled).toBeDefined();
    expect(settled!.status).toBe("success");
    // The card is associated with a correlationId minted once per round-trip.
    expect(typeof settled!.correlationId).toBe("string");
    expect(settled!.correlationId!.length).toBeGreaterThan(0);
    // No stale running card survives the upsert: exactly one agent.chat entry,
    // in its final success state.
    const agentCalls = chat.store.toolCalls.filter(
      (r) => r.toolName === "agent.chat"
    );
    expect(agentCalls.length).toBe(1);
    expect(agentCalls[0].status).toBe("success");

    chat.cleanup();
  });
});
