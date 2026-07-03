import {env} from '../config/env';
import {logger} from '../config/logger';
import {HttpError} from '../utils/httpError';

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

const buildOtpHtml = (otp: string, expiresMinutes: number) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Locator – Email Verification</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);padding:36px 40px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:4px;color:#ffffff;">LOCATOR</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:1px;">EMAIL VERIFICATION</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e1b4b;">Verify your email address</p>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
                Thank you for creating a Locator account. Please use the one-time verification code below to complete your registration.
              </p>

              <!-- OTP box -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center" style="background:#f5f3ff;border:2px dashed #8b5cf6;border-radius:10px;padding:24px 16px;">
                    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#7c3aed;letter-spacing:2px;text-transform:uppercase;">Your verification code</p>
                    <p style="margin:0;font-size:40px;font-weight:900;letter-spacing:10px;color:#4f46e5;">${otp}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
                This code is valid for <strong style="color:#374151;">${expiresMinutes} minutes</strong>. Do not share this code with anyone.
                If you did not initiate this request, you can safely ignore this email.
              </p>

              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />

              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                This is an automated message from <strong>Locator</strong>. Please do not reply to this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${new Date().getFullYear()} Locator. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const buildPasswordResetOtpHtml = (otp: string, expiresMinutes: number) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Locator – Password Reset</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f9;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#f97316 0%,#ea580c 100%);padding:36px 40px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:900;letter-spacing:4px;color:#ffffff;">LOCATOR</p>
              <p style="margin:8px 0 0;font-size:13px;color:rgba(255,255,255,0.75);letter-spacing:1px;">PASSWORD RESET</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1e1b4b;">Reset your password</p>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
                We received a request to reset your Locator password. Use the code below to continue. If you did not request this, you can safely ignore this email.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td align="center" style="background:#fff7ed;border:2px dashed #f97316;border-radius:10px;padding:24px 16px;">
                    <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#ea580c;letter-spacing:2px;text-transform:uppercase;">Your reset code</p>
                    <p style="margin:0;font-size:40px;font-weight:900;letter-spacing:10px;color:#c2410c;">${otp}</p>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 28px;font-size:14px;color:#6b7280;line-height:1.6;">
                This code is valid for <strong style="color:#374151;">${expiresMinutes} minutes</strong>. Do not share this code with anyone.
              </p>
              <hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 24px;" />
              <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">
                This is an automated message from <strong>Locator</strong>. Please do not reply to this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                &copy; ${new Date().getFullYear()} Locator. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;

const CLIENT_SEND_FAILURE_MESSAGE =
  "We couldn't send the verification email right now due to an email provider issue. Please try again shortly.";

function logBrevoFailure(context: string, status: number | undefined, body: string) {
  const keyConfigured = Boolean(env.BREVO_API_KEY);
  const senderConfigured = Boolean(env.BREVO_SENDER_EMAIL);

  if (status === 401) {
    logger.error(
      `[mailService.${context}] Brevo rejected the request with 401 Unauthorized. ` +
        `api_key_configured=${keyConfigured} sender_configured=${senderConfigured}. ` +
        'This almost always means either (a) the BREVO_API_KEY is invalid/revoked, or ' +
        "(b) Brevo's Authorized IP restriction is blocking this server's outbound IP. " +
        'Check Brevo dashboard > SMTP & API > API Keys > Authorized IPs and either add this ' +
        'server IP or disable IP restriction, and confirm the sender email is verified. ' +
        `Brevo response body: ${body}`,
    );
    return;
  }

  logger.error(
    `[mailService.${context}] Brevo API request failed. status=${status ?? 'unknown'} ` +
      `api_key_configured=${keyConfigured} sender_configured=${senderConfigured} body=${body}`,
  );
}

/**
 * Read-only check against Brevo's account endpoint. Does not send mail.
 * Used for startup diagnostics only — never logs the raw API key.
 */
export async function checkBrevoConnectivity(): Promise<
  {ok: true} | {ok: false; status?: number; reason: string}
> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
    return {ok: false, reason: 'BREVO_API_KEY or BREVO_SENDER_EMAIL not configured'};
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/account', {
      method: 'GET',
      headers: {'api-key': env.BREVO_API_KEY, Accept: 'application/json'},
    });

    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        reason:
          'Brevo returned 401 Unauthorized — API key is invalid/revoked, or the Authorized ' +
          "IP restriction is blocking this server's outbound IP.",
      };
    }

    if (!res.ok) {
      return {ok: false, status: res.status, reason: `Brevo account check failed with status ${res.status}`};
    }

    return {ok: true};
  } catch (err) {
    return {ok: false, reason: `Network error reaching Brevo: ${(err as Error).message}`};
  }
}

export const mailService = {
  async sendRegistrationOtp(email: string, otp: string) {
    logger.debug(`[mailService.sendRegistrationOtp] BREVO_API_KEY configured=${Boolean(env.BREVO_API_KEY)} sender=${env.BREVO_SENDER_EMAIL ?? 'unset'}`);
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
      if (env.NODE_ENV === 'production') {
        throw new HttpError(500, 'Email service is not configured.');
      }
      logger.info(`[DEV] Registration OTP for ${email}: ${otp}`);
      return;
    }

    const payload = {
      sender: {name: 'Locator', email: env.BREVO_SENDER_EMAIL},
      to: [{email}],
      subject: 'Your Locator Verification Code',
      textContent: `Your Locator verification code is ${otp}. It expires in ${env.OTP_EXPIRES_MINUTES} minutes. Do not share this code with anyone.`,
      htmlContent: buildOtpHtml(otp, env.OTP_EXPIRES_MINUTES),
    };

    try {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        logBrevoFailure('sendRegistrationOtp', res.status, body);
        throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
      }

      logger.info(`OTP email sent to ${email}`);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      logger.error(`[mailService.sendRegistrationOtp] Network error sending OTP email to ${email}: ${(err as Error).message}`);
      throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
    }
  },

  async sendPasswordResetOtp(email: string, otp: string) {
    if (!env.BREVO_API_KEY || !env.BREVO_SENDER_EMAIL) {
      if (env.NODE_ENV === 'production') {
        throw new HttpError(500, 'Email service is not configured.');
      }
      logger.info(`[DEV] Password reset OTP for ${email}: ${otp}`);
      return;
    }

    const payload = {
      sender: {name: 'Locator', email: env.BREVO_SENDER_EMAIL},
      to: [{email}],
      subject: 'Your Locator Password Reset Code',
      textContent: `Your Locator password reset code is ${otp}. It expires in ${env.OTP_EXPIRES_MINUTES} minutes. Do not share this code with anyone.`,
      htmlContent: buildPasswordResetOtpHtml(otp, env.OTP_EXPIRES_MINUTES),
    };

    try {
      const res = await fetch(BREVO_API_URL, {
        method: 'POST',
        headers: {
          'api-key': env.BREVO_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text();
        logBrevoFailure('sendPasswordResetOtp', res.status, body);
        throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
      }

      logger.info(`Password reset OTP email sent to ${email}`);
    } catch (err) {
      if (err instanceof HttpError) {
        throw err;
      }
      logger.error(`[mailService.sendPasswordResetOtp] Network error sending reset email to ${email}: ${(err as Error).message}`);
      throw new HttpError(500, CLIENT_SEND_FAILURE_MESSAGE);
    }
  },
};
