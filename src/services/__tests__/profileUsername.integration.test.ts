import {randomUUID} from 'crypto';

import {prisma} from '../../prisma/client';
import {profileService} from '../profileService';

/**
 * DB-backed integration test for the v2.1 username one-change-ever rule (backend Phase 8 item
 * 8, PRD_TRD_SUMMARY.md §4.2/§10 item 1).
 */
describe('profileService — username one-change-ever (integration)', () => {
  let userId: string;
  let originalUsername: string;

  beforeEach(async () => {
    const suffix = randomUUID();
    originalUsername = `orig-user-${suffix}`;
    const user = await prisma.user.create({
      data: {name: 'Username Test User', username: originalUsername, email: `username-test-${suffix}@test.local`, password: 'hashed'},
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.deleteMany({where: {id: userId}});
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('allows the first username change and increments usernameChangedCount', async () => {
    const newUsername = `changed-${randomUUID()}`;
    await profileService.update(userId, {name: 'Username Test User', username: newUsername});

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.username).toBe(newUsername);
    expect(user.usernameChangedCount).toBe(1);
  });

  it('rejects a second username change', async () => {
    await profileService.update(userId, {name: 'Username Test User', username: `first-change-${randomUUID()}`});

    await expect(
      profileService.update(userId, {name: 'Username Test User', username: `second-change-${randomUUID()}`}),
    ).rejects.toMatchObject({statusCode: 409});
  });

  it('does not count a no-op "change" (same username re-submitted) against the limit', async () => {
    await profileService.update(userId, {name: 'Updated Name', username: originalUsername});

    const user = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(user.usernameChangedCount).toBe(0);
    expect(user.name).toBe('Updated Name');

    // A real change is still available after a no-op resubmission.
    const newUsername = `still-available-${randomUUID()}`;
    await profileService.update(userId, {name: 'Updated Name', username: newUsername});
    const afterRealChange = await prisma.user.findUniqueOrThrow({where: {id: userId}});
    expect(afterRealChange.username).toBe(newUsername);
    expect(afterRealChange.usernameChangedCount).toBe(1);
  });
});
