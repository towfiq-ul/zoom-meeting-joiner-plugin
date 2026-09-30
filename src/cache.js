// Cache persistence helpers for Meeting Invite Scanner
// Stores meeting ID + passcode locally for up to 8 hours.

export const CACHE_KEY = "zmj_meetingCache";
export const NAME_KEY = "zmj_userName";
export const CACHE_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

/**
 * Check if a cache entry is still valid (under 8 hours old and has a meeting ID).
 * @param {{ meetingId?: string, passcode?: string, timestamp?: number }|null} entry
 * @param {number} [now]
 * @returns {boolean}
 */
export function isCacheValid(entry, now = Date.now()) {
  if (!entry || typeof entry !== "object") return false;
  if (!entry.meetingId || typeof entry.meetingId !== "string") return false;
  if (!entry.timestamp || typeof entry.timestamp !== "number") return false;
  return now - entry.timestamp >= 0 && now - entry.timestamp < CACHE_TTL_MS;
}

/**
 * Create a new cache entry object with sanitized values and current timestamp.
 * @param {string} meetingId
 * @param {string} [passcode]
 * @param {number} [now]
 * @returns {{ meetingId: string, passcode: string, timestamp: number }}
 */
export function createCacheEntry(meetingId, passcode = "", now = Date.now()) {
  return {
    meetingId: String(meetingId).replace(/\D/g, ""),
    passcode: String(passcode || "").trim(),
    timestamp: now,
  };
}
