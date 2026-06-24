import { randomUUID } from "../util/random-uuid";

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: "request" | "response" | "event" | "error";
  payload: unknown;
  timestamp: string;
  correlationId?: string;
}

export type MessageHandler = (message: AgentMessage) => Promise<void>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class AgentBus {
  private agents = new Map<string, MessageHandler>();
  private history: AgentMessage[] = [];
  private subscribers = new Map<string, Set<(payload: unknown) => void>>();
  private pendingRequests = new Map<string, PendingRequest>();

  registerAgent(name: string, handler: MessageHandler): void {
    if (this.agents.has(name)) {
      throw new Error(`Agent "${name}" is already registered`);
    }
    this.agents.set(name, handler);
  }

  unregisterAgent(name: string): void {
    if (!this.agents.has(name)) {
      throw new Error(`Agent "${name}" is not registered`);
    }
    this.agents.delete(name);
  }

  async send(
    from: string,
    to: string,
    type: AgentMessage["type"],
    payload: unknown,
    correlationId?: string
  ): Promise<string> {
    const id = randomUUID();
    const message: AgentMessage = {
      id,
      from,
      to,
      type,
      payload,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    this.history.push(message);

    if (type === "response" && correlationId) {
      const pending = this.pendingRequests.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(correlationId);
        pending.resolve(payload);
      }
    }

    const handler = this.agents.get(to);
    if (handler) {
      await handler(message);
    }

    return id;
  }

  async request(
    from: string,
    to: string,
    payload: unknown,
    timeoutMs = 5000
  ): Promise<unknown> {
    const correlationId = randomUUID();
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to,
      type: "request",
      payload,
      timestamp: new Date().toISOString(),
      correlationId,
    };
    this.history.push(message);

    const handler = this.agents.get(to);
    if (!handler) {
      throw new Error(`Agent "${to}" is not registered`);
    }

    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(correlationId);
        reject(new Error(`Request to "${to}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(correlationId, { resolve, reject, timer });
    });

    await handler(message);

    return responsePromise;
  }

  emit(from: string, eventType: string, payload: unknown): void {
    const message: AgentMessage = {
      id: randomUUID(),
      from,
      to: "*",
      type: "event",
      payload,
      timestamp: new Date().toISOString(),
    };
    this.history.push(message);

    const handlers = this.subscribers.get(eventType);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
  }

  subscribe(
    eventType: string,
    handler: (payload: unknown) => void
  ): () => void {
    if (!this.subscribers.has(eventType)) {
      this.subscribers.set(eventType, new Set());
    }
    this.subscribers.get(eventType)!.add(handler);

    return () => {
      const handlers = this.subscribers.get(eventType);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.subscribers.delete(eventType);
        }
      }
    };
  }

  getRegisteredAgents(): string[] {
    return Array.from(this.agents.keys());
  }

  getMessageHistory(): AgentMessage[] {
    return [...this.history];
  }
}
