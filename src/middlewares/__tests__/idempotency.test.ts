import {Response} from 'express';

import {AuthenticatedRequest} from '../authMiddleware';
import {idempotency} from '../idempotency';

/**
 * Unit test for the generic Idempotency-Key middleware (backend Phase 8 item 1, TRD 8.3).
 * Redis isn't running in this environment (confirmed elsewhere in this codebase's test suite —
 * see acceptMutex.integration.test.ts's known-skip), so this only covers the two paths that
 * don't require a live connection: no header (bypass) and Redis-unavailable (fail-open). The
 * actual replay-a-cached-response behavior needs a running Redis to verify end-to-end — flagged
 * as a gap, not silently assumed to work.
 */
describe('idempotency middleware', () => {
  function mockReqRes(headers: Record<string, string> = {}) {
    const req = {
      header: (name: string) => headers[name],
      method: 'POST',
      baseUrl: '/api/wallet',
      path: '/create-order',
      user: {id: 'user-1'},
    } as unknown as AuthenticatedRequest;

    const res = {
      statusCode: 200,
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    return {req, res};
  }

  it('calls next() immediately when no Idempotency-Key header is present', () => {
    const {req, res} = mockReqRes();
    const next = jest.fn();

    idempotency(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('fails open (calls next) when Redis is unavailable, per the "safety net, not a correctness dependency" design', done => {
    const {req, res} = mockReqRes({'Idempotency-Key': 'test-key-123'});
    const next = jest.fn(() => {
      // The middleware's async IIFE resolves on a microtask — this callback proves next() was
      // reached without ever needing a real Redis connection (this test env has none).
      expect(next).toHaveBeenCalledTimes(1);
      done();
    });

    idempotency(req, res, next);
  });
});
