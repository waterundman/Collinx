import { z } from "zod";
import { FormRole } from "./form-role";

export const NoteEventSchema = z.object({
  id: z.string(),
  trackId: z.string(),
  phraseId: z.string().nullable(),
  bar: z.number().int().positive(),
  beat: z.number().positive(),
  durQn: z.number().positive(),
  pitchMidi: z.number().int().min(0).max(127),
  pitchSpelling: z.string(),
  velocity: z.number().min(0).max(1),
  voice: z.string(),
  tags: z.array(z.string()),
});

export const MotifDataSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  bars: z.number().int().positive(),
  instrumentRole: z.string(),
  tags: z.array(z.string()),
  noteIds: z.array(z.string()),
});

export const PhraseDataSchema = z.object({
  name: z.string(),
  formRole: z.string(),
  startBar: z.number().int().positive(),
  endBar: z.number().int().positive(),
  motifIds: z.array(z.string()),
  harmonyPlanRef: z.string().optional(),
});

export const SectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  formRole: z.nativeEnum(FormRole),
  startBar: z.number().int().positive(),
  endBar: z.number().int().positive(),
  energyLevel: z.number().min(0).max(1),
  motifIds: z.array(z.string()),
  phraseIds: z.array(z.string()),
  description: z.string().optional(),
});

export const MixerChangeSchema = z.object({
  trackId: z.string(),
  changes: z.object({
    gainDb: z.string().optional(),
    pan: z.string().optional(),
    mute: z.boolean().optional(),
    solo: z.boolean().optional(),
  }),
  fxChanges: z.array(z.object({
    slotIndex: z.number().int().nonnegative(),
    changes: z.record(z.unknown()),
  })).optional(),
  sendChanges: z.array(z.object({
    index: z.number().int().nonnegative(),
    changes: z.record(z.unknown()),
  })).optional(),
});
