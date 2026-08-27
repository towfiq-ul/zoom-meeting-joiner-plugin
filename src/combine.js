/**
 * combine.js — merge extractMeetingInfo() results from several OCR variants
 * by weighted majority vote. Pure; unit-tested.
 */

const SOURCE_WEIGHT = { url: 3, label: 2, "cue-trim": 1, scan: 1, "scan-trim": 1, loose: 1, none: 0 };

/**
 * @param {Array<{meetingId?:string,passcode?:string,sources?:object}>} results
 * @param {"meetingId"|"passcode"} key
 */
function tally(results, key) {
  const score = new Map(); // value -> summed weight
  const seen = new Map(); // value -> variants that produced it
  for (const r of results) {
    const v = r[key];
    if (!v) continue;
    let w = SOURCE_WEIGHT[r.sources?.[key]] ?? 1;
    // an ID that turned up in the same read as a passcode is more trustworthy
    if (key === "meetingId" && r.passcode) w += 1;
    score.set(v, (score.get(v) || 0) + w);
    seen.set(v, (seen.get(v) || 0) + 1);
  }

  // Fold a shorter meeting ID into a longer one it's a strict prefix of
  // (OCR often drops the trailing digit): "8936612629" -> "89366126292".
  if (key === "meetingId") {
    const keys = [...score.keys()].sort((a, b) => b.length - a.length);
    for (const long of keys) {
      if (!/^\d{10,11}$/.test(long) || !score.has(long)) continue;
      for (const short of keys) {
        if (short === long || short.length >= long.length) continue;
        if (short.length >= 9 && long.startsWith(short)) {
          score.set(long, score.get(long) + score.get(short));
          seen.set(long, (seen.get(long) || 0) + (seen.get(short) || 0));
          score.delete(short);
          seen.delete(short);
        }
      }
    }
  }

  let best = "";
  let bestScore = -1;
  for (const [v, s] of score) {
    const better =
      s > bestScore ||
      (s === bestScore && (seen.get(v) || 0) > (seen.get(best) || 0)) ||
      (s === bestScore &&
        (seen.get(v) || 0) === (seen.get(best) || 0) &&
        v.length > best.length); // prefer the 11-digit form on a dead tie
    if (better) {
      best = v;
      bestScore = s;
    }
  }
  return { value: best, score: bestScore, votes: seen.get(best) || 0, distinct: score.size };
}

/**
 * @param {Array<ReturnType<import("./parser.js").extractMeetingInfo>>} results
 * @returns {{meetingId:string, passcode:string, confidence:"high"|"medium"|"low",
 *            agreement:{id:object, passcode:object}}}
 */
export function combineResults(results) {
  const id = tally(results, "meetingId");
  const pc = tally(results, "passcode");

  // If the variants produced several *different* unlabelled passcode guesses
  // and none of them agree, that's OCR noise — a confidently wrong passcode is
  // worse than none, so drop it and let the user type it.
  const pcReliable =
    !!pc.value && (pc.votes >= 2 || pc.score >= 2 || pc.distinct <= 1);
  const passcode = pcReliable ? pc.value : "";

  let confidence = "low";
  if (id.value) {
    const strongId = id.score >= 4 || id.votes >= 2;
    const strongPc = pcReliable && (pc.score >= 3 || pc.votes >= 2);
    if (strongId && strongPc) confidence = "high";
    else if (strongId || passcode) confidence = "medium";
  }

  return {
    meetingId: id.value,
    passcode,
    passcodeUnreadable: !!pc.value && !pcReliable,
    confidence,
    agreement: { id, passcode: pc },
  };
}
