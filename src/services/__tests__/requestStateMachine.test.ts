import {assertTransition, canTransition, getValidNextStatuses, isTerminalStatus} from '../requestStateMachine';
import {HttpError} from '../../utils/httpError';

describe('requestStateMachine', () => {
  it('allows every documented PRD §5.13 happy-path transition', () => {
    expect(canTransition('DRAFT', 'PUBLISHED')).toBe(true);
    expect(canTransition('PUBLISHED', 'CREATOR_ASSIGNED')).toBe(true);
    expect(canTransition('CREATOR_ASSIGNED', 'TEMPORARY_CHAT')).toBe(true);
    expect(canTransition('TEMPORARY_CHAT', 'RECORDING')).toBe(true);
    expect(canTransition('RECORDING', 'UPLOAD')).toBe(true);
    expect(canTransition('UPLOAD', 'MODERATOR_REVIEW')).toBe(true);
    expect(canTransition('MODERATOR_REVIEW', 'REQUESTER_REVIEW')).toBe(true);
    expect(canTransition('REQUESTER_REVIEW', 'ACCEPTED')).toBe(true);
    expect(canTransition('ACCEPTED', 'PAYMENT_RELEASED')).toBe(true);
    expect(canTransition('PAYMENT_RELEASED', 'COMPLETED')).toBe(true);
  });

  it('rejects a transition that skips the moderation stage', () => {
    expect(canTransition('UPLOAD', 'REQUESTER_REVIEW')).toBe(false);
  });

  it('flags every PRD §5.13 terminal state as terminal', () => {
    for (const status of ['COMPLETED', 'REJECTED', 'DISPUTED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(isTerminalStatus(status)).toBe(true);
    }
  });

  it('DISPUTED/EXPIRED/CANCELLED are absolutely final — no further transition exists', () => {
    for (const status of ['DISPUTED', 'EXPIRED', 'CANCELLED'] as const) {
      expect(getValidNextStatuses(status)).toEqual([]);
    }
  });

  it('COMPLETED/REJECTED are terminal for normal flow but a dispute can still be raised against them', () => {
    expect(getValidNextStatuses('COMPLETED')).toEqual(['DISPUTED']);
    expect(getValidNextStatuses('REJECTED')).toEqual(['DISPUTED']);
  });

  it('assertTransition throws an HttpError(409) on an invalid transition', () => {
    expect(() => assertTransition('DRAFT', 'COMPLETED')).toThrow(HttpError);
    try {
      assertTransition('DRAFT', 'COMPLETED');
    } catch (err) {
      expect((err as HttpError).statusCode).toBe(409);
    }
  });

  it('assertTransition is a no-op on a valid transition', () => {
    expect(() => assertTransition('DRAFT', 'PUBLISHED')).not.toThrow();
  });

  it('allows a dispute to be raised from every PRD-designated source status', () => {
    for (const status of ['REQUESTER_REVIEW', 'ACCEPTED', 'PAYMENT_RELEASED', 'COMPLETED', 'REJECTED'] as const) {
      expect(canTransition(status, 'DISPUTED')).toBe(true);
    }
  });
});
