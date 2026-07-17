import {logger} from '../config/logger';
import {requestRepository} from '../repositories/requestRepository';
import {matchingWindowService} from './matchingWindowService';

/**
 * Highest Rated matching-window close sweep (PRD_TRD_SUMMARY.md §5.6/§5.7, backend Phase 4 item
 * 4) — same in-process `setInterval` pattern as every other sweep job in this codebase (see
 * `acceptanceTimerJob.ts`). Runs more frequently than the window itself (default 90s, admin-
 * configurable 30-300s) so a closed window is picked up within one tick, not one full window
 * length late.
 */
export const matchingWindowJob = {
  async runSweep() {
    const due = await requestRepository.findMatchingWindowDue(new Date());
    let closed = 0;

    for (const request of due) {
      try {
        await matchingWindowService.closeWindow(request.id);
        closed += 1;
      } catch (err) {
        logger.error(`[matchingWindowJob] Failed to close window for request ${request.id}: ${(err as Error).message}`);
      }
    }

    if (closed > 0) {
      logger.info(`[matchingWindowJob] Closed ${closed} matching window(s).`);
    }
    return closed;
  },
};
