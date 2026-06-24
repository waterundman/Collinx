import { describe, it, expect } from "vitest";
import {
  FormRole,
  createSection,
  createFormStructure,
  addSectionToForm,
  removeSection,
  getSectionsByRole,
  getTotalBars,
  sectionToNode,
  nodeToSection,
} from "../section";

describe("createSection", () => {
  it("should create a section with required fields", () => {
    const s = createSection({ startBar: 1, endBar: 8 });
    expect(s.startBar).toBe(1);
    expect(s.endBar).toBe(8);
    expect(s.formRole).toBe(FormRole.Verse);
    expect(s.energyLevel).toBe(0.5);
    expect(s.motifIds).toEqual([]);
    expect(s.phraseIds).toEqual([]);
    expect(s.id).toBeTruthy();
  });

  it("should create a section with all custom fields", () => {
    const s = createSection({
      startBar: 5,
      endBar: 12,
      formRole: FormRole.Chorus,
      energyLevel: 0.8,
      name: "Big Chorus",
      motifIds: ["m1"],
      phraseIds: ["p1", "p2"],
      description: "the main hook",
    });
    expect(s.name).toBe("Big Chorus");
    expect(s.formRole).toBe(FormRole.Chorus);
    expect(s.energyLevel).toBe(0.8);
    expect(s.motifIds).toEqual(["m1"]);
    expect(s.phraseIds).toEqual(["p1", "p2"]);
    expect(s.description).toBe("the main hook");
  });

  it("should default energy level to 0.5", () => {
    const s = createSection({ startBar: 1, endBar: 4 });
    expect(s.energyLevel).toBe(0.5);
  });

  it("should generate auto name from bar range", () => {
    const s = createSection({ startBar: 3, endBar: 10 });
    expect(s.name).toBe("Section 3-10");
  });
});

describe("sectionToNode / nodeToSection", () => {
  it("should convert section to node and back", () => {
    const s = createSection({
      startBar: 1,
      endBar: 4,
      formRole: FormRole.Bridge,
      energyLevel: 0.6,
    });
    const node = sectionToNode(s);
    expect(node.type).toBe("Section");
    const restored = nodeToSection(node.data);
    expect(restored.id).toBe(s.id);
    expect(restored.formRole).toBe(FormRole.Bridge);
    expect(restored.energyLevel).toBe(0.6);
  });
});

describe("FormStructure", () => {
  it("should create a form structure with defaults", () => {
    const form = createFormStructure("My Form");
    expect(form.name).toBe("My Form");
    expect(form.sections).toEqual([]);
    expect(form.timeSignature).toEqual({ numerator: 4, denominator: 4 });
    expect(form.id).toBeTruthy();
    expect(form.createdAt).toBeTruthy();
  });

  it("should add sections sorted by startBar", () => {
    const form = createFormStructure("Test");
    const s2 = createSection({ startBar: 9, endBar: 16 });
    const s1 = createSection({ startBar: 1, endBar: 8 });
    addSectionToForm(form, s2);
    addSectionToForm(form, s1);
    expect(form.sections[0].startBar).toBe(1);
    expect(form.sections[1].startBar).toBe(9);
  });

  it("should remove a section by id", () => {
    const form = createFormStructure("Test");
    const s = createSection({ startBar: 1, endBar: 4 });
    addSectionToForm(form, s);
    expect(form.sections).toHaveLength(1);
    removeSection(form, s.id);
    expect(form.sections).toHaveLength(0);
  });

  it("should not remove sections with non-matching id", () => {
    const form = createFormStructure("Test");
    const s1 = createSection({ startBar: 1, endBar: 4 });
    const s2 = createSection({ startBar: 5, endBar: 8 });
    addSectionToForm(form, s1);
    addSectionToForm(form, s2);
    removeSection(form, "nonexistent");
    expect(form.sections).toHaveLength(2);
  });
});

describe("getSectionsByRole", () => {
  it("should filter sections by role", () => {
    const form = createFormStructure("Test");
    addSectionToForm(
      form,
      createSection({
        startBar: 1,
        endBar: 8,
        formRole: FormRole.Verse,
      })
    );
    addSectionToForm(
      form,
      createSection({
        startBar: 9,
        endBar: 16,
        formRole: FormRole.Chorus,
      })
    );
    addSectionToForm(
      form,
      createSection({
        startBar: 17,
        endBar: 24,
        formRole: FormRole.Verse,
      })
    );

    const verses = getSectionsByRole(form, FormRole.Verse);
    expect(verses).toHaveLength(2);
    expect(verses.every((s) => s.formRole === FormRole.Verse)).toBe(true);

    const choruses = getSectionsByRole(form, FormRole.Chorus);
    expect(choruses).toHaveLength(1);
  });

  it("should return empty array when no sections match", () => {
    const form = createFormStructure("Test");
    const result = getSectionsByRole(form, FormRole.Solo);
    expect(result).toEqual([]);
  });
});

describe("getTotalBars", () => {
  it("should return 0 for empty form", () => {
    const form = createFormStructure("Empty");
    expect(getTotalBars(form)).toBe(0);
  });

  it("should return max endBar", () => {
    const form = createFormStructure("Test");
    addSectionToForm(
      form,
      createSection({ startBar: 1, endBar: 8 })
    );
    addSectionToForm(
      form,
      createSection({ startBar: 9, endBar: 32 })
    );
    expect(getTotalBars(form)).toBe(32);
  });
});
