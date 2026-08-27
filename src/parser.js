/**
 * parser.js — pure text -> { meetingId, passcode } extraction.
 *
 * No DOM, no browser APIs: safe to unit-test under Node.
 * Input is raw OCR text (or pasted invite text). Output normalizes the
 * meeting ID to digits only and keeps the passcode as a string so a
 * leading zero (e.g. "017970") survives.
 */

// Only the *unambiguous* OCR digit confusions, applied to a span that is
// otherwise digits + separators. Deliberately NOT including letters like
// g/q/b/S/Z/T: those live inside real words ("meeting") and, if corrected,
// glue a stray digit onto the ID and blow the length check.
const SAFE_LOOKALIKES = { O: "0", o: "0", "º": "0", l: "1", I: "1", "|": "1", "!": "1" };

// separators that may sit between digit groups of an ID
const SEP = " \\t.\\-\\u00A0\\u2013\\u2014";
const SEP_RE = new RegExp(`[${SEP}]`);

/**
 * Turn a matched run (digits + separators + safe lookalikes) into pure digits.
 * Returns "" if, after fixing the safe lookalikes, anything non-digit remains.
 */
function digitsFrom(span) {
  let s = "";
  for (const ch of span) {
    if (ch >= "0" && ch <= "9") s += ch;
    else if (SAFE_LOOKALIKES[ch]) s += SAFE_LOOKALIKES[ch];
    else if (SEP_RE.test(ch)) continue; // separator -> drop
    else return ""; // an unexpected glyph -> this run isn't a clean number
  }
  return s;
}

/** Valid Zoom meeting IDs are 9, 10 or 11 digits. */
function isPlausibleMeetingId(d) {
  return /^\d{9,11}$/.test(d);
}

/**
 * Pull a meeting ID + passcode out of a Zoom join URL if one is present.
 * Handles zoom.us/j/<id>, /wc/join/<id>, /s/<id>, ?pwd=, &pwd=.
 */
function fromUrl(text) {
  const urlRe = /https?:\/\/[^\s"'<>]+/gi;
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0];
    if (!/zoom\.us|zoom\.com|zoomgov\.com/i.test(url)) continue;
    const idMatch = url.match(/\/(?:j|s|wc\/join|wc)\/(\d{9,11})/i);
    const pwdMatch = url.match(/[?&]pwd=([A-Za-z0-9._-]+)/);
    if (idMatch) {
      return {
        meetingId: idMatch[1],
        passcode: pwdMatch ? decodeURIComponent(pwdMatch[1]) : "",
        source: "url",
      };
    }
  }
  return null;
}

// A run of digit groups: "893 6612 6292", "123-456-7890", "1234567890".
// Only digits, safe lookalikes and separators — never word letters, so it
// can't swallow the "g" of "meeting" and turn an 11-digit ID into 12.
const RUN_RE = new RegExp(`[0-9OolI|!](?:[0-9OolI|!${SEP}]{5,22}[0-9OolI|!])?`, "g");

/** Every clean 9/10/11-digit number in the text, in order of appearance. */
function collectIdCandidates(text) {
  const out = [];
  let m;
  RUN_RE.lastIndex = 0;
  while ((m = RUN_RE.exec(text)) !== null) {
    const d = digitsFrom(m[0]);
    if (isPlausibleMeetingId(d)) {
      out.push({ id: d, index: m.index });
    } else if (d.length > 11 && d.length <= 24) {
      // over-captured (ID + passcode digits ran together on one line); keep the
      // 11- or 10-digit prefix as a weak candidate.
      for (const n of [11, 10]) {
        if (isPlausibleMeetingId(d.slice(0, n))) {
          out.push({ id: d.slice(0, n), index: m.index, weak: true });
          break;
        }
      }
    }
  }
  return out;
}

/**
 * Find the meeting ID. Zoom's invite screen shows it as
 * "Join meeting 893 6612 6292" (the "Join" is often cropped or OCR'd as
 * "oin"/"in") or "Meeting ID: 123 4567 8901". Collect all plausible numbers,
 * then prefer the one right after a "meeting" cue.
 */
function findMeetingId(text) {
  const candidates = collectIdCandidates(text);
  if (!candidates.length) return { meetingId: "", source: "none" };

  // end positions of every "meeting" / "meeting id" / "...oin meeting" cue
  const cueRe = /\b(?:meeting\s*(?:id|number|no)?|conference\s*id)\b|oin\s+meeting/gi;
  const cueEnds = [];
  let c;
  while ((c = cueRe.exec(text)) !== null) cueEnds.push(c.index + c[0].length);

  // first candidate that sits just after ANY cue (not merely the last cue)
  const labelled = candidates.find((k) =>
    cueEnds.some((e) => k.index >= e && k.index - e < 20)
  );
  if (labelled) {
    return { meetingId: labelled.id, source: labelled.weak ? "cue-trim" : "label" };
  }

  candidates.sort(
    (a, b) =>
      (a.weak ? 1 : 0) - (b.weak ? 1 : 0) ||
      b.id.length - a.id.length ||
      a.index - b.index
  );
  return { meetingId: candidates[0].id, source: candidates[0].weak ? "scan-trim" : "scan" };
}

