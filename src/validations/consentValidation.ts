import {z} from 'zod';

// Consent capture (PRD §9.1, §5.7.3, backend Phase 13). Only the user-acceptable types are
// postable here — REQUESTER_DECLARATION/CREATOR_DECLARATION are stamped server-side, inline,
// from requestService/recordingService (see those files), never directly by a client call.
export const ACCEPTABLE_CONSENT_TYPES = [
  'TERMS_OF_SERVICE',
  'PRIVACY_POLICY',
  'COMMUNITY_GUIDELINES',
  'RECORDING_POLICY',
] as const;

export const acceptConsentSchema = z.object({
  type: z.enum(ACCEPTABLE_CONSENT_TYPES),
});
