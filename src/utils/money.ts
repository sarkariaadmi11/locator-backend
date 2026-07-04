/** Rounds to 2 decimal places (paise) — the single rounding rule every ₹-amount calculation in this codebase must share. */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Splits a locked reward amount into platform commission + Creator earnings at a given
 * commission rate (PRD §5.2, §7.1). Shared by `escrowService.reserve` (fresh reservation) and
 * `disputeService.adminResolve` (CREATOR_FAVOUR/PARTIAL resolutions) so the split math can never
 * drift between the two call sites.
 */
export function splitCommission(amount: number, commissionRatePercent: number): {
  commissionAmount: number;
  creatorEarnings: number;
} {
  const commissionAmount = round2((amount * commissionRatePercent) / 100);
  const creatorEarnings = round2(amount - commissionAmount);
  return {commissionAmount, creatorEarnings};
}
