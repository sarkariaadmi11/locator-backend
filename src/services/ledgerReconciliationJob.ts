import {LedgerCurrency, LedgerDirection} from '@prisma/client';

import {logger} from '../config/logger';
import {prisma} from '../prisma/client';
import {ledgerReconciliationRunRepository} from '../repositories/ledgerReconciliationRunRepository';
import {notificationService} from './notificationService';
import {NotificationType} from './notificationTypes';

/**
 * Ledger reconciliation (PRD_TRD_SUMMARY.md §5.8 `ledger_reconciliation`, backend Phase 8 item
 * 4) — nightly correctness backstop verifying `SUM(credits) - SUM(debits)` per user/currency in
 * the append-only `LedgerEntry` table matches the denormalized balance columns on `User`
 * (`earnedCredits+bonusCredits+purchasedCredits` for CREDIT, `creatorConnects` for CONNECT).
 *
 * This codebase stores balances denormalized on `User` for fast reads (see `ledgerService.ts`'s
 * file header comment) rather than summing `LedgerEntry` on every read — this job is what
 * actually proves the two never drift, closing the loop that design choice leaves open.
 *
 * Scoped to CREDIT/CONNECT only: INR balances aren't yet routed through `LedgerEntry` (real-money
 * mode still uses the pre-existing `Transaction`/`walletBalance` pair, see `docs/CLAUDE.md` §2.1)
 * so there is nothing to reconcile there yet.
 *
 * Never mutates anything — a variance is a bug to investigate, not something this job attempts
 * to auto-correct (auto-"fixing" a ledger discrepancy by writing to the value that's supposedly
 * wrong is exactly how a real fraud/bug could hide itself).
 */
export const ledgerReconciliationJob = {
  async runSweep() {
    const sums = await prisma.ledgerEntry.groupBy({
      by: ['userId', 'currency', 'direction'],
      _sum: {amount: true},
    });

    if (sums.length === 0) {
      await ledgerReconciliationRunRepository.create({checkedCount: 0, varianceCount: 0, variances: []});
      return {checked: 0, variances: []};
    }

    const derivedByUser = new Map<string, {credit: number; connect: number}>();
    for (const row of sums) {
      const entry = derivedByUser.get(row.userId) ?? {credit: 0, connect: 0};
      const amount = row._sum.amount ?? 0;
      const signed = row.direction === LedgerDirection.CREDIT ? amount : -amount;
      if (row.currency === LedgerCurrency.CREDIT) entry.credit += signed;
      if (row.currency === LedgerCurrency.CONNECT) entry.connect += signed;
      derivedByUser.set(row.userId, entry);
    }

    const userIds = [...derivedByUser.keys()];
    const users = await prisma.user.findMany({
      where: {id: {in: userIds}},
      select: {id: true, username: true, earnedCredits: true, bonusCredits: true, purchasedCredits: true, creatorConnects: true},
    });

    const variances: Array<{userId: string; username: string; currency: 'CREDIT' | 'CONNECT'; derived: number; actual: number}> = [];

    for (const user of users) {
      const derived = derivedByUser.get(user.id)!;
      const actualCredits = user.earnedCredits + user.bonusCredits + user.purchasedCredits;

      if (derived.credit !== actualCredits) {
        variances.push({userId: user.id, username: user.username, currency: 'CREDIT', derived: derived.credit, actual: actualCredits});
      }
      if (derived.connect !== user.creatorConnects) {
        variances.push({userId: user.id, username: user.username, currency: 'CONNECT', derived: derived.connect, actual: user.creatorConnects});
      }
    }

    if (variances.length > 0) {
      logger.error(`[ledgerReconciliationJob] Found ${variances.length} ledger variance(s): ${JSON.stringify(variances)}`);
      await notificationService.notifyAdmins(
        NotificationType.SYSTEM_THRESHOLD_ALERT,
        'Ledger reconciliation variance detected',
        `${variances.length} user/currency balance mismatch(es) found between LedgerEntry and User balances. Check server logs for details.`,
        {varianceCount: String(variances.length)},
      );
    } else {
      logger.info(`[ledgerReconciliationJob] Reconciled ${users.length} user(s) — no variance.`);
    }

    // Ledger reconciliation report (PRD §5.14.5) — persisted so an Admin can see results in the
    // panel; the job's own log/alert above are unchanged, this is additive.
    await ledgerReconciliationRunRepository.create({
      checkedCount: users.length,
      varianceCount: variances.length,
      variances,
    });

    return {checked: users.length, variances};
  },
};
