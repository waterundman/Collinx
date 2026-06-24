import { TasteGenome } from "./taste-genome";
import { TasteParameter } from "./taste-types";

export class ProjectTasteOverlay {
  private overrides: Map<string, string>;
  private projectId: string;

  constructor(projectId: string) {
    this.overrides = new Map();
    this.projectId = projectId;
  }

  set(paramKey: string, value: string): void {
    this.overrides.set(paramKey, value);
  }

  get(paramKey: string): string | undefined {
    return this.overrides.get(paramKey);
  }

  remove(paramKey: string): void {
    this.overrides.delete(paramKey);
  }

  has(paramKey: string): boolean {
    return this.overrides.has(paramKey);
  }

  getAll(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [key, value] of this.overrides) {
      result[key] = value;
    }
    return result;
  }

  applyTo(genome: TasteGenome): TasteGenome {
    const overlay = this.getAll();
    if (Object.keys(overlay).length === 0) {
      return genome.clone();
    }
    return genome.getEffectiveGenome(overlay);
  }

  discard(): void {
    this.overrides.clear();
  }

  mergeToGenome(genome: TasteGenome): TasteGenome {
    const target = genome.clone();

    for (const [key, value] of this.overrides) {
      const param = target.getParameter(key);
      if (param) {
        target.setParameter(key, {
          ...param,
          value,
        });
      }
    }

    return target;
  }

  toJSON(): object {
    const entries = Array.from(this.overrides.entries());
    return {
      projectId: this.projectId,
      overrides: Object.fromEntries(entries),
    };
  }

  static fromJSON(json: unknown, projectId: string): ProjectTasteOverlay {
    const data = json as {
      projectId?: string;
      overrides?: Record<string, string>;
    };

    const overlay = new ProjectTasteOverlay(projectId);

    if (data.overrides) {
      for (const [key, value] of Object.entries(data.overrides)) {
        overlay.set(key, value);
      }
    }

    return overlay;
  }
}
