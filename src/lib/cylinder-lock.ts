/** Issue locks older than this are treated as expired and may be claimed again. */
export const ISSUE_LOCK_TTL_MS = 2 * 60 * 1000;

export function issueLockIsActive(lock: string | null | undefined, now = Date.now()): boolean {
  if (!lock) return false;
  const t = Date.parse(lock);
  if (Number.isNaN(t)) return true;
  return now - t < ISSUE_LOCK_TTL_MS;
}

export function issueLockExpiredBefore(now = Date.now()): string {
  return new Date(now - ISSUE_LOCK_TTL_MS).toISOString();
}
