import {Prisma, RequestStatus} from '@prisma/client';

import {prisma} from '../prisma/client';

export const requestRepository = {
  create(data: Prisma.RequestCreateInput) {
    return prisma.request.create({data});
  },

  findById(id: string) {
    return prisma.request.findUnique({where: {id}});
  },

  findByIdForUser(id: string, userId: string) {
    return prisma.request.findFirst({where: {id, requesterId: userId}});
  },

  findManyForRequester(requesterId: string, status: RequestStatus | undefined, skip: number, take: number) {
    return prisma.request.findMany({
      where: {requesterId, ...(status ? {status} : {})},
      orderBy: {createdAt: 'desc'},
      skip,
      take,
    });
  },

  countForRequester(requesterId: string, status: RequestStatus | undefined) {
    return prisma.request.count({where: {requesterId, ...(status ? {status} : {})}});
  },

  update(id: string, data: Prisma.RequestUpdateInput) {
    return prisma.request.update({where: {id}, data});
  },

  /** Used by the expiry sweep — only rows still eligible are touched, race-safe via updateMany. */
  findExpiredCandidates(now: Date) {
    return prisma.request.findMany({
      where: {
        status: {in: ['DRAFT', 'PUBLISHED']},
        expiresAt: {lte: now},
      },
      select: {id: true, status: true},
    });
  },

  /** Publishes any SCHEDULED request whose scheduledAt has arrived and hasn't expired yet. */
  findScheduledDueForPublish(now: Date) {
    return prisma.request.findMany({
      where: {
        status: 'DRAFT',
        type: 'SCHEDULED',
        scheduledAt: {lte: now},
        expiresAt: {gt: now},
        highValueReviewRequired: false,
      },
      select: {id: true},
    });
  },

  /**
   * Atomic conditional transition — count is 0 if another writer already moved the row
   * (idempotent). `updateMany` only accepts scalar mutations (no relation `connect`/`disconnect`
   * syntax) — pass `creatorId` directly, not `creator: {connect: ...}`.
   */
  updateStatusIfCurrently(id: string, currentStatus: RequestStatus, data: Prisma.RequestUncheckedUpdateManyInput) {
    return prisma.request.updateMany({
      where: {id, status: currentStatus},
      data,
    });
  },

  /**
   * Coarse bounding-box prefilter of discoverable requests for a Creator (PRD §5.5/§5.11):
   * `PUBLISHED` only (excludes DRAFT, and excludes CREATOR_ASSIGNED+ — those are already
   * locked to a creator), never the creator's own requests. Exact haversine radius/sort
   * happens in the service layer. Optional category/reward/type filters push down to SQL.
   */
  findDiscoverableInBoundingBox(params: {
    excludeUserId: string;
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
    now: Date;
    category?: Prisma.RequestWhereInput['category'];
    minReward?: number;
    maxReward?: number;
    type?: Prisma.RequestWhereInput['type'];
  }) {
    return prisma.request.findMany({
      where: {
        status: 'PUBLISHED',
        requesterId: {not: params.excludeUserId},
        expiresAt: {gt: params.now},
        latitude: {gte: params.minLat, lte: params.maxLat},
        longitude: {gte: params.minLng, lte: params.maxLng},
        ...(params.category ? {category: params.category} : {}),
        ...(params.type ? {type: params.type} : {}),
        ...(params.minReward !== undefined || params.maxReward !== undefined
          ? {
              rewardAmount: {
                ...(params.minReward !== undefined ? {gte: params.minReward} : {}),
                ...(params.maxReward !== undefined ? {lte: params.maxReward} : {}),
              },
            }
          : {}),
      },
    });
  },

  /** City/keyword-filtered fallback list for creators without GPS (PRD §5.11.1 fallback). */
  findAvailable(params: {
    excludeUserId: string;
    now: Date;
    category?: Prisma.RequestWhereInput['category'];
    minReward?: number;
    maxReward?: number;
    type?: Prisma.RequestWhereInput['type'];
    skip: number;
    take: number;
  }) {
    const where: Prisma.RequestWhereInput = {
      status: 'PUBLISHED',
      requesterId: {not: params.excludeUserId},
      expiresAt: {gt: params.now},
      ...(params.category ? {category: params.category} : {}),
      ...(params.type ? {type: params.type} : {}),
      ...(params.minReward !== undefined || params.maxReward !== undefined
        ? {
            rewardAmount: {
              ...(params.minReward !== undefined ? {gte: params.minReward} : {}),
              ...(params.maxReward !== undefined ? {lte: params.maxReward} : {}),
            },
          }
        : {}),
    };

    return Promise.all([
      prisma.request.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip: params.skip,
        take: params.take,
      }),
      prisma.request.count({where}),
    ]);
  },

  /** Creator-facing detail lookup — any authenticated user may view a non-DRAFT request. */
  findVisibleById(id: string) {
    return prisma.request.findFirst({
      where: {id, status: {not: 'DRAFT'}},
    });
  },

  /** Used by the acceptance-timer sweep — requests whose Creator never started recording in time. */
  findAcceptanceTimerExpired(now: Date) {
    return prisma.request.findMany({
      where: {
        status: 'CREATOR_ASSIGNED',
        acceptanceTimerExpiresAt: {lte: now},
      },
      select: {id: true, creatorId: true, requesterId: true},
    });
  },

  /** The Creator's current in-flight request (post-accept, pre-terminal), if any. */
  findActiveForCreator(creatorId: string) {
    return prisma.request.findFirst({
      where: {
        creatorId,
        status: {
          in: [
            'CREATOR_ASSIGNED',
            'TEMPORARY_CHAT',
            'RECORDING',
            'UPLOAD',
            'MODERATOR_REVIEW',
            'REQUESTER_REVIEW',
            'RESHOOT_REQUESTED',
          ],
        },
      },
      orderBy: {acceptedAt: 'desc'},
    });
  },

  /** Recent requests this Creator has accepted (any status from CREATOR_ASSIGNED onward). */
  findAcceptedForCreator(creatorId: string, take: number) {
    return prisma.request.findMany({
      where: {
        creatorId,
        status: {not: 'PUBLISHED'},
      },
      orderBy: {acceptedAt: 'desc'},
      take,
    });
  },
};