const PASS_LABEL_RE =
  /(?:pass\s*code|passcode|pass\s*word|password|passwort|pwd|kod\s*dost[eę]pu|\bcode)\s*[:#\-]?\s*["']?([A-Za-z0-9@!#$%^&*_.\-]{4,16})/i;

/**
 * Find the passcode — kept verbatim (case + leading zeros preserved).
 * @param {string} text
 * @param {string} meetingId already-found ID, so we don't return a slice of it
 */
function findPasscode(text, meetingId) {
  const labelled = text.match(PASS_LABEL_RE);
  if (labelled) {
    const pc = labelled[1].replace(/^[.\-]+|[.\-]+$/g, "");
    if (pc && pc !== meetingId) return { passcode: pc, source: "label" };
  }

  // No usable label (Zoom's "Meeting passcode:" caption is often cropped off).
  // Look for a lone alphanumeric token, 5-10 chars, containing a digit, not
  // part of the meeting ID — typically the value sitting on its own line.
  const stripped = meetingId ? text.split(meetingId).join(" ") : text;
  const loose = stripped
    .split(/[\s|><)\]}(]+/)
    .map((t) => t.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((t) => /^(?=.*\d)[A-Za-z0-9]{5,10}$/.test(t))
    .filter((t) => !/^\d{9,11}$/.test(t))
    .filter((t) => !(meetingId && meetingId.includes(t)));
  if (loose.length) {
    // a purely-numeric token with a leading zero is a strong passcode signal
    loose.sort((a, b) => (/^0\d+$/.test(b) ? 1 : 0) - (/^0\d+$/.test(a) ? 1 : 0));
    return { passcode: loose[0], source: "loose" };
  }
  return { passcode: "", source: "none" };
}

/**
 * @param {string} rawText
 * @returns {{ meetingId: string, passcode: string, meetingIdFormatted: string,
 *            confidence: "high"|"medium"|"low", sources: object }}
 */
export function extractMeetingInfo(rawText) {
  const text = String(rawText || "").replace(/\r/g, "");

  const url = fromUrl(text);
  let meetingId = "";
  let passcode = "";
  const sources = {};

  if (url && url.meetingId) {
    meetingId = url.meetingId;
    sources.meetingId = "url";
    if (url.passcode) {
      passcode = url.passcode;
      sources.passcode = "url";
    }
  }

  if (!meetingId) {
    const r = findMeetingId(text);
    meetingId = r.meetingId;
    sources.meetingId = r.source;
  }
  if (!passcode) {
    const r = findPasscode(text, meetingId);
    passcode = r.passcode;
    sources.passcode = r.source;
  }

  const idStrong = sources.meetingId === "url" || sources.meetingId === "label";
  const pcStrong = sources.passcode === "url" || sources.passcode === "label";
  let confidence = "low";
  if (meetingId && idStrong) confidence = pcStrong ? "high" : "medium";
  else if (meetingId) confidence = "medium";

  return {
    meetingId,
    passcode,
    meetingIdFormatted: formatMeetingId(meetingId),
    confidence,
    sources,
  };
}

/** 89366126292 -> "893 6612 6292" (11) / "123 456 7890" (10) / "12345 6789" (9). */
export function formatMeetingId(d) {
  if (!d) return "";
  if (d.length === 11) return `${d.slice(0, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)} ${d.slice(5)}`;
  return d;
}

/**
 * Build the launch URL for the installed app or the web client.
 * @param {"app"|"web"} target
 * @param {{meetingId:string, passcode:string, userName:string}} opts
 */
export function buildJoinUrl(target, { meetingId, passcode, userName }) {
  const id = String(meetingId || "").replace(/\D/g, "");
  if (!id) throw new Error("meetingId required");
  const pwd = passcode ? encodeURIComponent(passcode) : "";
  const uname = userName ? encodeURIComponent(userName) : "";

  if (target === "app") {
    // Desktop client protocol handler. uname pre-fills the display name.
    let u = `zoommtg://zoom.us/join?action=join&confno=${id}`;
    if (pwd) u += `&pwd=${pwd}`;
    if (uname) u += `&uname=${uname}`;
    return u;
  }
  // Web client. Guest display name is NOT settable via URL unless signed in,
  // so uname is appended best-effort only.
  let u = `https://app.zoom.us/wc/${id}/join?fromPWA=1`;
  if (pwd) u += `&pwd=${pwd}`;
  if (uname) u += `&uname=${uname}`;
  return u;
}
