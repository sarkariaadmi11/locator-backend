import {z} from 'zod';

// Moderation Toggle (PRD §5.9.0, backend Phase 5) — every field change requires a mandatory
// reason, written to the Audit Log (mirrors every other Admin-mutating-setting convention in
// this codebase, e.g. complianceConfigUpdateSchema/refundSchema).
export const setModerationToggleSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().min(1, 'A reason is required for this change.').max(500),
});

// v2.1 Feature Flags / Economy Settings generic setter (PRD §5.14.11, backend Phase 6). `value`
// accepts either type since the same route serves both boolean flags and numeric economy
// values — `adminSettingsController.setSetting` picks the right coercion by key.
export const settingsKeyParamsSchema = z.object({
  key: z.string().min(1),
});

export const setSettingSchema = z.object({
  value: z.union([z.number(), z.boolean()]),
  reason: z.string().trim().min(1, 'A reason is required for this change.').max(500),
});

// Launch-Stage Presets (PRD §5.14.11) — preview needs no body (read-only); apply requires the
// same mandatory-reason convention as every other settings mutation.
export const presetNameParamsSchema = z.object({
  name: z.string().min(1),
});

export const applyPresetSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required for this change.').max(500),
});
