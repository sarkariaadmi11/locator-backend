import {ConsentType} from '@prisma/client';

import {logger} from '../config/logger';
import {consentRecordRepository} from '../repositories/consentRecordRepository';
import {userRepository} from '../repositories/userRepository';
import {presentConsentRecord} from '../utils/consentPresenter';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';

/** Only the four first-login/re-consent document types have a versioned config key. */
const VERSION_KEY_BY_TYPE: Partial<Record<ConsentType, (typeof ComplianceConfigKey)[keyof typeof ComplianceConfigKey]>> = {
  TERMS_OF_SERVICE: ComplianceConfigKey.TERMS_OF_SERVICE_VERSION,
  PRIVACY_POLICY: ComplianceConfigKey.PRIVACY_POLICY_VERSION,
  COMMUNITY_GUIDELINES: ComplianceConfigKey.COMMUNITY_GUIDELINES_VERSION,
  RECORDING_POLICY: ComplianceConfigKey.RECORDING_POLICY_VERSION,
};

// Per-request Requester/Creator declarations (PRD §5.3/§5.6) are a checkbox re-affirmed on every
// request/recording, not a versioned document — there is nothing to "re-accept" a newer version
// of, so they're stamped with a fixed placeholder version rather than a ComplianceConfig lookup.
const DECLARATION_VERSION = '1';

/**
 * Consent capture (PRD §9.1, §5.7.3, backend Phase 13). `ConsentRecord` rows are immutable —
 * insert-only, never updated/deleted anywhere in this codebase (PRD's explicit requirement).
 */
export const consentService = {
  async accept(
    userId: string,
    type: ConsentType,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ) {
    const versionKey = VERSION_KEY_BY_TYPE[type];
    const version = versionKey ? await complianceConfigService.getString(versionKey) : DECLARATION_VERSION;

    const record = await consentRecordRepository.create({
      user: {connect: {id: userId}},
      type,
      version,
      ipAddress: ipAddress ?? null,
      userAgent: userAgent ?? null,
    });

    return presentConsentRecord(record);
  },

  /**
   * Best-effort, additive hook called from `requestService.create` (REQUESTER_DECLARATION) and
   * `recordingService.start` (CREATOR_DECLARATION) — alongside, not instead of, the existing
   * `Request.requesterDeclarationAt`/`creatorDeclarationAt` timestamp fields those services
   * already stamp. Never throws — a logging failure here must not block request creation or
   * recording start, both of which are fully working, already-shipped flows.
   */
  async recordDeclaration(userId: string, type: 'REQUESTER_DECLARATION' | 'CREATOR_DECLARATION', requestId: string) {
    try {
      await consentRecordRepository.create({
        user: {connect: {id: userId}},
        type,
        version: DECLARATION_VERSION,
        request: {connect: {id: requestId}},
      });
    } catch (err) {
      logger.error(`[consentService.recordDeclaration] Failed to log ${type} for request=${requestId}: ${(err as Error).message}`);
    }
  },

  async status(userId: string) {
    const types = Object.keys(VERSION_KEY_BY_TYPE) as ConsentType[];
    const results = await Promise.all(
      types.map(async type => {
        const versionKey = VERSION_KEY_BY_TYPE[type]!;
        const [latest, currentVersion] = await Promise.all([
          consentRecordRepository.findLatestByType(userId, type),
          complianceConfigService.getString(versionKey),
        ]);
        return {
          type,
          currentVersion,
          acceptedVersion: latest?.version ?? null,
          acceptedAt: latest?.acceptedAt.toISOString() ?? null,
          needsReacceptance: latest?.version !== currentVersion,
        };
      }),
    );
    return {
      consents: results,
      needsAnyReacceptance: results.some(r => r.needsReacceptance),
    };
  },

  async history(userId: string) {
    const records = await consentRecordRepository.findAllForUser(userId);
    return records.map(presentConsentRecord);
  },

  /**
   * `POST /account/welcome-video-ack` (PRD §5.11b.3) — mobile calls this once it has re-shown
   * the welcome video after `User.welcomeVideoRepromptPending` flipped true (3 consecutive
   * Requester rejections — see `requesterReviewService.reject`), clearing the flag so the video
   * doesn't reappear on every subsequent app open.
   */
  async acknowledgeWelcomeVideoReprompt(userId: string) {
    await userRepository.update(userId, {welcomeVideoRepromptPending: false});
  },
};
