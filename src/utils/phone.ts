import {HttpError} from './httpError';

// Indian mobile numbers only (PRD §1 "Geography: India", §5.1 "Phone Validation"): 10 digits,
// starting 6-9, optionally prefixed with +91 or 91. Normalizes to E.164 (`+91XXXXXXXXXX`) for
// storage so `User.phone` / `PhoneOtp.phone` always compare equal regardless of how the client
// formatted the input.
const INDIAN_MOBILE_REGEX = /^(?:\+?91)?([6-9]\d{9})$/;

export const normalizePhone = (raw: string): string => {
  const trimmed = raw.trim().replace(/[\s-]/g, '');
  const match = INDIAN_MOBILE_REGEX.exec(trimmed);
  if (!match) {
    throw new HttpError(400, 'Please enter a valid 10-digit Indian mobile number.');
  }
  return `+91${match[1]}`;
};
