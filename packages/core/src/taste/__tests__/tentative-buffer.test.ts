import { describe, it, expect, beforeEach } from "vitest";
import { TentativeBuffer, PendingEvidence } from "../tentative-buffer";
import { TasteEvidence } from "../taste-types";

function makeEvidence(overrides: Partial<TasteEvidence> = {}): TasteEvidence {
  return {
    id: "evt-001",
    type: "ab_listen_choice",
    paramKey: "rhythm.syncopation",
    pointEstimate: "0.75",
    context: {},
    sourceQuality: 0.8,
    timestamp: new Date().toISOString(),
    ref: "export-abc",
    confirmed: false,
    ...overrides,
  };
}

describe("TentativeBuffer", () => {
  let buffer: TentativeBuffer;

  beforeEach(() => {
    buffer = new TentativeBuffer();
  });

  describe("addEvidence", () => {
    it("should add evidence with pending status", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      const pending = buffer.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].status).toBe("pending");
      expect(pending[0].evidence.id).toBe("evt-001");
    });

    it("should set addedAt and expiresAt on add", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      const pending = buffer.getPending();
      expect(pending[0].addedAt).toBeDefined();
      expect(pending[0].expiresAt).toBeDefined();

      const addedDate = new Date(pending[0].addedAt);
      const expireDate = new Date(pending[0].expiresAt);
      const diffDays =
        (expireDate.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(30);
    });

    it("should respect custom TTL", () => {
      const customBuffer = new TentativeBuffer(7);
      const evidence = makeEvidence({ id: "evt-custom" });
      customBuffer.addEvidence(evidence);

      const pending = customBuffer.getPending();
      const addedDate = new Date(pending[0].addedAt);
      const expireDate = new Date(pending[0].expiresAt);
      const diffDays =
        (expireDate.getTime() - addedDate.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diffDays)).toBe(7);
    });
  });

  describe("promote", () => {
    it("should promote pending evidence", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      const promoted = buffer.promote("evt-001");
      expect(promoted).not.toBeNull();
      expect(promoted!.id).toBe("evt-001");

      const pending = buffer.getPending();
      expect(pending).toHaveLength(0);
    });

    it("should set status to promoted and record promotedAt", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      buffer.promote("evt-001");

      const all = buffer.getByParamKey("rhythm.syncopation");
      const promoted = all.find((p) => p.status === "promoted");
      expect(promoted).toBeDefined();
      expect(promoted!.promotedAt).toBeDefined();
    });

    it("should return null for already promoted evidence", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);
      buffer.promote("evt-001");

      const secondPromote = buffer.promote("evt-001");
      expect(secondPromote).toBeNull();
    });

    it("should return null for non-existent evidence", () => {
      const result = buffer.promote("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("dismiss", () => {
    it("should dismiss pending evidence", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      buffer.dismiss("evt-001");

      const pending = buffer.getPending();
      expect(pending).toHaveLength(0);
    });

    it("should record dismissedAt", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      buffer.dismiss("evt-001");

      const all = buffer.getByParamKey("rhythm.syncopation");
      const dismissed = all.find((p) => p.status === "dismissed");
      expect(dismissed).toBeDefined();
      expect(dismissed!.dismissedAt).toBeDefined();
    });

    it("should not throw for non-existent evidence", () => {
      buffer.dismiss("nonexistent");
      // should not throw
    });
  });

  describe("cleanExpired", () => {
    it("should expire evidence past TTL", () => {
      const evidence = makeEvidence({ id: "evt-old" });
      buffer.addEvidence(evidence);

      // Manually set expiresAt to a past date
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      const entries = buffer.toJSON() as {
        entries: { id: string; expiresAt: string }[];
      };
      const entry = entries.entries.find((e) => e.id === "evt-old");
      // Inject past into internal map via fromJSON round-trip hack
      const json = buffer.toJSON() as {
        defaultTtlDays: number;
        entries: {
          id: string;
          evidence: TasteEvidence;
          addedAt: string;
          expiresAt: string;
          status: string;
        }[];
      };
      json.entries[0].expiresAt = pastDate.toISOString();

      const restored = TentativeBuffer.fromJSON(json);
      const cleaned = restored.cleanExpired();

      expect(cleaned).toBe(1);
      expect(restored.countPending()).toBe(0);
    });

    it("should not expire pending evidence within TTL", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);

      const cleaned = buffer.cleanExpired();
      expect(cleaned).toBe(0);
      expect(buffer.countPending()).toBe(1);
    });

    it("should not count already promoted as cleaned", () => {
      const evidence = makeEvidence();
      buffer.addEvidence(evidence);
      buffer.promote("evt-001");

      const cleaned = buffer.cleanExpired();
      expect(cleaned).toBe(0);
    });
  });

  describe("getPending", () => {
    it("should return only pending evidence", () => {
      buffer.addEvidence(makeEvidence({ id: "evt-1" }));
      buffer.addEvidence(makeEvidence({ id: "evt-2" }));
      buffer.dismiss("evt-1");

      const pending = buffer.getPending();
      expect(pending).toHaveLength(1);
      expect(pending[0].evidence.id).toBe("evt-2");
    });
  });

  describe("getByParamKey", () => {
    it("should filter by paramKey", () => {
      buffer.addEvidence(
        makeEvidence({ id: "evt-1", paramKey: "rhythm.syncopation" })
      );
      buffer.addEvidence(
        makeEvidence({ id: "evt-2", paramKey: "rhythm.syncopation" })
      );
      buffer.addEvidence(
        makeEvidence({ id: "evt-3", paramKey: "mix.reverb_amount" })
      );

      const rhythmEvidences = buffer.getByParamKey("rhythm.syncopation");
      expect(rhythmEvidences).toHaveLength(2);

      const mixEvidences = buffer.getByParamKey("mix.reverb_amount");
      expect(mixEvidences).toHaveLength(1);
    });

    it("should return empty array for unknown paramKey", () => {
      const result = buffer.getByParamKey("nonexistent.key");
      expect(result).toHaveLength(0);
    });
  });

  describe("counting", () => {
    it("should count total entries", () => {
      expect(buffer.count()).toBe(0);
      buffer.addEvidence(makeEvidence({ id: "evt-1" }));
      buffer.addEvidence(makeEvidence({ id: "evt-2" }));
      expect(buffer.count()).toBe(2);
    });

    it("should count only pending entries", () => {
      buffer.addEvidence(makeEvidence({ id: "evt-1" }));
      buffer.addEvidence(makeEvidence({ id: "evt-2" }));
      buffer.dismiss("evt-1");

      expect(buffer.count()).toBe(2);
      expect(buffer.countPending()).toBe(1);
    });
  });

  describe("serialization (toJSON / fromJSON)", () => {
    it("should round-trip preserve all entries", () => {
      buffer.addEvidence(makeEvidence({ id: "evt-1", paramKey: "rhythm.syncopation" }));
      buffer.addEvidence(makeEvidence({ id: "evt-2", paramKey: "mix.reverb_amount" }));
      buffer.promote("evt-1");

      const json = buffer.toJSON();
      const restored = TentativeBuffer.fromJSON(json);

      expect(restored.count()).toBe(2);
      expect(restored.countPending()).toBe(1);
      expect(restored.getByParamKey("rhythm.syncopation")).toHaveLength(1);
      expect(restored.getByParamKey("mix.reverb_amount")).toHaveLength(1);

      const sync = restored.getByParamKey("rhythm.syncopation")[0];
      expect(sync.status).toBe("promoted");
      expect(sync.promotedAt).toBeDefined();
    });

    it("should handle empty buffer serialization", () => {
      const json = buffer.toJSON();
      const restored = TentativeBuffer.fromJSON(json);
      expect(restored.count()).toBe(0);
    });

    it("should preserve custom TTL in round-trip", () => {
      const customBuffer = new TentativeBuffer(14);
      const json = customBuffer.toJSON();
      const data = json as { defaultTtlDays: number };
      expect(data.defaultTtlDays).toBe(14);
    });
  });

  describe("multiple parameters and evidence", () => {
    it("should handle multiple evidence for different params", () => {
      const params = ["rhythm.syncopation", "mix.reverb_amount", "timbre.brightness"];
      for (let i = 0; i < params.length; i++) {
        buffer.addEvidence(
          makeEvidence({ id: `evt-${i}`, paramKey: params[i] })
        );
      }

      expect(buffer.countPending()).toBe(3);
      expect(buffer.getByParamKey("rhythm.syncopation")).toHaveLength(1);
      expect(buffer.getByParamKey("mix.reverb_amount")).toHaveLength(1);
      expect(buffer.getByParamKey("timbre.brightness")).toHaveLength(1);
    });

    it("should handle multiple evidence for same param", () => {
      buffer.addEvidence(
        makeEvidence({ id: "evt-a", paramKey: "rhythm.syncopation" })
      );
      buffer.addEvidence(
        makeEvidence({ id: "evt-b", paramKey: "rhythm.syncopation" })
      );
      buffer.addEvidence(
        makeEvidence({ id: "evt-c", paramKey: "rhythm.syncopation" })
      );

      expect(buffer.countPending()).toBe(3);
      expect(buffer.getByParamKey("rhythm.syncopation")).toHaveLength(3);
    });
  });
});
