import {disputeRepository} from '../repositories/disputeRepository';

type DisputeDetail = NonNullable<Awaited<ReturnType<typeof disputeRepository.findById>>>;
type DisputeMessageRow = DisputeDetail['messages'][number];
type DisputeEvidenceRow = DisputeDetail['evidence'][number];

// Own-filed dispute (`POST /disputes` response) — no Admin-only fields.
export const presentDispute = (dispute: {
  id: string;
  requestId: string;
  raisedById: string;
  raisedByRole: string;
  reason: string;
  description: string;
  status: string;
  amountLocked: unknown;
  createdAt: Date;
}) => ({
  id: dispute.id,
  requestId: dispute.requestId,
  raisedById: dispute.raisedById,
  raisedByRole: dispute.raisedByRole,
  reason: dispute.reason,
  description: dispute.description,
  status: dispute.status,
  amountLocked: Number(dispute.amountLocked),
  createdAt: dispute.createdAt.toISOString(),
});

const presentMessage = (message: DisputeMessageRow) => ({
  id: message.id,
  authorType: message.authorType,
  authorUser: message.authorUser,
  authorAdmin: message.authorAdmin,
  body: message.body,
  isInternalNote: message.isInternalNote,
  createdAt: message.createdAt.toISOString(),
});

const presentEvidence = (evidence: DisputeEvidenceRow) => ({
  id: evidence.id,
  uploadedByType: evidence.uploadedByType,
  uploadedByUser: evidence.uploadedByUser,
  uploadedByAdmin: evidence.uploadedByAdmin,
  url: evidence.url,
  mimeType: evidence.mimeType,
  caption: evidence.caption,
  createdAt: evidence.createdAt.toISOString(),
});

/**
 * Full case detail. `includeInternal` gates Admin-only internal notes (`isInternalNote`
 * messages) out of the participant-facing response — same filtering pattern ChatMessage's
 * `blocked` rows use (visible to moderation, hidden from participants).
 */
export const presentDisputeDetail = (dispute: DisputeDetail, includeInternal: boolean) => ({
  id: dispute.id,
  requestId: dispute.requestId,
  request: dispute.request,
  raisedById: dispute.raisedById,
  raisedBy: dispute.raisedBy,
  raisedByRole: dispute.raisedByRole,
  reason: dispute.reason,
  description: dispute.description,
  status: dispute.status,

  amountLocked: Number(dispute.amountLocked),
  commissionRate: Number(dispute.commissionRate),
  escrowStateAtCreation: dispute.escrowStateAtCreation,
  alreadyReleasedToCreator: Number(dispute.alreadyReleasedToCreator),
  alreadyRefundedToRequester: Number(dispute.alreadyRefundedToRequester),

  resolution: dispute.resolution,
  splitPercentage: dispute.splitPercentage !== null ? Number(dispute.splitPercentage) : null,
  resolutionNotes: includeInternal ? dispute.resolutionNotes : null,
  resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
  resolvedByAdminId: dispute.resolvedByAdminId,
  resolvedByAdmin: dispute.resolvedByAdmin,

  caseOwnerAdminId: dispute.caseOwnerAdminId,
  caseOwnerAdmin: dispute.caseOwnerAdmin,

  closedAt: dispute.closedAt?.toISOString() ?? null,
  reopenCount: dispute.reopenCount,
  reopenedAt: dispute.reopenedAt?.toISOString() ?? null,

  messages: dispute.messages.filter(m => includeInternal || !m.isInternalNote).map(presentMessage),
  evidence: dispute.evidence.map(presentEvidence),

  createdAt: dispute.createdAt.toISOString(),
  updatedAt: dispute.updatedAt.toISOString(),
});
