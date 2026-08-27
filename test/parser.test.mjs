/**
 * Unit tests for the extraction core. Run: node --test
 * (No browser needed — parser.js is pure.)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { extractMeetingInfo, formatMeetingId, buildJoinUrl } from "../src/parser.js";

test("sample invite screenshot text (spaced ID + leading-zero passcode)", () => {
  const text = `
    Join meeting 893 6612 6292
    Contacts        Email
    Copy invitation
    Meeting passcode: 017970    Invite
    Open recordings >
  `;
  const r = extractMeetingInfo(text);
  assert.equal(r.meetingId, "89366126292");
  assert.equal(r.passcode, "017970"); // leading zero preserved
  assert.equal(r.meetingIdFormatted, "893 6612 6292");
  assert.equal(r.confidence, "high");
});

test("Meeting ID label form", () => {
  const r = extractMeetingInfo("Meeting ID: 123 4567 8901\nPasscode ABC123");
  assert.equal(r.meetingId, "12345678901");
  assert.equal(r.passcode, "ABC123");
});

test("OCR glyph confusion in the ID is corrected", () => {
  // O->0, l->1, S->5, B->8  inside the numeric run
  const r = extractMeetingInfo("Join meeting 8O3 66l2 6292\nPasscode: 017970");
  assert.equal(r.meetingId, "80366126292");
});

test("passcode is left verbatim (no glyph 'correction')", () => {
  const r = extractMeetingInfo("Meeting ID 1234567890\nPassword: lOSB99");
  assert.equal(r.passcode, "lOSB99");
});

test("full join URL with pwd", () => {
  const r = extractMeetingInfo(
    "Join Zoom Meeting\nhttps://us02web.zoom.us/j/89366126292?pwd=aB3dEf.gHi"
  );
  assert.equal(r.meetingId, "89366126292");
  assert.equal(r.passcode, "aB3dEf.gHi");
  assert.equal(r.sources.meetingId, "url");
});

test("10-digit personal meeting id", () => {
  assert.equal(formatMeetingId("1234567890"), "123 456 7890");
  const r = extractMeetingInfo("Personal Meeting ID: 123-456-7890");
  assert.equal(r.meetingId, "1234567890");
});

test("no meeting id -> low confidence, empty", () => {
  const r = extractMeetingInfo("hello world, no zoom here");
  assert.equal(r.meetingId, "");
  assert.equal(r.confidence, "low");
});

test("over-captured run is trimmed to a valid length", () => {
  // passcode digits bleed onto the same line as the ID
  const r = extractMeetingInfo("Meeting ID: 89366126292 017970");
  assert.equal(r.meetingId, "89366126292");
});

test('real OCR: cropped "Join" reads as "in meeting" + labelless passcode', () => {
  // exactly what Tesseract returns for assets/sample-invite.jpeg
  const text =
    "in meeting 893 6612 6292 | Contacts | ink Copy invitation | 017970 | hg Home =";
  const r = extractMeetingInfo(text);
  assert.equal(r.meetingId, "89366126292");
  assert.equal(r.passcode, "017970"); // recovered without a "passcode:" label
});

test('real OCR: "meeting" cue does not eat the g into the number', () => {
  const r = extractMeetingInfo("oin meeting 893 6612 6292");
  assert.equal(r.meetingId, "89366126292"); // not "989366126292"
});

test("labelless numeric noise does not become a passcode when a real one exists", () => {
  const r = extractMeetingInfo("Meeting ID: 1234567890\nPasscode: 4Xy8Q1");
  assert.equal(r.passcode, "4Xy8Q1");
});

test("buildJoinUrl app form has confno, pwd, uname", () => {
  const u = buildJoinUrl("app", { meetingId: "89366126292", passcode: "017970", userName: "Towfiq" });
  assert.match(u, /^zoommtg:\/\/zoom\.us\/join\?action=join&confno=89366126292/);
  assert.match(u, /&pwd=017970/);
  assert.match(u, /&uname=Towfiq/);
});

test("buildJoinUrl web form points at app.zoom.us/wc", () => {
  const u = buildJoinUrl("web", { meetingId: "89366126292", passcode: "017970", userName: "Towfiq" });
  assert.match(u, /^https:\/\/app\.zoom\.us\/wc\/89366126292\/join\?fromPWA=1/);
  assert.match(u, /&pwd=017970/);
});

test("buildJoinUrl encodes special chars in passcode/name", () => {
  const u = buildJoinUrl("app", { meetingId: "1234567890", passcode: "a b&c", userName: "Tow Fiq" });
  assert.match(u, /&pwd=a%20b%26c/);
  assert.match(u, /&uname=Tow%20Fiq/);
});

test("buildJoinUrl throws without a meeting id", () => {
  assert.throws(() => buildJoinUrl("app", { meetingId: "", passcode: "x", userName: "y" }));
});
