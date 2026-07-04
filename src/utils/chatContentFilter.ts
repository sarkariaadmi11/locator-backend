// Server-side chat content filter (PRD §5.4.2). Must run here, not just client-side, since
// blocked attempts are logged for moderation audit regardless of whether they were delivered.
// NOTE: the PRD's exact user-facing rejection string wasn't available in this environment —
// CHAT_BLOCKED_MESSAGE below is an interim, clearly-flagged placeholder pending client
// confirmation (see docs/API.md "Temporary Chat"), same pattern already used elsewhere in this
// codebase for other undocumented exact PRD strings.
export const CHAT_BLOCKED_MESSAGE =
  'Sharing contact details or external links is not allowed in chat.';

export type ChatBlockReason =
  | 'PHONE_NUMBER'
  | 'EMAIL'
  | 'SOCIAL_HANDLE'
  | 'UPI_VPA'
  | 'URL';

const PATTERNS: Array<{reason: ChatBlockReason; regex: RegExp}> = [
  // Indian mobile numbers, with or without a +91/91 prefix, optionally spaced/dashed.
  {reason: 'PHONE_NUMBER', regex: /(?:\+?91[\s-]?)?[6-9]\d{9}\b/},
  // UPI VPAs — checked before the generic email pattern since both contain "@".
  {reason: 'UPI_VPA', regex: /[a-z0-9.\-_]{2,}@(ok[a-z]+|ybl|upi|paytm|apl|ibl|axl|yapl|jio)\b/i},
  {reason: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/},
  {reason: 'SOCIAL_HANDLE', regex: /whats\s*app|wa\.me|t\.me|telegram|instagram|\binsta\b/i},
  {reason: 'URL', regex: /https?:\/\/\S+|www\.\S+|\b[a-z0-9-]+\.(com|in|net|org|io|co)\b/i},
];

export function checkChatContent(body: string): {blocked: boolean; reason?: ChatBlockReason} {
  for (const {reason, regex} of PATTERNS) {
    if (regex.test(body)) {
      return {blocked: true, reason};
    }
  }
  return {blocked: false};
}
