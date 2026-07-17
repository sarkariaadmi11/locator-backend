import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {ledgerService} from '../ledgerService';
import {matchingWindowService} from '../matchingWindowService';

/**
 * DB-backed integration test for Highest Rated acceptance mode's matching window (backend Phase
 * 4 item 4, PRD_TRD_SUMMARY.md §5.6/§5.7). `respond()` needs no Redis (unlike `accept()`'s
 * mutex), so this suite can run in this environment even though `acceptMutex.integration.test.ts`
 * cannot (see that file's Redis-unavailable note) — a useful independent signal that the new
 * matching-window code path itself is correct, separate from the pre-existing Redis-lock gap.
 */
describe('matchingWindowService (integration)', () => {
  let requesterId: string;
  let creatorAId: string;
  let creatorBId: string;

  const LOCATION = {latitude: 12.9716, longitude: 77.5946};

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Matching Window Requester',
        username: `mw-requester-${suffix}`,
        email: `mw-requester-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    const creatorA = await prisma.user.create({
      data: {
        name: 'Matching Window Creator A',
        username: `mw-creator-a-${suffix}`,
        email: `mw-creator-a-${suffix}@test.local`,
        password: 'hashed',
        availabilityStatus: 'ONLINE',
        creatorConnects: 5,
      },
    });
    const creatorB = await prisma.user.create({
      data: {
        name: 'Matching Window Creator B',
        username: `mw-creator-b-${suffix}`,
        email: `mw-creator-b-${suffix}@test.local`,
        password: 'hashed',
        availabilityStatus: 'ONLINE',
        creatorConnects: 5,
      },
    });
    requesterId = requester.id;
    creatorAId = creatorA.id;
    creatorBId = creatorB.id;
  });

  afterEach(async () => {
    const ids = [requesterId, creatorAId, creatorBId];
    await prisma.notification.deleteMany({where: {userId: {in: ids}}});
    await prisma.ledgerEntry.deleteMany({where: {userId: {in: ids}}});
    await prisma.matchingWindowResponse.deleteMany({where: {requestId: {in: await requestIdsFor(requesterId)}}});
    await prisma.rating.deleteMany({where: {rateeId: {in: ids}}});
    await prisma.requestEscrow.deleteMany({where: {request: {requesterId}}});
    await prisma.request.deleteMany({where: {requesterId}});
    await prisma.verifiedCreatorStatus.deleteMany({where: {userId: {in: ids}}});
    await prisma.user.deleteMany({where: {id: {in: ids}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function requestIdsFor(reqId: string) {
    const rows = await prisma.request.findMany({where: {requesterId: reqId}, select: {id: true}});
    return rows.map(r => r.id);
  }

  async function createMatchingWindowRequest(closesInMs: number, currencyMode: 'CREDIT' | 'INR' = 'CREDIT') {
    return prisma.request.create({
      data: {
        requesterId,
        latitude: LOCATION.latitude,
        longitude: LOCATION.longitude,
        radiusMeters: 500,
        locationCategory: 'PUBLIC',
        description: 'Matching window integration test request',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        currencyMode,
        acceptanceMode: 'HIGHEST_RATED',
        status: 'MATCHING_WINDOW',
        matchingWindowClosesAt: new Date(Date.now() + closesInMs),
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  }

  it('respond() records a response and is idempotent on retry', async () => {
    const request = await createMatchingWindowRequest(60_000);

    await matchingWindowService.respond(creatorAId, request.id, LOCATION);
    await matchingWindowService.respond(creatorAId, request.id, LOCATION); // retry, must not throw

    const responses = await prisma.matchingWindowResponse.findMany({where: {requestId: request.id}});
    expect(responses).toHaveLength(1);
    expect(responses[0]!.connectReservationStatus).toBe('RESERVED');
  });

  it('respond() rejects once the window has closed', async () => {
    const request = await createMatchingWindowRequest(-1_000); // already elapsed

    await expect(matchingWindowService.respond(creatorAId, request.id, LOCATION)).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('respond() rejects a Creator with insufficient Connects', async () => {
    const request = await createMatchingWindowRequest(60_000);
    await prisma.user.update({where: {id: creatorAId}, data: {creatorConnects: 0}});

    await expect(matchingWindowService.respond(creatorAId, request.id, LOCATION)).rejects.toMatchObject({
      statusCode: 402,
    });
  });

  it('closeWindow() falls back to PUBLISHED/FIRST_ACCEPTED when nobody responded', async () => {
    const request = await createMatchingWindowRequest(-1_000);

    await matchingWindowService.closeWindow(request.id);

    const after = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(after.status).toBe('PUBLISHED');
    expect(after.acceptanceMode).toBe('FIRST_ACCEPTED');
    expect(after.matchingWindowClosesAt).toBeNull();
  });

  it('closeWindow() picks the higher-rated respondent, spends their Connect, and releases the other', async () => {
    // Window must still be open for respond() to succeed; closeWindow() itself doesn't re-check
    // matchingWindowClosesAt (only the sweep job's own query filters by due time), so calling it
    // directly here (rather than waiting out the window) is a faithful simulation of the sweep.
    const request = await createMatchingWindowRequest(60_000, 'CREDIT');

    // Give Creator B a strong rating history so they win over unrated Creator A. Ratings need a
    // real Request FK — reuse a throwaway completed-ish request per rating.
    for (let i = 0; i < 5; i++) {
      const fillerRequest = await prisma.request.create({
        data: {
          requesterId,
          latitude: LOCATION.latitude,
          longitude: LOCATION.longitude,
          locationCategory: 'PUBLIC',
          description: 'Filler request for rating fixture',
          durationMinutes: 5,
          rewardAmount: 150,
          category: 'OTHER',
          currencyMode: 'CREDIT',
          requesterDeclarationAt: new Date(),
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await prisma.rating.create({
        data: {
          requestId: fillerRequest.id,
          raterId: requesterId,
          rateeId: creatorBId,
          role: 'REQUESTER_RATES_CREATOR',
          stars: 5,
        },
      });
    }

    await matchingWindowService.respond(creatorAId, request.id, LOCATION);
    await matchingWindowService.respond(creatorBId, request.id, LOCATION);

    // Force the window closed regardless of its stored closesAt.
    await matchingWindowService.closeWindow(request.id);

    const after = await prisma.request.findUniqueOrThrow({where: {id: request.id}});
    expect(after.status).toBe('CREATOR_ASSIGNED');
    expect(after.creatorId).toBe(creatorBId);
    expect(after.matchingWindowClosesAt).toBeNull();

    const winnerBalances = await ledgerService.getBalances(creatorBId);
    expect(winnerBalances.creatorConnects).toBe(4); // 5 - 1 (ACCEPT_REQUEST_CONNECTS default)

    const loserBalances = await ledgerService.getBalances(creatorAId);
    expect(loserBalances.creatorConnects).toBe(5); // untouched

    const responses = await prisma.matchingWindowResponse.findMany({where: {requestId: request.id}});
    const winnerRow = responses.find(r => r.creatorId === creatorBId);
    const loserRow = responses.find(r => r.creatorId === creatorAId);
    expect(winnerRow?.connectReservationStatus).toBe('SPENT');
    expect(loserRow?.connectReservationStatus).toBe('RELEASED');
  });
});
