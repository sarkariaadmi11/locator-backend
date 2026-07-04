import {RequestEscrow} from '@prisma/client';

export const presentRequestEscrow = (escrow: RequestEscrow) => ({
  id: escrow.id,
  requestId: escrow.requestId,
  amountLocked: Number(escrow.amountLocked),
  commissionRate: Number(escrow.commissionRate),
  commissionAmount: Number(escrow.commissionAmount),
  creatorEarnings: Number(escrow.creatorEarnings),
  refundAmount: escrow.refundAmount !== null ? Number(escrow.refundAmount) : null,
  state: escrow.state,
  reservedAt: escrow.reservedAt.toISOString(),
  releasedAt: escrow.releasedAt?.toISOString() ?? null,
  refundedAt: escrow.refundedAt?.toISOString() ?? null,
  settledAt: escrow.settledAt?.toISOString() ?? null,
  createdAt: escrow.createdAt.toISOString(),
  updatedAt: escrow.updatedAt.toISOString(),
});
