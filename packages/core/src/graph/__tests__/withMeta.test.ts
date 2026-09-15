import { describe, it, expect } from "vitest";
import { ProjectGraph } from "../project-graph";

describe("ProjectGraph.withMeta (Stage 0 v2.1.0)", () => {
  it("patches tempo_map immutably and leaves the source graph unchanged", () => {
    const g = ProjectGraph.create("t");
    const before = g.getMeta().tempo_map;
    const next = g.withMeta({
      tempo_map: [
        { bar: 1, bpm: 120 },
        { bar: 3, bpm: 90 },
      ],
    });

    expect(next).not.toBe(g);
    expect(next.getMeta().tempo_map).toEqual([
      { bar: 1, bpm: 120 },
      { bar: 3, bpm: 90 },
    ]);
    // source graph meta untouched
    expect(g.getMeta().tempo_map).toBe(before);
    expect(g.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
  });

  it("shallow-merges a partial patch, preserves id and revision_id", () => {
    const g = ProjectGraph.create("old-title");
    const id = g.getMeta().id;
    const rev = g.getRevisionId();

    const next = g.withMeta({
      title: "new-title",
      meter_map: [
        { bar: 1, numerator: 4, denominator: 4 },
        { bar: 2, numerator: 3, denominator: 4 },
      ],
    });

    // id preserved; revision_id PRESERVED too — withMeta follows the existing
    // mutation convention (addNode & friends never bump revisionId), so a
    // meta patch is not a revision bump. Locked by this assertion.
    expect(next.getMeta().id).toBe(id);
    expect(next.getRevisionId()).toBe(rev);
    expect(next.getMeta().title).toBe("new-title");
    // meter_map replaced wholesale, tempo_map carried over from base meta
    expect(next.getMeta().meter_map).toEqual([
      { bar: 1, numerator: 4, denominator: 4 },
      { bar: 2, numerator: 3, denominator: 4 },
    ]);
    expect(next.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 120 }]);
  });

  it("does not eagerly validate; duplicate-bar patch is accepted and validate() warns on demand", () => {
    // withMeta must NOT throw on a malformed (duplicate-bar) tempo_map; it
    // mirrors the constructor/fromJSON contract where validation is explicit.
    const g = ProjectGraph.create("t");
    const dup = g.withMeta({
      tempo_map: [
        { bar: 1, bpm: 120 },
        { bar: 1, bpm: 150 },
      ],
    });
    expect(dup.getMeta().tempo_map).toHaveLength(2);

    // Validation is still reachable on demand and flags the duplicate.
    const result = dup.validate();
    expect(result.warnings).toContain("Duplicate bar numbers in tempo_map");
    expect(result.valid).toBe(true); // duplicate is a warning, not an error
  });

  it("carries curve through withMeta (curve-bearing tempo_map passes the zod parse inside fromJSON)", () => {
    const g = ProjectGraph.create("t");
    const next = g.withMeta({
      tempo_map: [{ bar: 1, bpm: 120, curve: "linear" }],
    });
    // withMeta itself round-trips through ProjectGraphSchema.parse, so this
    // assertion proves the optional-curve schema addition: a curve-bearing
    // tempo_map entry survives the internal fromJSON (no silent strip).
    expect(next.getMeta().tempo_map[0]).toEqual({
      bar: 1,
      bpm: 120,
      curve: "linear",
    });
  });

  it("preserves ALL nodes and edges through withMeta (SEV1 regression gate)", () => {
    const g = ProjectGraph.create("t");
    const n1 = g.addNode("NoteSpan", { pitchMidi: 60, bar: 1, beat: 1 });
    const n2 = g.addNode("NoteSpan", { pitchMidi: 62, bar: 2, beat: 1 });
    g.addEdge("derived_from", n1.id, n2.id, { reason: "test" });

    const next = g.withMeta({ tempo_map: [{ bar: 1, bpm: 90 }] });
    const beforeJson = g.toJSON();
    const afterJson = next.toJSON();

    // nodes and edges survive the meta patch, byte-for-byte
    expect(afterJson.nodes).toEqual(beforeJson.nodes);
    expect(afterJson.edges).toEqual(beforeJson.edges);
    expect(next.getNodesByType("NoteSpan")).toHaveLength(2);
    expect(next.getAllEdges()).toHaveLength(1);
    // ...and the meta patch still landed
    expect(next.getMeta().tempo_map).toEqual([{ bar: 1, bpm: 90 }]);
  });
});
