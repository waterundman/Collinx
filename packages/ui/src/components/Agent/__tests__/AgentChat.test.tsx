import { describe, it, expect, afterEach, beforeAll } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AgentChat } from "../AgentChat";
import { I18nProvider } from "../../../providers/I18nProvider";
import { ProjectProvider } from "../../../providers/ProjectProvider";
import { useProjectStore } from "../../../hooks/useProjectStore";
import type { ProjectStoreValue } from "../../../store/project-store";

/**
 * Stage 4: AgentChat -> AgentBus -> recordToolCall wiring test. The chat
 * component is the ONLY place in the UI that records agent.chat tool calls,
 * so this locks the Stage 1 contract: sending a message leaves a "running"
 * entry in store.toolCalls, and the AgentBus round-trip appends a "success"
 * entry (the timeline is append-only, so both coexist).
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

describe("AgentChat (Stage 1 wiring)", () => {
  it("T01: 发送消息后在 store.toolCalls 留下 agent.chat 记录(running 立即出现) (critical)", () => {
    const chat = renderChat();
    expect(chat.store.toolCalls.length).toBe(0);

    chat.submit("Suggest a chord progression for bars 1-4");

    // The "running" entry is recorded synchronously by handleSubmit before
    // the AgentBus round-trip resolves.
    const running = chat.store.toolCalls.find(
      (r) => r.toolName === "agent.chat" && r.status === "running"
    );
    expect(running).toBeDefined();
    expect(running!.params).toEqual({ prompt: "Suggest a chord progression for bars 1-4" });
    expect(running!.agentName).toBe("compose");
    expect(typeof running!.timestamp).toBe("string");

    chat.cleanup();
  });

  it("T02: AgentBus 往返后追加 success 记录(append-only) (critical)", async () => {
    const chat = renderChat();

    chat.submit("Mix the drums louder");
    expect(chat.store.toolCalls.some((r) => r.status === "running")).toBe(true);

    // The compose agent answers synchronously inside AgentBus.request, so the
    // success entry is appended right after the awaited round-trip. Poll until
    // it lands (the state update is async through React dispatch).
    let success: { toolName: string; status: string } | undefined;
    const deadline = Date.now() + 2000;
    while (!success && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 10));
      success = chat.store.toolCalls.find(
        (r) => r.toolName === "agent.chat" && r.status === "success"
      );
    }

    expect(success).toBeDefined();
    expect(success!.toolName).toBe("agent.chat");
    expect(success!.status).toBe("success");
    // Append-only: the earlier running entry is still present.
    expect(chat.store.toolCalls.filter((r) => r.toolName === "agent.chat").length).toBeGreaterThanOrEqual(2);

    chat.cleanup();
  });
});
