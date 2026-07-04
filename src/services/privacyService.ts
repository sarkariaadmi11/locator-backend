import {accountDeletionService} from './accountDeletionService';
import {ComplianceConfigKey, complianceConfigService} from './complianceConfigService';
import {consentService} from './consentService';

/**
 * Privacy Settings hub (backend Phase 13) — a read-only aggregator over consent status, account
 * deletion status, and the user-facing subset of retention windows, so mobile's Privacy Settings
 * screen can load in one call. Notification-preference toggles are deliberately **not**
 * duplicated here — they already have their own `GET`/`PATCH /notifications/preferences`
 * endpoints (backend Phase 12); this aggregator links out to that existing surface rather than
 * re-implementing it.
 */
export const privacyService = {
  async getSettings(userId: string) {
    const [consent, deletion, chatRetentionDays, videoFulfilledHours, videoTerminalHours, deletionGraceDays] =
      await Promise.all([
        consentService.status(userId),
        accountDeletionService.status(userId),
        complianceConfigService.getNumber(ComplianceConfigKey.CHAT_RETENTION_DAYS),
        complianceConfigService.getNumber(ComplianceConfigKey.VIDEO_FULFILLED_RETENTION_HOURS),
        complianceConfigService.getNumber(ComplianceConfigKey.VIDEO_TERMINAL_RETENTION_HOURS),
        complianceConfigService.getNumber(ComplianceConfigKey.ACCOUNT_DELETION_GRACE_DAYS),
      ]);

    return {
      consent,
      accountDeletion: deletion,
      retention: {
        chatRetentionDays,
        videoFulfilledRetentionHours: videoFulfilledHours,
        videoTerminalRetentionHours: videoTerminalHours,
        accountDeletionGraceDays: deletionGraceDays,
      },
    };
  },
};
