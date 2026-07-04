import {Prisma, VideoModerationStatus} from '@prisma/client';

import {prisma} from '../prisma/client';

const moderationInclude = {
  request: true,
  creator: {
    select: {id: true, name: true, username: true, email: true, profileImage: true},
  },
} satisfies Prisma.RequestVideoInclude;

export const requestVideoRepository = {
  create(data: Prisma.RequestVideoCreateInput) {
    return prisma.requestVideo.create({data});
  },

  findById(id: string) {
    return prisma.requestVideo.findUnique({where: {id}});
  },

  findByIdWithModerationContext(id: string) {
    return prisma.requestVideo.findUnique({where: {id}, include: moderationInclude});
  },

  findManyByIds(ids: string[]) {
    return prisma.requestVideo.findMany({where: {id: {in: ids}}});
  },

  /** The active (non-cancelled) video row for a request, if any — one active draft at a time. */
  findActiveByRequestId(requestId: string) {
    return prisma.requestVideo.findFirst({
      where: {requestId, status: {not: 'CANCELLED'}},
      orderBy: {createdAt: 'desc'},
    });
  },

  /**
   * Full recording history for a request (backend Phase 7 — "preserve previous recordings").
   * Includes cancelled/failed/rejected attempts, oldest-first, so the Creator/Requester can see
   * the complete audit trail across a re-shoot cycle, not just the currently-active row.
   */
  findAllByRequestId(requestId: string) {
    return prisma.requestVideo.findMany({
      where: {requestId},
      orderBy: {createdAt: 'asc'},
    });
  },

  update(id: string, data: Prisma.RequestVideoUpdateInput) {
    return prisma.requestVideo.update({where: {id}, data});
  },

  /**
   * Single query backing the Moderator queue, per-status history tabs, and per-moderator
   * history (PRD §5.9/§4.5, backend Phase 6) — only videos whose upload lifecycle actually
   * reached UPLOADED are moderatable at all. FIFO ordering (oldest-first) for the live queue;
   * callers wanting newest-first history can't get that from this shared method without a
   * second param, so history callers accept FIFO too (a small, deliberate simplification).
   */
  findManyForModeration(params: {
    statuses?: VideoModerationStatus[];
    requestId?: string;
    creatorId?: string;
    moderatedByAdminId?: string;
    search?: string;
    moderatedFrom?: Date;
    moderatedTo?: Date;
    skip: number;
    take: number;
  }) {
    const where: Prisma.RequestVideoWhereInput = {
      status: 'UPLOADED',
      ...(params.statuses ? {moderationStatus: {in: params.statuses}} : {}),
      ...(params.requestId ? {requestId: params.requestId} : {}),
      ...(params.creatorId ? {creatorId: params.creatorId} : {}),
      ...(params.moderatedByAdminId ? {moderatedByAdminId: params.moderatedByAdminId} : {}),
      ...(params.moderatedFrom || params.moderatedTo
        ? {
            moderatedAt: {
              ...(params.moderatedFrom ? {gte: params.moderatedFrom} : {}),
              ...(params.moderatedTo ? {lte: params.moderatedTo} : {}),
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              {request: {description: {contains: params.search, mode: 'insensitive'}}},
              {creator: {name: {contains: params.search, mode: 'insensitive'}}},
              {creator: {email: {contains: params.search, mode: 'insensitive'}}},
              {creator: {username: {contains: params.search, mode: 'insensitive'}}},
            ],
          }
        : {}),
    };

    return Promise.all([
      prisma.requestVideo.findMany({
        where,
        orderBy: {createdAt: 'asc'},
        skip: params.skip,
        take: params.take,
        include: moderationInclude,
      }),
      prisma.requestVideo.count({where}),
    ]);
  },

  /**
   * Video retention purge (PRD §9, backend Phase 13). Fulfilled videos (request already
   * COMPLETED/PAYMENT_RELEASED, moderation APPROVED) get their Cloudinary asset deleted
   * `VIDEO_FULFILLED_RETENTION_HOURS` after moderation approval; terminal-but-unfulfilled ones
   * (REJECTED/EXPIRED/CANCELLED/DISPUTED requests) get theirs deleted after
   * `VIDEO_TERMINAL_RETENTION_HOURS` — see `retentionJob`. Only rows with an asset still present
   * (`secureUrl` not null) and not already purged are candidates.
   */
  findFulfilledPurgeCandidates(cutoff: Date) {
    return prisma.requestVideo.findMany({
      where: {
        assetPurgedAt: null,
        secureUrl: {not: null},
        moderationStatus: 'APPROVED',
        moderatedAt: {lte: cutoff},
        request: {status: {in: ['COMPLETED', 'PAYMENT_RELEASED']}},
      },
    });
  },

  findTerminalPurgeCandidates(cutoff: Date, terminalStatuses: Prisma.RequestWhereInput['status']) {
    return prisma.requestVideo.findMany({
      where: {
        assetPurgedAt: null,
        secureUrl: {not: null},
        request: {status: terminalStatuses, updatedAt: {lte: cutoff}},
      },
    });
  },

  markAssetPurged(id: string) {
    return prisma.requestVideo.update({
      where: {id},
      data: {assetPurgedAt: new Date(), secureUrl: null, thumbnailUrl: null},
    });
  },

  getModerationStats(startOfToday: Date) {
    return Promise.all([
      prisma.requestVideo.count({where: {status: 'UPLOADED', moderationStatus: 'PENDING'}}),
      prisma.requestVideo.count({where: {moderationStatus: 'APPROVED', moderatedAt: {gte: startOfToday}}}),
      prisma.requestVideo.count({where: {moderationStatus: 'REJECTED', moderatedAt: {gte: startOfToday}}}),
      prisma.requestVideo.count({where: {moderationStatus: 'APPROVED'}}),
      prisma.requestVideo.count({where: {moderationStatus: 'REJECTED'}}),
    ]);
  },
};
