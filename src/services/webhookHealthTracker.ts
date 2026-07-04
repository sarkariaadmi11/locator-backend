// In-memory rolling window of Razorpay webhook failures (backend Phase 14 monitoring, PRD §11
// "failed webhook > 5/hour"). Deliberately not persisted — this is an operational signal for the
// in-process `monitoringJob` sweep, not an audit trail (Transaction/AdminAuditLog already cover
// the durable payment record). Resets on process restart, which is acceptable for an alerting
// heuristic at this MVP scale (matches every other in-process-only job in this codebase — no job
// queue/shared-cache dependency exists for this yet).
const failureTimestamps: number[] = [];
const ONE_HOUR_MS = 60 * 60 * 1000;

export function recordWebhookFailure(): void {
  failureTimestamps.push(Date.now());
}

export function getWebhookFailureCountLastHour(): number {
  const cutoff = Date.now() - ONE_HOUR_MS;
  while (failureTimestamps.length > 0 && failureTimestamps[0]! < cutoff) {
    failureTimestamps.shift();
  }
  return failureTimestamps.length;
}
