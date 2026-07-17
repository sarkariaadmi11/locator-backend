import {env} from '../config/env';
import {logger} from '../config/logger';
import {HttpError} from '../utils/httpError';

const MSG91_API_URL = 'https://control.msg91.com/api/v5/otp';

const CLIENT_SEND_FAILURE_MESSAGE =
  "We couldn't send the verification SMS right now due to an SMS provider issue. Please try again shortly.";

function logMsg91Failure(context: string, status: number | undefined, body: string) {
  logger.error(
    `[smsService.${context}] MSG91 API request failed. status=${status ?? 'unknown'} ` +
      `auth_key_configured=${Boolean(env.MSG91_AUTH_KEY)} sender_configured=${Boolean(env.MSG91_SENDER_ID)} body=${body}`,
  );
}

/**
 * Phone OTP delivery (PRD §5.1.1, §12.2 "SMS/OTP Gateway (e.g. MSG91, Twilio)"). Falls back to
 * console-logged OTPs outside production so local/dev/test environments never need real MSG91
 * credentials (see also `MOCK_OTP` in config/env.ts for a fixed-code dev shortcut).
 */
export const smsService = {
  async sendPhoneOtp(phone: string, otp: string, expiresSeconds: number) {
    logger.debug(
      `[smsService.sendPhoneOtp] MSG91_AUTH_KEY configured=${Boolean(env.MSG91_AUTH_KEY)} sender=${env.MSG91_SENDER_ID ?? 'unset'}`,
    );

    if (!env.MSG91_AUTH_KEY || !env.MSG91_SENDER_ID) {
      if (env.NODE_ENV === 'production') {
        throw new HttpError(500, 'SMS service is not configured.');
      }
      logger.info(`[DEV] Phone OTP for ${phone}: ${otp} (expires in ${expiresSeconds}s)`);
      return;
    }

    const params = new URLSearchParams({
      otp,
      mobile: phone.startsWith('+') ? phone.slice(1) : `91${phone}`,
      sender: env.MSG91_SENDER_ID,
      otp_expiry: String(Math.ceil(expiresSeconds / 60)),
    });
    if (env.MSG91_OTP_TEMPLATE_ID) {
      params.set('template_id', env.MSG91_OTP_TEMPLATE_ID);
    }

    try {
      const res = await fetch(`${MSG91_API_URL}?${params.toString()}`, {
        method: 'POST',
        headers: {authkey: env.MSG91_AUTH_KEY, Accept: 'application/json'},
      });

      if (!res.ok) {
        const body = await res.text();
        logMsg91Failure('sendPhoneOtp', res.status, body);
        throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
      }

      logger.info(`Phone OTP SMS sent to ${phone}`);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      logger.error(`[smsService.sendPhoneOtp] Network error sending OTP SMS to ${phone}: ${(err as Error).message}`);
      throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
    }
  },
};
