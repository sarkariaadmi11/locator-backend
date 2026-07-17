import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {queryService} from '../queryService';

/**
 * DB-backed integration test for Pre-Acceptance Query (PRD_TRD_SUMMARY.md §4.6, backend Phase
 * 4) — the v2.1 replacement for the old post-acceptance `ChatMessage`/`TEMPORARY_CHAT` flow.
 * Does not require Redis (unlike `acceptMutex.integration.test.ts`) since query threads never
 * touch the creator lock — this is why the full `requestService.accept` -> `closeAllForRequest`
 * wiring is exercised only at the `closeAllForRequest` level here rather than through `accept`
 * itself, which needs Redis to acquire the mutex.
 */
describe('queryService (integration)', () => {
  let requesterId: string;
  let creatorId: string;
  let requestId: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    const requester = await prisma.user.create({
      data: {
        name: 'Query Test Requester',
        username: `query-requester-${suffix}`,
        email: `query-requester-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    const creator = await prisma.user.create({
      data: {
        name: 'Query Test Creator',
        username: `query-creator-${suffix}`,
        email: `query-creator-${suffix}@test.local`,
        password: 'hashed',
      },
    });
    requesterId = requester.id;
    creatorId = creator.id;

    const request = await prisma.request.create({
      data: {
        requesterId,
        latitude: 12.9716,
        longitude: 77.5946,
        locationCategory: 'PUBLIC',
        description: 'Query integration test request description',
        durationMinutes: 5,
        rewardAmount: 150,
        category: 'OTHER',
        status: 'PUBLISHED',
        requesterDeclarationAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    requestId = request.id;
  });

  afterEach(async () => {
    await prisma.notification.deleteMany({where: {userId: {in: [requesterId, creatorId]}}});
    await prisma.preAcceptanceQueryMessage.deleteMany({where: {query: {requestId}}});
    await prisma.preAcceptanceQuery.deleteMany({where: {requestId}});
    await prisma.request.deleteMany({where: {id: requestId}});
    await prisma.user.deleteMany({where: {id: {in: [requesterId, creatorId]}}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('creates a thread on first ask and increments exchangeCount only for the Creator', async () => {
    const thread = await queryService.ask(creatorId, requestId, 'What time is the event?');
    expect(thread.exchangeCount).toBe(1);
    expect(thread.messages).toHaveLength(1);

    const afterReply = await queryService.reply(requesterId, requestId, thread.id, 'Around 6pm.');
    expect(afterReply.exchangeCount).toBe(1); // Requester replies never count against the cap
    expect(afterReply.messages).toHaveLength(2);
  });

  it('blocks the 4th question with a 409 after 3 exchanges', async () => {
    let thread = await queryService.ask(creatorId, requestId, 'Question one is here');
    thread = await queryService.ask(creatorId, requestId, 'Question two is here');
    thread = await queryService.ask(creatorId, requestId, 'Question three is here');
    expect(thread.exchangeCount).toBe(3);

    await expect(queryService.ask(creatorId, requestId, 'Question four is here')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('filters out a blocked message (phone number) and still throws 422', async () => {
    await expect(queryService.ask(creatorId, requestId, 'Call me at 9876543210')).rejects.toMatchObject({
      statusCode: 422,
    });

    const threads = await queryService.list(requesterId, requestId);
    expect(threads[0].messages).toHaveLength(0); // blocked message never surfaced
  });

  it('keeps per-Creator threads mutually invisible to other Creators', async () => {
    const otherCreator = await prisma.user.create({
      data: {
        name: 'Other Creator',
        username: `query-other-creator-${randomUUID()}`,
        email: `query-other-creator-${randomUUID()}@test.local`,
        password: 'hashed',
      },
    });

    await queryService.ask(creatorId, requestId, 'My question here');
    await queryService.ask(otherCreator.id, requestId, 'A different question');

    const creatorAThreads = await queryService.list(creatorId, requestId);
    expect(creatorAThreads).toHaveLength(1);
    expect(creatorAThreads[0].creatorId).toBe(creatorId);

    const requesterThreads = await queryService.list(requesterId, requestId);
    expect(requesterThreads).toHaveLength(2); // Requester sees every thread

    await prisma.notification.deleteMany({where: {userId: otherCreator.id}});
    await prisma.preAcceptanceQueryMessage.deleteMany({where: {query: {creatorId: otherCreator.id}}});
    await prisma.preAcceptanceQuery.deleteMany({where: {creatorId: otherCreator.id}});
    await prisma.user.delete({where: {id: otherCreator.id}});
  });

  it('closeAllForRequest closes every OPEN thread on acceptance', async () => {
    const thread = await queryService.ask(creatorId, requestId, 'A question before accepting');
    expect(thread.status).toBe('OPEN');

    await queryService.closeAllForRequest(requestId);

    const threads = await queryService.list(requesterId, requestId);
    expect(threads[0].status).toBe('CLOSED_ACCEPTED');

    // A closed thread can no longer be replied to.
    await expect(queryService.reply(requesterId, requestId, thread.id, 'too late')).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('decline closes the thread without affecting other Creators\' threads', async () => {
    const thread = await queryService.ask(creatorId, requestId, 'Question before declining');
    const declined = await queryService.decline(creatorId, requestId, thread.id);
    expect(declined.status).toBe('CLOSED_DECLINED');
  });
});
