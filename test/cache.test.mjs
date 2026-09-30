import test from "node:test";
import assert from "node:assert/strict";
import { isCacheValid, createCacheEntry, CACHE_TTL_MS } from "../src/cache.js";

test("creates valid cache entry with sanitized values", () => {
  const now = 1700000000000;
  const entry = createCacheEntry("848 6675 0427", " 223999 ", now);
  assert.deepEqual(entry, {
    meetingId: "84866750427",
    passcode: "223999",
    timestamp: now,
  });
});

test("cache entry under 8 hours is valid", () => {
  const now = 1700000000000;
  const entry = createCacheEntry("84866750427", "223999", now - (4 * 60 * 60 * 1000));
  assert.equal(isCacheValid(entry, now), true);
});

test("cache entry exactly at 8 hours is expired", () => {
  const now = 1700000000000;
  const entry = createCacheEntry("84866750427", "223999", now - CACHE_TTL_MS);
  assert.equal(isCacheValid(entry, now), false);
});

test("cache entry older than 8 hours is expired", () => {
  const now = 1700000000000;
  const entry = createCacheEntry("84866750427", "223999", now - (CACHE_TTL_MS + 1000));
  assert.equal(isCacheValid(entry, now), false);
});

test("invalid or null entries are rejected", () => {
  assert.equal(isCacheValid(null), false);
  assert.equal(isCacheValid(undefined), false);
  assert.equal(isCacheValid({}), false);
  assert.equal(isCacheValid({ meetingId: "" }), false);
  assert.equal(isCacheValid({ meetingId: "123", timestamp: "not-a-number" }), false);
});
