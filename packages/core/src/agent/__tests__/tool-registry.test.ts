import { describe, it, expect, beforeEach } from "vitest";
import { ToolRegistry } from "../tool-registry";
import type { ToolDefinition, ToolResult } from "../tool-registry";
import type { ToolCallRecord } from "../tool-call";

const testActor = { type: "agent" as const, name: "test-agent" };

function makeTool(
  overrides: Partial<ToolDefinition> = {}
): ToolDefinition {
  return {
    name: "test.echo",
    description: "Echo tool for testing",
    permission: "read_only",
    parameters: [
      { name: "message", type: "string", required: true, description: "Message to echo" },
    ],
    handler: async (params) => ({
      status: "ok",
      resultType: "data",
      data: params.message,
      requiresUserConfirmation: false,
      auditRef: "",
    }),
    ...overrides,
  };
}

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe("register", () => {
    it("should register a tool", () => {
      const tool = makeTool({ name: "test.tool1" });
      registry.register(tool);
      expect(registry.getTool("test.tool1")).toBe(tool);
    });

    it("should throw on duplicate registration", () => {
      registry.register(makeTool({ name: "test.dup" }));
      expect(() => registry.register(makeTool({ name: "test.dup" }))).toThrow(
        'Tool "test.dup" is already registered'
      );
    });
  });

  describe("unregister", () => {
    it("should unregister a tool", () => {
      registry.register(makeTool({ name: "test.tool1" }));
      registry.unregister("test.tool1");
      expect(registry.getTool("test.tool1")).toBeUndefined();
    });

    it("should throw when unregistering non-existent tool", () => {
      expect(() => registry.unregister("nonexistent")).toThrow(
        'Tool "nonexistent" is not registered'
      );
    });
  });

  describe("getTool", () => {
    it("should return undefined for non-existent tool", () => {
      expect(registry.getTool("nonexistent")).toBeUndefined();
    });

    it("should return the tool definition", () => {
      const tool = makeTool({ name: "test.tool1" });
      registry.register(tool);
      expect(registry.getTool("test.tool1")).toEqual(tool);
    });
  });

  describe("listTools", () => {
    it("should return empty array when no tools registered", () => {
      expect(registry.listTools()).toEqual([]);
    });

    it("should return all registered tools", () => {
      registry.register(makeTool({ name: "test.a" }));
      registry.register(makeTool({ name: "test.b" }));
      expect(registry.listTools()).toHaveLength(2);
    });
  });

  describe("listToolsByPermission", () => {
    it("should filter by permission scope", () => {
      registry.register(makeTool({ name: "test.ro", permission: "read_only" }));
      registry.register(makeTool({ name: "test.po", permission: "proposal_only" }));
      registry.register(makeTool({ name: "test.wd", permission: "write_direct" }));

      expect(registry.listToolsByPermission("read_only")).toHaveLength(1);
      expect(registry.listToolsByPermission("proposal_only")).toHaveLength(1);
      expect(registry.listToolsByPermission("write_direct")).toHaveLength(1);
    });
  });

  describe("call", () => {
    it("should call a tool and return result", async () => {
      registry.register(
        makeTool({
          name: "test.echo",
          permission: "read_only",
          handler: async (params) => ({
            status: "ok",
            resultType: "data",
            data: params.message,
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      const result = await registry.call("test.echo", { message: "hello" }, testActor);
      expect(result.status).toBe("ok");
      expect(result.data).toBe("hello");
    });

    it("should return error for non-existent tool", async () => {
      const result = await registry.call("nonexistent", {}, testActor);
      expect(result.status).toBe("error");
    });

    it("should validate required parameters", async () => {
      registry.register(makeTool({ name: "test.tool", permission: "read_only" }));
      const result = await registry.call("test.tool", {}, testActor);
      expect(result.status).toBe("error");
      expect(result.data).toContain("Missing required parameter");
    });

    it("should validate parameter types", async () => {
      registry.register(makeTool({ name: "test.tool", permission: "read_only" }));
      const result = await registry.call("test.tool", { message: 123 }, testActor);
      expect(result.status).toBe("error");
      expect(result.data).toContain("must be a string");
    });

    it("should set requiresUserConfirmation for proposal_only tools", async () => {
      registry.register(
        makeTool({
          name: "test.proposal",
          permission: "proposal_only",
          parameters: [],
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: undefined as unknown as boolean,
            auditRef: "",
          }),
        })
      );

      const result = await registry.call("test.proposal", {}, testActor);
      expect(result.requiresUserConfirmation).toBe(true);
    });

    it("should not force requiresUserConfirmation for read_only tools", async () => {
      registry.register(
        makeTool({
          name: "test.read",
          permission: "read_only",
          parameters: [],
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: undefined as unknown as boolean,
            auditRef: "",
          }),
        })
      );

      const result = await registry.call("test.read", {}, testActor);
      expect(result.requiresUserConfirmation).toBe(false);
    });

    it("should catch handler errors", async () => {
      registry.register(
        makeTool({
          name: "test.error",
          permission: "read_only",
          parameters: [],
          handler: async () => {
            throw new Error("handler failure");
          },
        })
      );

      const result = await registry.call("test.error", {}, testActor);
      expect(result.status).toBe("error");
      expect(result.data).toBe("handler failure");
    });
  });

  describe("onToolCall callback", () => {
    it("T01: call 成功 → onToolCall 收到 running + success 两条记录", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(
        makeTool({
          name: "test.echo",
          permission: "read_only",
          handler: async (params) => ({
            status: "ok",
            resultType: "data",
            data: params.message,
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      const result = await registry.call(
        "test.echo",
        { message: "hello" },
        testActor
      );

      expect(result.status).toBe("ok");
      expect(records).toHaveLength(2);

      const [running, success] = records;
      expect(running.status).toBe("running");
      expect(running.toolName).toBe("test.echo");
      expect(running.params).toEqual({ message: "hello" });
      expect(running.agentName).toBe("test-agent");
      expect(running.resultSummary).toBe("执行中");
      expect(running.id.length).toBeGreaterThan(0);
      expect(new Date(running.timestamp).getTime()).not.toBeNaN();

      expect(success.status).toBe("success");
      expect(success.toolName).toBe("test.echo");
      expect(success.params).toEqual({ message: "hello" });
      expect(success.agentName).toBe("test-agent");
      // success 摘要从 ToolResult.data 提取
      expect(success.resultSummary).toContain("hello");
    });

    it("T02: call 失败(工具不存在)→ onToolCall 收到 error 记录", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });

      const result = await registry.call("nonexistent", { foo: "bar" }, testActor);

      expect(result.status).toBe("error");
      expect(records).toHaveLength(1);

      const errorRecord = records[0];
      expect(errorRecord.status).toBe("error");
      expect(errorRecord.toolName).toBe("nonexistent");
      expect(errorRecord.params).toEqual({ foo: "bar" });
      expect(errorRecord.agentName).toBe("test-agent");
      expect(errorRecord.resultSummary).toContain("not found");
    });

    it("T03: 不传 onToolCall → 原行为不变(无回调调用)", async () => {
      // registry 已由 beforeEach 用无参构造创建
      registry.register(
        makeTool({
          name: "test.echo",
          permission: "read_only",
          handler: async (params) => ({
            status: "ok",
            resultType: "data",
            data: params.message,
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );
      const ok = await registry.call(
        "test.echo",
        { message: "hello" },
        testActor
      );
      expect(ok.status).toBe("ok");
      expect(ok.data).toBe("hello");
      // audit 照常记录
      expect(registry.getAuditTrail()).toHaveLength(1);
    });

    it("T04: 参数验证失败 → 只收到 error 记录(不 emit running)", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(makeTool({ name: "test.tool", permission: "read_only" }));

      const result = await registry.call("test.tool", {}, testActor);

      expect(result.status).toBe("error");
      expect(records).toHaveLength(1);
      expect(records[0].status).toBe("error");
      expect(records[0].resultSummary).toContain("Missing required parameter");
    });

    it("T05: handler 抛错 → onToolCall 收到 running + error 两条记录", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(
        makeTool({
          name: "test.error",
          permission: "read_only",
          parameters: [],
          handler: async () => {
            throw new Error("handler failure");
          },
        })
      );

      const result = await registry.call("test.error", {}, testActor);

      expect(result.status).toBe("error");
      expect(records).toHaveLength(2);
      expect(records[0].status).toBe("running");
      expect(records[1].status).toBe("error");
      expect(records[1].resultSummary).toBe("handler failure");
    });

    it("T06: 同一次调用 running 与 success 记录共享同一 correlationId", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(
        makeTool({
          name: "test.echo",
          permission: "read_only",
          handler: async (params) => ({
            status: "ok",
            resultType: "data",
            data: params.message,
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      const result = await registry.call(
        "test.echo",
        { message: "hello" },
        testActor
      );

      expect(result.status).toBe("ok");
      expect(records).toHaveLength(2);
      const [running, success] = records;
      expect(running.status).toBe("running");
      expect(success.status).toBe("success");
      // v1.13 Stage 2: both records carry the same per-invocation id so the
      // UI store can upsert the running entry in place.
      expect(running.correlationId).toBeDefined();
      expect(running.correlationId!.length).toBeGreaterThan(0);
      expect(running.correlationId).toBe(success.correlationId);
    });

    it("T07: 同一次调用 running 与 error 记录共享同一 correlationId(handler 抛错)", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(
        makeTool({
          name: "test.error",
          permission: "read_only",
          parameters: [],
          handler: async () => {
            throw new Error("handler failure");
          },
        })
      );

      await registry.call("test.error", {}, testActor);

      expect(records).toHaveLength(2);
      expect(records[0].status).toBe("running");
      expect(records[1].status).toBe("error");
      expect(records[0].correlationId).toBeDefined();
      expect(records[0].correlationId).toBe(records[1].correlationId);
    });

    it("T08: 验证失败的单条 error 记录也带 correlationId", async () => {
      const records: ToolCallRecord[] = [];
      registry = new ToolRegistry({ onToolCall: (r) => records.push(r) });
      registry.register(makeTool({ name: "test.tool", permission: "read_only" }));

      await registry.call("test.tool", {}, testActor);

      expect(records).toHaveLength(1);
      expect(records[0].status).toBe("error");
      expect(records[0].correlationId).toBeDefined();
      expect(records[0].correlationId!.length).toBeGreaterThan(0);
    });
  });

  describe("audit trail", () => {
    it("should record calls in audit trail", async () => {
      registry.register(
        makeTool({
          name: "test.audit",
          permission: "read_only",
          parameters: [
            { name: "value", type: "string", required: true, description: "test value" },
          ],
          handler: async (params) => ({
            status: "ok",
            resultType: "data",
            data: params.value,
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      await registry.call("test.audit", { value: "audit-test" }, testActor);

      const trail = registry.getAuditTrail();
      expect(trail).toHaveLength(1);
      expect(trail[0].toolName).toBe("test.audit");
      expect(trail[0].params).toEqual({ value: "audit-test" });
      expect(trail[0].actorName).toBe("test-agent");
      expect(trail[0].result.status).toBe("ok");
    });

    it("should record error calls in audit trail", async () => {
      await registry.call("nonexistent", { foo: "bar" }, testActor);

      const trail = registry.getAuditTrail();
      expect(trail).toHaveLength(1);
      expect(trail[0].result.status).toBe("error");
    });

    it("should filter audit by tool name", async () => {
      registry.register(
        makeTool({
          name: "test.a",
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );
      registry.register(
        makeTool({
          name: "test.b",
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      await registry.call("test.a", {}, testActor);
      await registry.call("test.b", {}, testActor);

      expect(registry.getAuditByTool("test.a")).toHaveLength(1);
      expect(registry.getAuditByTool("test.b")).toHaveLength(1);
    });

    it("should filter audit by actor name", async () => {
      registry.register(
        makeTool({
          name: "test.tool",
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      await registry.call("test.tool", {}, { type: "agent", name: "actor-a" });
      await registry.call("test.tool", {}, { type: "agent", name: "actor-b" });

      expect(registry.getAuditByActor("actor-a")).toHaveLength(1);
      expect(registry.getAuditByActor("actor-b")).toHaveLength(1);
    });

    it("should clear audit trail", async () => {
      registry.register(
        makeTool({
          name: "test.tool",
          handler: async () => ({
            status: "ok",
            requiresUserConfirmation: false,
            auditRef: "",
          }),
        })
      );

      await registry.call("test.tool", {}, testActor);
      expect(registry.getAuditTrail()).toHaveLength(1);

      registry.clearAudit();
      expect(registry.getAuditTrail()).toHaveLength(0);
    });
  });
});
