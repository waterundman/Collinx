import { describe, it, expect } from "vitest";
import { randomUUID } from "../random-uuid";

describe("randomUUID", () => {
  it("should return a non-empty string", () => {
    const uuid = randomUUID();
    expect(uuid).toBeDefined();
    expect(typeof uuid).toBe("string");
    expect(uuid.length).toBeGreaterThan(0);
  });

  it("should return a string of length 36", () => {
    const uuid = randomUUID();
    expect(uuid.length).toBe(36);
  });

  it("should match standard UUID v4 format xxxxxxxx-xxxx-4xxx-xxxx-xxxxxxxxxxxx", () => {
    const uuid = randomUUID();
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidV4Regex);
  });

  it("should produce unique values across multiple calls", () => {
    const uuids = new Set<string>();
    const iterations = 100;
    for (let i = 0; i < iterations; i++) {
      uuids.add(randomUUID());
    }
    expect(uuids.size).toBe(iterations);
  });

  it("should produce lowercase hex characters", () => {
    const uuid = randomUUID();
    expect(uuid).toBe(uuid.toLowerCase());
    expect(uuid).not.toMatch(/[ghijklmnopqrstuvwxyz]/i);
  });

  it("should have 4 at position 14 in the third group (UUID v4 variant)", () => {
    const uuid = randomUUID();
    expect(uuid[14]).toBe("4");
  });

  it("should have valid variant bits (8/9/a/b) at position 19", () => {
    const uuid = randomUUID();
    expect(["8", "9", "a", "b"]).toContain(uuid[19]);
  });
});
