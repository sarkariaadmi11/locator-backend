import {Prisma, RequestStatus} from '@prisma/client';

import {prisma} from '../prisma/client';
import {adminAlertRepository} from '../repositories/adminAlertRepository';
import {ledgerReconciliationRunRepository} from '../repositories/ledgerReconciliationRunRepository';
import {payoutRequestRepository} from '../repositories/payoutRequestRepository';
import {refreshTokenRepository} from '../repositories/refreshTokenRepository';
import {requestRepository} from '../repositories/requestRepository';
import {transactionRepository} from '../repositories/transactionRepository';
import {adminAuditLogService} from './adminAuditLogService';
import {disputeService} from './disputeService';
import {ledgerService} from './ledgerService';
import {moderationService} from './moderationService';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';
import {TERMINAL_STATUSES} from './requestStateMachine';
import {HttpError} from '../utils/httpError';
import {presentRequest} from '../utils/requestPresenter';
import {presentUser} from '../utils/userPresenter';

// "Live" statuses for the Live Monitoring Dashboard tile row (PRD §5.14.2) — every non-terminal
// PRD §5.13 state, in lifecycle order, so the dashboard always renders a stable, complete row
// even for statuses currently at 0 (no in-flight request happens to be in that stage right now).
const LIVE_STATUS_ORDER: RequestStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'CREATOR_ASSIGNED',
  'TEMPORARY_CHAT',
  'RECORDING',
  'UPLOAD',
  'MODERATOR_REVIEW',
  'REQUESTER_REVIEW',
  'RESHOOT_REQUESTED',
  'ACCEPTED',
  'PAYMENT_RELEASED',
];

