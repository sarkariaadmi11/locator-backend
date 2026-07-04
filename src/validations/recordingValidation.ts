import {z} from 'zod';

// Recording & Upload pipeline (PRD §5.6, §4.4, backend Phase 5).
export const MAX_UPLOAD_ATTEMPTS = 3;
// Encoder/rounding tolerance either side of the Requester's selected duration — the PRD only
// specifies a *minimum*-duration rejection ("Stream too short"); a maximum is this milestone's
// own quality validation (explicitly requested), not a PRD-cited number.
export const VIDEO_DURATION_MIN_TOLERANCE_SECONDS = 2;
export const VIDEO_DURATION_MAX_GRACE_SECONDS = 30;

export const startRecordingSchema = z.object({
  declaration: z.literal(true, {
    message: 'You must confirm you have the legal right to record here before starting.',
  }),
});

export const requestVideoIdParamsSchema = z.object({
  id: z.string().min(1),
  videoId: z.string().min(1),
});

export const completeVideoUploadSchema = z.object({
  gpsLatitude: z.coerce.number().min(-90).max(90),
  gpsLongitude: z.coerce.number().min(-180).max(180),
  recordedAt: z.coerce.date(),
  durationSeconds: z.coerce.number().positive(),
});
