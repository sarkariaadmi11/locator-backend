import {userRepository} from '../repositories/userRepository';
import {requestRepository} from '../repositories/requestRepository';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {dataDeletionLogRepository} from '../repositories/dataDeletionLogRepository';
import {HttpError} from '../utils/httpError';
import {presentUser} from '../utils/userPresenter';
import {TERMINAL_STATUSES} from './requestStateMachine';
import {complianceConfigService, ComplianceConfigKey} from './complianceConfigService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/**
 * Account Deletion workflow (PRD §9, backend Phase 13). "Hard delete" here means irreversible
 * PII anonymization + deactivation, **not** a literal SQL `DELETE` — `Transaction`/`Rating`/
 * `Dispute`/`AdminAuditLog` rows all FK-reference `User` and must survive (the PRD's own §4/§9
 * money/GPS-metadata "7 years" retention rule would otherwise be violated by cascade-deleting the
 * ledger). See `retentionJob.executeScheduledHardDeletes` for the actual anonymization step this
 * service only schedules.
 */
export const accountDeletionService = {
  /** `POST /account/delete-request` — soft delete: schedules a hard delete after a grace period. */
  async requestDeletion(userId: string, reason: string | undefined) {
    const activeRequestCount = await requestRepository.countActiveForUser(userId, [...TERMINAL_STATUSES]);
    if (activeRequestCount > 0) {
      throw new HttpError(
        409,
        'Please complete, cancel, or resolve your in-progress requests before deleting your account.',
      );
    }

    const pendingPayout = await payoutRequestRepository.findPendingForUser(userId);
    if (pendingPayout) {
      throw new HttpError(409, 'You have a pending payout request — please wait for it to be processed first.');
    }

    const graceDays = await complianceConfigService.getNumber(ComplianceConfigKey.ACCOUNT_DELETION_GRACE_DAYS);
    const scheduledFor = new Date(Date.now() + graceDays * 24 * 60 * 60 * 1000);
    const now = new Date();

    const user = await userRepository.update(userId, {
      deletionRequestedAt: now,
      deletionScheduledFor: scheduledFor,
    });

    await dataDeletionLogRepository.create({
      userId,
      action: 'ACCOUNT_DELETION_REQUESTED',
      entityType: 'User',
      entityId: userId,
      metadata: {reason: reason ?? null, scheduledFor: scheduledFor.toISOString()},
    });

    await notificationService.notifyUser(
      userId,
      NotificationType.ACCOUNT_DELETION_SCHEDULED,
      'Account deletion scheduled',
      `Your account will be permanently deleted on ${scheduledFor.toDateString()}. Log in any time before then to cancel.`,
      {screen: 'PrivacySettings'},
    );

    return {...presentUser(user), deletionRequestedAt: user.deletionRequestedAt?.toISOString() ?? null, deletionScheduledFor: user.deletionScheduledFor?.toISOString() ?? null};
  },

  /** `POST /account/delete-cancel` — reversible any time before the grace period elapses. */
  async cancelDeletion(userId: string) {
    const user = await userRepository.findById(userId);
    if (!user?.deletionScheduledFor) {
      throw new HttpError(409, 'This account does not have a pending deletion request.');
    }

    const updated = await userRepository.update(userId, {
      deletionRequestedAt: null,
      deletionScheduledFor: null,
    });

    await dataDeletionLogRepository.create({
      userId,
      action: 'ACCOUNT_DELETION_CANCELLED',
      entityType: 'User',
      entityId: userId,
    });

    await notificationService.notifyUser(
      userId,
      NotificationType.ACCOUNT_DELETION_CANCELLED,
      'Account deletion cancelled',
      'Your account is safe — the scheduled deletion has been cancelled.',
      {screen: 'PrivacySettings'},
    );

    return presentUser(updated);
  },

  async status(userId: string) {
    const user = await userRepository.findById(userId);
    return {
      deletionRequestedAt: user?.deletionRequestedAt?.toISOString() ?? null,
      deletionScheduledFor: user?.deletionScheduledFor?.toISOString() ?? null,
      isPending: !!user?.deletionScheduledFor,
    };
  },
};
