import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentBus } from "../agent-bus";
import type { AgentMessage } from "../agent-bus";

describe("AgentBus", () => {
  let bus: AgentBus;

  beforeEach(() => {
    bus = new AgentBus();
  });

  describe("registerAgent / unregisterAgent", () => {
    it("should register an agent", () => {
      const handler = vi.fn(async () => {});
      bus.registerAgent("agent-a", handler);
      expect(bus.getRegisteredAgents()).toContain("agent-a");
    });

    it("should throw on duplicate registration", () => {
      bus.registerAgent("agent-a", vi.fn(async () => {}));
      expect(() => bus.registerAgent("agent-a", vi.fn(async () => {}))).toThrow(
        'Agent "agent-a" is already registered'
      );
    });

    it("should unregister an agent", () => {
      bus.registerAgent("agent-a", vi.fn(async () => {}));
      bus.unregisterAgent("agent-a");
      expect(bus.getRegisteredAgents()).not.toContain("agent-a");
    });

    it("should throw when unregistering non-existent agent", () => {
      expect(() => bus.unregisterAgent("nonexistent")).toThrow(
        'Agent "nonexistent" is not registered'
      );
    });
  });

  describe("getRegisteredAgents", () => {
    it("should return empty array when no agents registered", () => {
      expect(bus.getRegisteredAgents()).toEqual([]);
    });
  });

  describe("send", () => {
    it("should deliver message to registered agent", async () => {
      const received: AgentMessage[] = [];
      bus.registerAgent("agent-b", async (msg) => {
        received.push(msg);
      });

      await bus.send("agent-a", "agent-b", "event", { data: "test" });

      expect(received).toHaveLength(1);
      expect(received[0].from).toBe("agent-a");
      expect(received[0].to).toBe("agent-b");
      expect(received[0].type).toBe("event");
      expect(received[0].payload).toEqual({ data: "test" });
    });

    it("should not fail when target is not registered", async () => {
      const msgId = await bus.send("agent-a", "unregistered", "event", {});
      expect(msgId).toBeTruthy();
    });

    it("should add message to history", async () => {
      await bus.send("agent-a", "agent-b", "event", {});
      expect(bus.getMessageHistory()).toHaveLength(1);
    });

    it("should return a unique message id", async () => {
      const id1 = await bus.send("a", "b", "event", {});
      const id2 = await bus.send("a", "b", "event", {});
      expect(id1).not.toBe(id2);
    });
  });

  describe("request / response", () => {
    it("should support request-response pattern", async () => {
      bus.registerAgent("worker", async (msg) => {
        if (msg.type === "request") {
          const result = { echoed: msg.payload };
          await bus.send(
            "worker",
            msg.from,
            "response",
            result,
            msg.correlationId
          );
        }
      });

      const response = await bus.request("client", "worker", { hello: "world" });
      expect(response).toEqual({ echoed: { hello: "world" } });
    });

    it("should throw when target is not registered", async () => {
      await expect(
        bus.request("client", "nonexistent", {})
      ).rejects.toThrow('Agent "nonexistent" is not registered');
    });

    it("should timeout if no response", async () => {
      bus.registerAgent("slow-agent", async () => {
        // never responds
      });

      await expect(
        bus.request("client", "slow-agent", {}, 100)
      ).rejects.toThrow("timed out");
    });

    it("should add both request and response messages to history", async () => {
      bus.registerAgent("worker", async (msg) => {
        if (msg.type === "request") {
          await bus.send("worker", msg.from, "response", "done", msg.correlationId);
        }
      });

      await bus.request("client", "worker", { task: "do" });

      const history = bus.getMessageHistory();
      expect(history).toHaveLength(2);
      expect(history[0].type).toBe("request");
      expect(history[1].type).toBe("response");
    });
  });

  describe("emit / subscribe", () => {
    it("should broadcast events to all subscribers", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      bus.subscribe("track:updated", handler1);
      bus.subscribe("track:updated", handler2);

      bus.emit("orchestrator", "track:updated", { trackId: "t1" });

      expect(handler1).toHaveBeenCalledWith({ trackId: "t1" });
      expect(handler2).toHaveBeenCalledWith({ trackId: "t1" });
    });

    it("should not call subscribers of different event types", () => {
      const handler = vi.fn();
      bus.subscribe("event-a", handler);
      bus.emit("source", "event-b", {});
      expect(handler).not.toHaveBeenCalled();
    });

    it("should return unsubscribe function", () => {
      const handler = vi.fn();
      const unsubscribe = bus.subscribe("event-x", handler);

      bus.emit("source", "event-x", {});
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();
      bus.emit("source", "event-x", {});
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("should add event messages to history", () => {
      bus.emit("planner", "task:started", { taskId: "t1" });
      const history = bus.getMessageHistory();
      expect(history).toHaveLength(1);
      expect(history[0].type).toBe("event");
      expect(history[0].to).toBe("*");
    });
  });

  describe("getMessageHistory", () => {
    it("should return all messages in order", async () => {
      bus.registerAgent("worker", async (msg) => {
        if (msg.type === "request") {
          await bus.send("worker", msg.from, "response", "ok", msg.correlationId);
        }
      });

      bus.emit("planner", "init", {});
      await bus.request("client", "worker", {});
      bus.emit("planner", "done", {});

      const history = bus.getMessageHistory();
      expect(history).toHaveLength(4);
      expect(history[0].type).toBe("event");
      expect(history[1].type).toBe("request");
      expect(history[2].type).toBe("response");
      expect(history[3].type).toBe("event");
    });
  });
});
