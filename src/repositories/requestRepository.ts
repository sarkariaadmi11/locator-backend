import {Prisma, RequestCategory, RequestStatus} from '@prisma/client';

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

  /** Pre-publish Pending Requests queue detail (PRD §5.9.2) — includes requester summary. */
  findByIdWithRequester(id: string) {
    return prisma.request.findUnique({
      where: {id},
      include: {requester: {select: {id: true, name: true, username: true, email: true}}},
    });
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

  /** Pre-publish Pending Requests queue (PRD §5.9.2, §5.14.7) — oldest-first, per spec. */
  findManyByStatus(status: RequestStatus, skip: number, take: number) {
    return prisma.request.findMany({
      where: {status},
      orderBy: {createdAt: 'asc'},
      skip,
      take,
      include: {requester: {select: {id: true, name: true, username: true, email: true}}},
    });
  },

  countByStatus(status: RequestStatus) {
    return prisma.request.count({where: {status}});
  },

  /** Used by the expiry sweep — only rows still eligible are touched, race-safe via updateMany. */
  findExpiredCandidates(now: Date) {
    return prisma.request.findMany({
      where: {
        status: {in: ['DRAFT', 'PUBLISHED']},
        expiresAt: {lte: now},
      },
      select: {id: true, status: true, requesterId: true},
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
   * Account Deletion workflow (backend Phase 13) — blocks a delete request while the user has
   * any Request mid-flow (either side) so a deletion can never orphan a live escrow/chat/video
   * pipeline. `terminalStatuses` is passed in by the caller (requestStateMachine's own list) so
   * this repository doesn't need to duplicate/import that business rule.
   */
  countActiveForUser(userId: string, terminalStatuses: RequestStatus[]) {
    return prisma.request.count({
      where: {
        OR: [{requesterId: userId}, {creatorId: userId}],
        status: {notIn: terminalStatuses},
      },
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
        // MATCHING_WINDOW included (backend Phase 4 item 4) — a Highest Rated request's
        // "searching" state, otherwise nearby Creators could never discover it to respond.
        status: {in: ['PUBLISHED', 'MATCHING_WINDOW']},
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

  /**
   * Used by the acceptance-timer sweep — requests whose Creator never started recording in
   * time. Acceptance immediately advances a request past `CREATOR_ASSIGNED` into
   * `TEMPORARY_CHAT` (chat opens automatically, PRD §5.4), so that's the status this window
   * is actually observed in, not `CREATOR_ASSIGNED` itself (which is transient).
   */
  findAcceptanceTimerExpired(now: Date) {
    return prisma.request.findMany({
      where: {
        // CREATOR_ASSIGNED is the v2.1 resting state a Creator sits in until Start Recording
        // (backend Phase 4 item 2 — TEMPORARY_CHAT retired from the accept flow). TEMPORARY_CHAT
        // is included too so any pre-existing row from before this change still resolves.
        status: {in: ['CREATOR_ASSIGNED', 'TEMPORARY_CHAT']},
        acceptanceTimerExpiresAt: {lte: now},
      },
      select: {id: true, creatorId: true, requesterId: true, status: true},
    });
  },

  /** Highest Rated matching windows whose response period has elapsed — swept by matchingWindowJob. */
  findMatchingWindowDue(now: Date) {
    return prisma.request.findMany({
      where: {
        status: 'MATCHING_WINDOW',
        matchingWindowClosesAt: {lte: now},
      },
      select: {id: true, requesterId: true, latitude: true, longitude: true, radiusMeters: true, category: true},
    });
  },

  /**
   * Estimated Response Time (PRD_TRD_SUMMARY.md §3.3, §10 item 8, backend Phase 3/mobile Phase
   * 9) — the last `sampleSize` requests in this category that actually got accepted, most recent
   * first, so the caller can average `acceptedAt - requesterDeclarationAt`. Deliberately not
   * geo-scoped (no per-city/per-radius breakdown) — a simple category-level global average,
   * flagged as a scoped-down v1 versus a more precise location-aware estimate.
   */
  findRecentAcceptedForCategory(category: RequestCategory, sampleSize: number) {
    return prisma.request.findMany({
      where: {category, acceptedAt: {not: null}},
      orderBy: {acceptedAt: 'desc'},
      take: sampleSize,
      select: {requesterDeclarationAt: true, acceptedAt: true},
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

  // --- Notification reminder sweep candidates (backend Phase 12, notificationReminderJob) -----

  /** Still RECORDING and not yet reminded, past the recording-reminder threshold. */
  findRecordingReminderCandidates(olderThan: Date) {
    return prisma.request.findMany({
      where: {
        status: 'RECORDING',
        recordingStartedAt: {lte: olderThan},
        recordingReminderSentAt: null,
      },
      select: {id: true, creatorId: true},
    });
  },

  /** Still REQUESTER_REVIEW and not yet reminded, past the review-reminder threshold. */
  findReviewReminderCandidates(olderThan: Date) {
    return prisma.request.findMany({
      where: {
        status: 'REQUESTER_REVIEW',
        moderatorDecisionAt: {lte: olderThan},
        reviewReminderSentAt: null,
      },
      select: {id: true, requesterId: true},
    });
  },

  /** Still REQUESTER_REVIEW, not yet warned, past the 42h auto-accept-warning threshold (v2.1, backend Phase 3 item 5). */
  findAutoAcceptWarningCandidates(olderThan: Date) {
    return prisma.request.findMany({
      where: {
        status: 'REQUESTER_REVIEW',
        moderatorDecisionAt: {lte: olderThan},
        autoAcceptWarningSentAt: null,
      },
      select: {id: true, requesterId: true},
    });
  },

  /** Still REQUESTER_REVIEW past the 48h auto-accept threshold (v2.1, backend Phase 3 item 5). */
  findAutoAcceptCandidates(olderThan: Date) {
    return prisma.request.findMany({
      where: {
        status: 'REQUESTER_REVIEW',
        moderatorDecisionAt: {lte: olderThan},
      },
      select: {id: true, requesterId: true},
    });
  },

  /** COMPLETED, not yet reminded, past the rating-reminder threshold — filtered for missing ratings in the service layer. */
  findRatingReminderCandidates(olderThan: Date) {
    return prisma.request.findMany({
      where: {
        status: 'COMPLETED',
        requesterDecisionAt: {lte: olderThan},
        ratingReminderSentAt: null,
      },
      select: {id: true, requesterId: true, creatorId: true},
    });
  },

  // --- Admin: Live Monitoring / Active Request Dashboard (PRD §5.14.2/§5.14.3, backend Phase 11) --

  /**
   * Per-status counts across every currently-non-terminal Request — the Live Monitoring
   * Dashboard's per-stage tile row. `terminalStatuses` is passed in by the caller
   * (`requestStateMachine.TERMINAL_STATUSES`) so this repository doesn't duplicate that
   * business rule, matching the existing `countActiveForUser` convention above.
   */
  async countGroupedByLiveStatus(terminalStatuses: RequestStatus[]) {
    const rows = await prisma.request.groupBy({
      by: ['status'],
      _count: {_all: true},
      where: {status: {notIn: terminalStatuses}},
    });
    return rows.map(row => ({status: row.status, count: row._count._all}));
  },

  /** Total non-terminal ("live") Request count — the Live Monitoring Dashboard's headline tile. */
  countActiveTotal(terminalStatuses: RequestStatus[]) {
    return prisma.request.count({where: {status: {notIn: terminalStatuses}}});
  },

  /** Live Monitoring map pins (PRD §5.14.2 "Map view of active pins") — capped, coordinates only. */
  findActivePins(terminalStatuses: RequestStatus[], limit: number) {
    return prisma.request.findMany({
      where: {status: {notIn: terminalStatuses}},
      select: {id: true, latitude: true, longitude: true, status: true, category: true},
      take: limit,
    });
  },

  /** Requests created since `since` (for "Total Requests Today", PRD §5.14.1). */
  countCreatedSince(since: Date) {
    return prisma.request.count({where: {createdAt: {gte: since}}});
  },

  /**
   * COMPLETED requests fulfilled by `creatorId` — Verified Creator Badge's `completedCount`
   * (backend Phase 7). Matches on `creatorId`, not `lastAssignedCreatorId`, since only a
   * genuinely-completed request should count (a timed-out/abandoned acceptance never reaches
   * COMPLETED and nulls `creatorId` via the acceptance-timer sweep, correctly excluding it).
   */
  countCompletedForCreator(creatorId: string) {
    return prisma.request.count({where: {creatorId, status: 'COMPLETED'}});
  },

  /**
   * Active Request Dashboard (PRD §5.14.3) — every currently in-flight Request (non-terminal,
   * or a specific status the Admin filtered to), newest-first, with just enough
   * requester/creator identity for the admin list view (no full profile join).
   */
  findManyActiveForAdmin(params: {
    status?: RequestStatus;
    terminalStatuses: RequestStatus[];
    skip: number;
    take: number;
  }) {
    const where: Prisma.RequestWhereInput = {
      status: params.status ?? {notIn: params.terminalStatuses},
    };
    return Promise.all([
      prisma.request.findMany({
        where,
        orderBy: {createdAt: 'desc'},
        skip: params.skip,
        take: params.take,
        include: {
          requester: {select: {id: true, name: true, username: true}},
          creator: {select: {id: true, name: true, username: true}},
        },
      }),
      prisma.request.count({where}),
    ]);
  },
};
