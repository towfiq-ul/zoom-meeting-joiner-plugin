import test from "node:test";
import assert from "node:assert/strict";
import { combineResults } from "../src/combine.js";

const R = (meetingId, passcode, sources = {}) => ({ meetingId, passcode, sources });

test("two variants agreeing on both values -> high confidence", () => {
  const out = combineResults([
    R("89366126292", "017970", { meetingId: "label", passcode: "label" }),
    R("89366126292", "017970", { meetingId: "label", passcode: "loose" }),
  ]);
  assert.equal(out.meetingId, "89366126292");
  assert.equal(out.passcode, "017970");
  assert.equal(out.confidence, "high");
});

test("a 10-digit prefix misread folds into the correct 11-digit ID", () => {
  // real case: only one variant read the full number; others dropped/garbled the tail
  const out = combineResults([
    R("8936612629", "", { meetingId: "label" }), // trailing digit dropped
    R("89366126292", "017970", { meetingId: "label", passcode: "loose" }), // correct
    R("", "", {}),
    R("89366126249", "", { meetingId: "label" }), // tail garbled, not a prefix
  ]);
  assert.equal(out.meetingId, "89366126292");
  assert.equal(out.passcode, "017970");
});

test("majority breaks an OCR tie between 6292 and 6297", () => {
  const out = combineResults([
    R("89366126292", "017970", { meetingId: "label", passcode: "label" }),
    R("89366126297", "017970", { meetingId: "label", passcode: "loose" }),
    R("89366126292", "", { meetingId: "scan" }),
    R("89366126292", "017970", { meetingId: "label", passcode: "loose" }),
  ]);
  assert.equal(out.meetingId, "89366126292");
  assert.equal(out.passcode, "017970");
});

test("a single lucky variant still yields the id at medium/low", () => {
  const out = combineResults([
    R("", "048349", { passcode: "loose" }),
    R("", "048349", { passcode: "loose" }),
    R("85119875308", "", { meetingId: "label" }),
  ]);
  assert.equal(out.meetingId, "85119875308");
  assert.equal(out.passcode, "048349");
  assert.ok(["medium", "high"].includes(out.confidence));
});

test("URL source outweighs a conflicting scanned number", () => {
  const out = combineResults([
    R("11122233344", "abcABC", { meetingId: "url", passcode: "url" }),
    R("99988877766", "", { meetingId: "scan" }),
    R("99988877766", "", { meetingId: "scan-trim" }),
  ]);
  assert.equal(out.meetingId, "11122233344");
});

test("nothing found -> low, empty", () => {
  const out = combineResults([R("", ""), R("", "")]);
  assert.equal(out.meetingId, "");
  assert.equal(out.confidence, "low");
});

test("conflicting unlabelled passcode guesses are dropped, not guessed", () => {
  const out = combineResults([
    R("89366126292", "012470", { meetingId: "label", passcode: "loose" }),
    R("89366126292", "012920", { meetingId: "label", passcode: "loose" }),
    R("89366126292", "012970", { meetingId: "label", passcode: "loose" }),
  ]);
  assert.equal(out.meetingId, "89366126292");
  assert.equal(out.passcode, ""); // none agreed -> blank
  assert.equal(out.passcodeUnreadable, true);
});

test("two variants agreeing on a loose passcode keep it", () => {
  const out = combineResults([
    R("89366126292", "017970", { meetingId: "label", passcode: "loose" }),
    R("89366126292", "017970", { meetingId: "label", passcode: "loose" }),
    R("89366126292", "01799", { meetingId: "label", passcode: "loose" }),
  ]);
  assert.equal(out.passcode, "017970");
  assert.equal(out.passcodeUnreadable, false);
});