export const adminService = {
  /**
   * Dashboard KPI tiles (PRD §5.14.1). Extended (backend Phase 11) beyond the pre-PRD generic
   * user/revenue counts with the PRD's own named tiles — Total Requests Today, Active Requests,
   * Moderation Queue depth, Pending Disputes — sourced from the same services/repositories their
   * own dedicated dashboards use (`moderationService.getStats`, `disputeService.adminStats`,
   * `requestRepository`), not a second parallel query path.
   */
  async getDashboardKpis() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      totalUsers,
      activeUsers,
      suspiciousUsers,
      blockedUsers,
      totalTransactions,
      totalRevenue,
      pendingPayouts,
      pendingPayoutAmount,
      totalRequestsToday,
      activeRequests,
      moderationStats,
      disputeStats,
      onlineCreators,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({where: {isActive: true}}),
      prisma.user.count({where: {isSuspicious: true}}),
      prisma.user.count({where: {isActive: false}}),
      transactionRepository.count({status: 'SUCCESS'}),
      transactionRepository.aggregateSum({status: 'SUCCESS', type: 'CREDIT'}),
      payoutRequestRepository.count({status: 'PENDING'}),
      payoutRequestRepository.aggregateSum({status: 'PENDING'}),
      requestRepository.countCreatedSince(startOfToday),
      requestRepository.countActiveTotal(TERMINAL_STATUSES as RequestStatus[]),
      moderationService.getStats(),
      disputeService.adminStats(),
      prisma.user.count({where: {availabilityStatus: 'ONLINE'}}),
    ]);

    return {
      totalUsers,
      activeUsers,
      suspiciousUsers,
      blockedUsers,
      totalTransactions,
      totalRevenue: Number(totalRevenue._sum.amount ?? 0),
      pendingPayouts,
      pendingPayoutAmount: Number(pendingPayoutAmount._sum.amount ?? 0),
      totalRequestsToday,
      activeRequests,
      moderationQueueDepth: moderationStats.pendingQueueDepth,
      pendingDisputes: disputeStats.open + disputeStats.underReview,
      onlineCreators,
    };
  },

  /**
   * Live Monitoring Dashboard (PRD §5.14.2) — a real-time snapshot of every in-flight Request
   * grouped by lifecycle stage, plus the operational signals an Admin watches minute-to-minute
   * (online Creator supply, moderation backlog, open disputes, flagged chats). Composed from the
   * same per-domain services/repositories their own dedicated screens already use — no second
   * parallel aggregation logic.
   */
  async getLiveMonitoring() {
    const [grouped, onlineCreators, moderationStats, disputeStats, flaggedChats, pins] = await Promise.all([
      requestRepository.countGroupedByLiveStatus(TERMINAL_STATUSES as RequestStatus[]),
      prisma.user.count({where: {availabilityStatus: 'ONLINE'}}),
      moderationService.getStats(),
      disputeService.adminStats(),
      prisma.request.count({
        where: {chatFlaggedForReview: true, status: {notIn: TERMINAL_STATUSES as RequestStatus[]}},
      }),
      // Live Monitoring map view (PRD §5.14.2 "Map view of active pins") — capped at 500 so the
      // payload stays bounded even with a large active-request volume.
      requestRepository.findActivePins(TERMINAL_STATUSES as RequestStatus[], 500),
    ]);

    const countByStatus = new Map(grouped.map(row => [row.status, row.count]));
    const requestsByStatus = LIVE_STATUS_ORDER.map(status => ({
      status,
      count: countByStatus.get(status) ?? 0,
    }));

    return {
      totalActiveRequests: requestsByStatus.reduce((sum, row) => sum + row.count, 0),
      requestsByStatus,
      onlineCreators,
      moderationQueueDepth: moderationStats.pendingQueueDepth,
      openDisputes: disputeStats.open,
      underReviewDisputes: disputeStats.underReview,
      flaggedChats,
      activePins: pins.map(p => ({id: p.id, latitude: p.latitude, longitude: p.longitude, status: p.status, category: p.category})),
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Active Request Dashboard (PRD §5.14.3) — paginated list of every currently in-flight
   * Request (or a single status the Admin filtered to), with just enough participant identity
   * for the admin list view. Reuses the existing participant-facing `presentRequest` shape so
   * the Admin sees the exact same field names as every other Request payload in this codebase.
   */
  async getActiveRequests(status: RequestStatus | undefined, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const [items, total] = await requestRepository.findManyActiveForAdmin({
      status,
      terminalStatuses: TERMINAL_STATUSES as RequestStatus[],
      skip,
      take: limit,
    });

    return {
      items: items.map(item => ({
        ...presentRequest(item),
        requester: item.requester,
        creator: item.creator,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async listUsers(page: number, limit: number, search?: string, filter?: string) {
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        {name: {contains: search, mode: 'insensitive'}},
        {email: {contains: search, mode: 'insensitive'}},
        {username: {contains: search, mode: 'insensitive'}},
      ];
    }
    if (filter === 'blocked') where.isActive = false;
    if (filter === 'suspicious') where.isSuspicious = true;
    if (filter === 'active') where.isActive = true;

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        select: {
          id: true,
          name: true,
          username: true,
          email: true,
          profileImage: true,
          city: true,
          walletBalance: true,
          isActive: true,
          isSuspicious: true,
          createdAt: true,
        },
      }),
      prisma.user.count({where}),
    ]);

    return {
      users: users.map(u => ({...u, walletBalance: Number(u.walletBalance), createdAt: u.createdAt.toISOString()})),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  /**
   * `GET /admin/users/:id` — full profile drill-down (admin frontend Phase 6, PRD §5.14.4):
   * balance breakdown (both currency systems), request/fulfilment counts, rating summary,
   * Verified Creator status, report count. Read-only aggregate, no new tables.
   */
  async getUserDetail(userId: string) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const [
      balances,
      requestsCreatedCount,
      requestsFulfilledCount,
      ratingAgg,
      verifiedStatus,
      reportsReceivedCount,
    ] = await Promise.all([
      ledgerService.getBalances(userId),
      prisma.request.count({where: {requesterId: userId}}),
      prisma.request.count({where: {creatorId: userId, status: {in: ['COMPLETED', 'PAYMENT_RELEASED', 'TIPPING']}}}),
      prisma.rating.aggregate({where: {rateeId: userId}, _avg: {stars: true}, _count: {stars: true}}),
      prisma.verifiedCreatorStatus.findUnique({where: {userId}}),
      prisma.report.count({where: {reportedUserId: userId}}),
    ]);

    return {
      ...presentUser(user),
      balances,
      requestsCreatedCount,
      requestsFulfilledCount,
      averageRating: ratingAgg._avg.stars,
      ratingCount: ratingAgg._count.stars,
      isVerifiedCreator: !!verifiedStatus?.isVerified,
      reportsReceivedCount,
    };
  },

  /**
   * `PATCH /admin/users/:id/wallet-adjustment` — manual Credit/Connect adjustment (admin
   * frontend Phase 6, PRD §5.14.4), mandatory reason, audit-logged. `amount` may be negative
   * (debit) or positive (credit); `bucket` only applies to CREDITS (defaults `bonus`, the same
   * bucket signup/promotional grants use) and is ignored for CONNECTS.
   */
  async adjustWallet(
    adminId: string,
    userId: string,
    input: {type: 'CREDITS' | 'CONNECTS'; bucket?: 'bonus' | 'purchased' | 'earned'; amount: number; reason: string},
  ) {
    if (input.amount === 0) {
      throw new HttpError(400, 'Adjustment amount must not be zero.');
    }

    const magnitude = Math.abs(input.amount);
    const isCredit = input.amount > 0;

    if (input.type === 'CREDITS') {
      if (isCredit) {
        await ledgerService.creditCredits(userId, magnitude, input.bucket ?? 'bonus', 'ADMIN_ADJUSTMENT', {
          actorId: adminId,
        });
      } else {
        await ledgerService.debitCredits(userId, magnitude, 'ADMIN_ADJUSTMENT', {actorId: adminId});
      }
    } else if (isCredit) {
      await ledgerService.creditConnects(userId, magnitude, 'ADMIN_ADJUSTMENT', {actorId: adminId});
    } else {
      await ledgerService.debitConnects(userId, magnitude, 'ADMIN_ADJUSTMENT', {actorId: adminId});
    }

    await adminAuditLogService.log(adminId, 'WALLET_MANUAL_ADJUSTMENT', 'User', userId, {
      type: input.type,
      bucket: input.bucket,
      amount: input.amount,
      reason: input.reason,
    });

    return ledgerService.getBalances(userId);
  },

  /**
   * Audit Logs backfill (PRD §5.14.7, backend Phase 11) — `AdminAuditLog` previously only
   * recorded Moderation/Escrow/Dispute/Compliance actions (each added alongside its own
   * feature). User block/suspicious toggles predate `AdminAuditLog`'s existence (backend Phase
   * 6) and were never wired to it. There is no way to retroactively create audit rows for past
   * toggles that were never logged — this closes the gap going forward, the same "backfill"
   * scope every other pre-existing-action audit gap in this codebase has meant.
   */
  async toggleBlock(adminId: string, userId: string, reason: string) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const updated = await prisma.user.update({
      where: {id: userId},
      data: {isActive: !user.isActive},
    });

    await adminAuditLogService.log(adminId, updated.isActive ? 'USER_UNBLOCKED' : 'USER_BLOCKED', 'User', userId, {
      reason,
    });

    if (!updated.isActive) {
      // Suspension must kill any session already in the user's hands, not just future logins —
      // otherwise a suspended user with a still-valid access/refresh token keeps working for up
      // to 24h (see authMiddleware's isActive check, which only runs per-request; the refresh
      // token itself has no such check without this).
      await refreshTokenRepository.revokeAllForUser(userId);
      await notificationService.notifyUser(
        userId,
        NotificationType.ACCOUNT_SUSPENDED,
        'Account Suspended',
        'Your account has been suspended by an Admin. Contact support for details.',
      );
    }

    return presentUser(updated);
  },

  /**
   * Time-boxed suspension (PRD §5.9.2 "Suspend User button (reason + duration)") — the
   * Moderator-queue-specific action, distinct from `toggleBlock`'s plain indefinite toggle.
   * Reuses the same session-kill/notify behavior `toggleBlock` uses for `isActive: false`.
   * `retentionJob`'s sweep auto-reactivates the account once `suspendedUntil` elapses.
   */
  async suspendUser(adminId: string, userId: string, reason: string, durationHours: number) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const suspendedUntil = new Date(Date.now() + durationHours * 60 * 60 * 1000);
    const updated = await prisma.user.update({
      where: {id: userId},
      data: {isActive: false, suspendedUntil},
    });

    await adminAuditLogService.log(adminId, 'USER_SUSPENDED', 'User', userId, {reason, durationHours, suspendedUntil});

    await refreshTokenRepository.revokeAllForUser(userId);
    await notificationService.notifyUser(
      userId,
      NotificationType.ACCOUNT_SUSPENDED,
      'Account Suspended',
      `Your account has been suspended by a Moderator for ${durationHours} hours. Contact support for details.`,
    );

    return presentUser(updated);
  },

  async toggleSuspicious(adminId: string, userId: string, reason: string) {
    const user = await prisma.user.findUnique({where: {id: userId}});
    if (!user) throw new HttpError(404, 'User not found.');

    const updated = await prisma.user.update({
      where: {id: userId},
      data: {isSuspicious: !user.isSuspicious},
    });

    await adminAuditLogService.log(
      adminId,
      updated.isSuspicious ? 'USER_FLAGGED_SUSPICIOUS' : 'USER_UNFLAGGED_SUSPICIOUS',
      'User',
      userId,
      {reason},
    );

    return presentUser(updated);
  },

  async listTransactions(page: number, limit: number, userId?: string, type?: string, status?: string) {
    const skip = (page - 1) * limit;

    const where: Prisma.TransactionWhereInput = {};
    if (userId) where.userId = userId;
    if (type) where.type = type as Prisma.TransactionWhereInput['type'];
    if (status) where.status = status as Prisma.TransactionWhereInput['status'];

    const [transactions, total] = await Promise.all([
      transactionRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {
          user: {select: {id: true, name: true, email: true, username: true}},
        },
      }),
      transactionRepository.count(where),
    ]);

    return {
      transactions: transactions.map(t => ({
        ...t,
        amount: Number(t.amount),
        createdAt: t.createdAt.toISOString(),
        updatedAt: t.updatedAt.toISOString(),
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async exportTransactionsCsv() {
    const transactions = await transactionRepository.findAllForExport();

    const header = 'ID,User Name,User Email,Type,Amount,Status,Description,Created At\n';
    const rows = transactions.map(t =>
      [
        t.id,
        `"${t.user.name}"`,
        t.user.email,
        t.type,
        Number(t.amount).toFixed(2),
        t.status,
        `"${t.description ?? ''}"`,
        t.createdAt.toISOString(),
      ].join(','),
    );

    return header + rows.join('\n');
  },

  /** Live Monitoring alert feed (PRD §5.14.2). */
  async listAlerts(limit: number) {
    const alerts = await adminAlertRepository.findRecent(limit);
    return alerts.map(a => ({
      id: a.id,
      type: a.type,
      message: a.message,
      metadata: a.metadata,
      userId: a.userId,
      requestId: a.requestId,
      createdAt: a.createdAt.toISOString(),
    }));
  },

  /** Ledger reconciliation report (PRD §5.14.5) — recent nightly `ledgerReconciliationJob` runs. */
  async listLedgerReconciliation(limit: number) {
    const runs = await ledgerReconciliationRunRepository.findRecent(limit);
    return runs.map(run => ({
      id: run.id,
      checkedCount: run.checkedCount,
      varianceCount: run.varianceCount,
      variances: run.variances,
      createdAt: run.createdAt.toISOString(),
    }));
  },

  async listPayouts(page: number, limit: number, status?: string) {
    const skip = (page - 1) * limit;
    const where: Prisma.PayoutRequestWhereInput = {};
    if (status) where.status = status as Prisma.PayoutRequestWhereInput['status'];

    const [payouts, total] = await Promise.all([
      payoutRequestRepository.findMany({
        where,
        skip,
        take: limit,
        orderBy: {createdAt: 'desc'},
        include: {user: {select: {id: true, name: true, email: true, username: true, walletBalance: true}}},
      }),
      payoutRequestRepository.count(where),
    ]);

    return {
      payouts: payouts.map(p => ({
        ...p,
        amount: Number(p.amount),
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
        processedAt: p.processedAt?.toISOString() ?? null,
        user: {...p.user, walletBalance: Number(p.user.walletBalance)},
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  },

  async processPayout(adminId: string, payoutId: string, action: 'approve' | 'reject', adminNote?: string) {
    const payout = await payoutRequestRepository.findById(payoutId);

    if (!payout) throw new HttpError(404, 'Payout request not found.');
    if (payout.status !== 'PENDING') throw new HttpError(400, 'Payout request is not pending.');

    const amount = Number(payout.amount).toFixed(2);

    if (action === 'approve') {
      if (Number(payout.user.walletBalance) < Number(payout.amount)) {
        throw new HttpError(400, 'User has insufficient wallet balance.');
      }

      await transactionRepository.runTransaction([
        prisma.payoutRequest.update({
          where: {id: payoutId},
          data: {status: 'APPROVED', adminNote, processedAt: new Date()},
        }),
        prisma.transaction.create({
          data: {
            userId: payout.userId,
            type: 'DEBIT',
            amount: payout.amount,
            status: 'SUCCESS',
            description: 'Payout withdrawal approved by admin',
          },
        }),
        prisma.user.update({
          where: {id: payout.userId},
          data: {walletBalance: {decrement: payout.amount}},
        }),
      ]);

      await notificationService.notifyUser(
        payout.userId,
        NotificationType.PAYOUT_APPROVED,
        'Withdrawal Approved ✓',
        `Your withdrawal of ₹${amount} has been approved and deducted from your wallet.`,
        {payoutId, amount, screen: 'Wallet'},
      );
    } else {
      await payoutRequestRepository.update(payoutId, {status: 'REJECTED', adminNote, processedAt: new Date()});

      await notificationService.notifyUser(
        payout.userId,
        NotificationType.PAYOUT_REJECTED,
        'Withdrawal Rejected',
        adminNote
          ? `Your withdrawal of ₹${amount} was rejected: ${adminNote}`
          : `Your withdrawal of ₹${amount} was rejected by admin.`,
        {payoutId, amount, screen: 'Wallet'},
      );
    }

    await adminAuditLogService.log(
      adminId,
      action === 'approve' ? 'PAYOUT_APPROVED' : 'PAYOUT_REJECTED',
      'PayoutRequest',
      payoutId,
      {amount, adminNote: adminNote ?? null},
    );

    return {id: payoutId, action};
  },
};
