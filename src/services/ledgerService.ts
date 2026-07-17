import {LedgerCurrency, LedgerDirection, LedgerReasonCode} from '@prisma/client';

import {BETA_ECONOMY_DEFAULTS} from '../config/betaEconomy';
import {prisma} from '../prisma/client';
import {ledgerRepository} from '../repositories/ledgerRepository';
import {HttpError} from '../utils/httpError';
import {SettingsKey, settingsService} from './settingsService';

type CreditBucket = 'earned' | 'bonus' | 'purchased';

type LedgerOpts = {
  requestId?: string;
  actorId?: string;
  idempotencyKey?: string;
};

/**
 * v2.1 Beta Credits/Connects ledger (PRD_TRD_SUMMARY.md §4.3, §4.4, backend Phase 2). Single
 * write path for every Credit/Connect balance change — mirrors the guarded-`updateMany`
 * discipline `transactionRepository.markSuccessIfPending`/`escrowService` already use for the
 * real-money path (a `WHERE balance >= amount` guard makes a negative balance structurally
 * impossible without needing an explicit `SELECT ... FOR UPDATE`), and inserts an append-only
 * `LedgerEntry` audit row in the same DB transaction as the `User` balance-column update.
 *
 * Balances are read from `User.{earnedCredits,bonusCredits,purchasedCredits,creatorConnects}`
 * directly (denormalized, fast reads) rather than summed from `LedgerEntry` on every read — the
 * same pattern this codebase already uses for `User.walletBalance`/`Transaction`. `LedgerEntry`
 * is the durable audit trail and the future input to Phase 8's `ledger_reconciliation` job,
 * which is what actually verifies the two never drift.
 *
 * `video_credits` (PRD_TRD_SUMMARY.md §4.3) = earnedCredits + bonusCredits + purchasedCredits,
 * computed at read time in `getBalances` below — never stored as its own column.
 */
async function idempotentReplay(idempotencyKey: string | undefined) {
  if (!idempotencyKey) return null;
  return ledgerRepository.findByIdempotencyKey(idempotencyKey);
}

