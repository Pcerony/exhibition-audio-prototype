const CURRENT_KEY = 'exhibition-qr-current-request-v1';
const PENDING_KEY = 'exhibition-qr-pending-request-v1';
const HISTORY_KEY = 'exhibition-qr-history-v1';

export function qrHistoryStorageKey(userId: string): string {
  return `${HISTORY_KEY}:${userId}`;
}

export function clearQrFallbackSession(userId: string | null | undefined): void {
  try {
    const prefixes = [CURRENT_KEY, PENDING_KEY, HISTORY_KEY].map((key) => `${key}:`);
    const keys = userId
      ? prefixes.map((prefix) => `${prefix}${userId}`)
      : Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
        .filter((key): key is string => Boolean(key && prefixes.some((prefix) => key.startsWith(prefix))));
    keys.forEach((key) => sessionStorage.removeItem(key));
  } catch {
    // Logout should not depend on browser storage availability.
  }
}