export const ledgerService = {
  async getBalances(userId: string) {
    const user = await prisma.user.findUnique({
      where: {id: userId},
      select: {earnedCredits: true, bonusCredits: true, purchasedCredits: true, creatorConnects: true, walletBalance: true},
    });
    if (!user) throw new HttpError(404, 'User not found.');

    return {
      earnedCredits: user.earnedCredits,
      bonusCredits: user.bonusCredits,
      purchasedCredits: user.purchasedCredits,
      videoCredits: user.earnedCredits + user.bonusCredits + user.purchasedCredits,
      creatorConnects: user.creatorConnects,
      inrBalance: Number(user.walletBalance),
    };
  },

  /** Credits a specific Credit bucket (bonus/purchased/earned) — always safe, no balance guard needed. */
  async creditCredits(userId: string, amount: number, bucket: CreditBucket, reasonCode: LedgerReasonCode, opts: LedgerOpts = {}) {
    if (amount <= 0) throw new HttpError(400, 'Credit amount must be positive.');

    const replay = await idempotentReplay(opts.idempotencyKey);
    if (replay) return replay;

    const field = `${bucket}Credits` as const;
    const [, user, entry] = await prisma.$transaction([
      prisma.user.update({where: {id: userId}, data: {[field]: {increment: amount}}}),
      prisma.user.findUniqueOrThrow({where: {id: userId}, select: {earnedCredits: true, bonusCredits: true, purchasedCredits: true}}),
      prisma.ledgerEntry.create({
        data: {
          userId,
          currency: LedgerCurrency.CREDIT,
          direction: LedgerDirection.CREDIT,
          amount,
          reasonCode,
          requestId: opts.requestId,
          actorId: opts.actorId,
          idempotencyKey: opts.idempotencyKey,
        },
      }),
    ]);

    return {...entry, balanceAfter: user.earnedCredits + user.bonusCredits + user.purchasedCredits};
  },

  /**
   * Debits Credits in spend order bonus -> purchased -> earned (protects the withdrawable
   * `earnedCredits` balance, per PRD_TRD_SUMMARY.md §4.3). Throws 402 if insufficient across all
   * three buckets combined.
   */
  async debitCredits(userId: string, amount: number, reasonCode: LedgerReasonCode, opts: LedgerOpts = {}) {
    if (amount <= 0) throw new HttpError(400, 'Debit amount must be positive.');

    const replay = await idempotentReplay(opts.idempotencyKey);
    if (replay) return replay;

    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const user = await prisma.user.findUnique({
        where: {id: userId},
        select: {earnedCredits: true, bonusCredits: true, purchasedCredits: true},
      });
      if (!user) throw new HttpError(404, 'User not found.');

      const total = user.earnedCredits + user.bonusCredits + user.purchasedCredits;
      if (total < amount) {
        throw new HttpError(402, `Insufficient Credits. You need ${amount} Credits. You have ${total}.`);
      }

      let remaining = amount;
      const fromBonus = Math.min(remaining, user.bonusCredits);
      remaining -= fromBonus;
      const fromPurchased = Math.min(remaining, user.purchasedCredits);
      remaining -= fromPurchased;
      const fromEarned = Math.min(remaining, user.earnedCredits);
      remaining -= fromEarned;

      const result = await prisma.user.updateMany({
        where: {
          id: userId,
          bonusCredits: {gte: fromBonus},
          purchasedCredits: {gte: fromPurchased},
          earnedCredits: {gte: fromEarned},
        },
        data: {
          bonusCredits: {decrement: fromBonus},
          purchasedCredits: {decrement: fromPurchased},
          earnedCredits: {decrement: fromEarned},
        },
      });

      if (result.count === 0) {
        // Lost a race with a concurrent debit/credit on this same user — re-read and retry.
        continue;
      }

      const entry = await ledgerRepository.create({
        user: {connect: {id: userId}},
        currency: LedgerCurrency.CREDIT,
        direction: LedgerDirection.DEBIT,
        amount,
        reasonCode,
        request: opts.requestId ? {connect: {id: opts.requestId}} : undefined,
        actorId: opts.actorId,
        idempotencyKey: opts.idempotencyKey,
      });
      return entry;
    }

    throw new HttpError(409, 'Could not debit Credits due to a concurrent balance change. Please retry.');
  },

  async creditConnects(userId: string, amount: number, reasonCode: LedgerReasonCode, opts: LedgerOpts = {}) {
    if (amount <= 0) throw new HttpError(400, 'Connect amount must be positive.');

    const replay = await idempotentReplay(opts.idempotencyKey);
    if (replay) return replay;

    const [, entry] = await prisma.$transaction([
      prisma.user.update({where: {id: userId}, data: {creatorConnects: {increment: amount}}}),
      prisma.ledgerEntry.create({
        data: {
          userId,
          currency: LedgerCurrency.CONNECT,
          direction: LedgerDirection.CREDIT,
          amount,
          reasonCode,
          requestId: opts.requestId,
          actorId: opts.actorId,
          idempotencyKey: opts.idempotencyKey,
        },
      }),
    ]);

    return entry;
  },

  async debitConnects(userId: string, amount: number, reasonCode: LedgerReasonCode, opts: LedgerOpts = {}) {
    if (amount <= 0) throw new HttpError(400, 'Debit amount must be positive.');

    const replay = await idempotentReplay(opts.idempotencyKey);
    if (replay) return replay;

    const result = await prisma.user.updateMany({
      where: {id: userId, creatorConnects: {gte: amount}},
      data: {creatorConnects: {decrement: amount}},
    });

    if (result.count === 0) {
      throw new HttpError(402, `Insufficient Connects. You need ${amount} Connect(s).`);
    }

    return ledgerRepository.create({
      user: {connect: {id: userId}},
      currency: LedgerCurrency.CONNECT,
      direction: LedgerDirection.DEBIT,
      amount,
      reasonCode,
      request: opts.requestId ? {connect: {id: opts.requestId}} : undefined,
      actorId: opts.actorId,
      idempotencyKey: opts.idempotencyKey,
    });
  },

  /** PRD §7.2 — Admin-configurable Signup Bonus (default 300 Video Credits (bonus bucket) + 30 Creator Connects), once per account. */
  async grantSignupBonus(userId: string) {
    const [signupCredits, signupConnects] = await Promise.all([
      settingsService.getNumber(SettingsKey.SIGNUP_VIDEO_CREDITS, BETA_ECONOMY_DEFAULTS.SIGNUP_VIDEO_CREDITS),
      settingsService.getNumber(SettingsKey.SIGNUP_CONNECTS, BETA_ECONOMY_DEFAULTS.SIGNUP_CONNECTS),
    ]);
    await this.creditCredits(userId, signupCredits, 'bonus', LedgerReasonCode.SIGNUP_BONUS, {
      idempotencyKey: `signup_bonus_credits_${userId}`,
    });
    await this.creditConnects(userId, signupConnects, LedgerReasonCode.SIGNUP_BONUS, {
      idempotencyKey: `signup_bonus_connects_${userId}`,
    });
  },

  /**
   * PRD §5.5 — 5 free Connects on first app activity each IST calendar day, capped so the daily
   * bonus alone never pushes the balance above 50. Idempotent per (user, IST date) via
   * `lastDailyConnectGrantDate` — safe to call on every authenticated request; only actually
   * grants once per day. Event-driven per TRD 9 (no midnight cron), called from
   * `walletService.getWallet`/login rather than a scheduled sweep across all users.
   */
  async grantDailyConnectBonusIfDue(userId: string) {
    // IST = UTC+5:30, no DST. Compute today's IST calendar date as a UTC-midnight Date so it
    // compares cleanly against the `@db.Date` column.
    const nowIst = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
    const todayIst = new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()));

    const user = await prisma.user.findUnique({
      where: {id: userId},
      select: {creatorConnects: true, lastDailyConnectGrantDate: true},
    });
    if (!user) throw new HttpError(404, 'User not found.');

    const alreadyGrantedToday =
      user.lastDailyConnectGrantDate && user.lastDailyConnectGrantDate.getTime() === todayIst.getTime();
    if (alreadyGrantedToday) return {granted: false};

    const [dailyBonus, dailyCap] = await Promise.all([
      settingsService.getNumber(SettingsKey.DAILY_CONNECT_BONUS, BETA_ECONOMY_DEFAULTS.DAILY_CONNECT_BONUS),
      settingsService.getNumber(SettingsKey.DAILY_CONNECT_BONUS_CAP, BETA_ECONOMY_DEFAULTS.DAILY_CONNECT_BONUS_CAP),
    ]);

    if (user.creatorConnects >= dailyCap) {
      // Still stamp the date so we don't re-check the cap on every request today.
      await prisma.user.updateMany({
        where: {id: userId, lastDailyConnectGrantDate: user.lastDailyConnectGrantDate ?? undefined},
        data: {lastDailyConnectGrantDate: todayIst},
      });
      return {granted: false, reason: 'cap_reached' as const};
    }

    const grantAmount = Math.min(dailyBonus, dailyCap - user.creatorConnects);

    // Guarded on lastDailyConnectGrantDate so two concurrent requests on the same day can't
    // double-grant (whichever loses the race sees count=0 and no-ops).
    const result = await prisma.user.updateMany({
      where: {id: userId, lastDailyConnectGrantDate: user.lastDailyConnectGrantDate ?? undefined},
      data: {creatorConnects: {increment: grantAmount}, lastDailyConnectGrantDate: todayIst},
    });
    if (result.count === 0) return {granted: false};

    await ledgerRepository.create({
      user: {connect: {id: userId}},
      currency: LedgerCurrency.CONNECT,
      direction: LedgerDirection.CREDIT,
      amount: grantAmount,
      reasonCode: LedgerReasonCode.DAILY_CONNECT_BONUS,
    });

    return {granted: true, amount: grantAmount};
  },

  async getTransactions(userId: string, page: number, limit: number, currency?: 'CREDIT' | 'CONNECT' | 'INR') {
    const skip = (page - 1) * limit;
    const [rows, total] = await Promise.all([
      ledgerRepository.findManyForUser(userId, {skip, take: limit, currency}),
      ledgerRepository.countForUser(userId, currency),
    ]);

    return {
      items: rows,
      page,
      hasMore: skip + rows.length < total,
    };
  },
};
