import { extractMeetingInfo, formatMeetingId, buildJoinUrl } from "./src/parser.js";
import { recognizeText } from "./src/ocr.js";
import { preprocessVariants } from "./src/preprocess.js";
import { combineResults } from "./src/combine.js";

// Firefox exposes the promise-based `browser.*`; Chrome/Edge only `chrome.*`.
const api = globalThis.browser ?? globalThis.chrome;

const $ = (id) => document.getElementById(id);
const els = {
  userName: $("userName"),
  drop: $("drop"),
  file: $("file"),
  previewWrap: $("previewWrap"),
  previewStage: $("previewStage"),
  preview: $("preview"),
  cropSel: $("cropSel"),
  cropHint: $("cropHint"),
  cropScan: $("cropScan"),
  cropReset: $("cropReset"),
  status: $("status"),
  barFill: $("barFill"),
  statusText: $("statusText"),
  result: $("result"),
  meetingId: $("meetingId"),
  passcode: $("passcode"),
  confidence: $("confidence"),
  join: $("join"),
  copyLink: $("copyLink"),
  modal: $("modal"),
  modalApp: $("modalApp"),
  modalWeb: $("modalWeb"),
  modalCancel: $("modalCancel"),
  mSumId: $("mSumId"),
  mSumPass: $("mSumPass"),
  mSumName: $("mSumName"),
  rawWrap: $("rawWrap"),
  raw: $("raw"),
  error: $("error"),
};

// ---- name persistence -------------------------------------------------------
const NAME_KEY = "zmj_userName";
api.storage.local.get(NAME_KEY).then((r) => {
  els.userName.value = r[NAME_KEY] || "Towfiq";
});
els.userName.addEventListener("change", () => {
  api.storage.local.set({ [NAME_KEY]: els.userName.value.trim() });
});

// ---- image intake ---------------------------------------------------------
els.drop.addEventListener("click", () => els.file.click());
els.drop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); els.file.click(); }
});
els.file.addEventListener("change", () => {
  if (els.file.files[0]) handleImage(els.file.files[0]);
});

["dragenter", "dragover"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.add("drag");
  })
);
["dragleave", "drop"].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.remove("drag");
  })
);
els.drop.addEventListener("drop", (e) => {
  const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith("image/"));
  if (f) handleImage(f);
});

window.addEventListener("paste", (e) => {
  const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith("image/"));
  if (item) handleImage(item.getAsFile());
});

// ---- pipeline -----------------------------------------------------------------
let objectUrl = null;
let busy = false;
let lastBlob = null; // kept so "Scan selection" can re-run on a sub-region

async function handleImage(blob, manualRegion) {
  if (busy) return;
  busy = true;
  resetUI();

  if (blob !== lastBlob) {
    lastBlob = blob;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(blob);
    els.preview.src = objectUrl;
  }
  els.previewWrap.hidden = false;
  if (!manualRegion) clearSelection();

  els.status.hidden = false;
  setProgress(2, manualRegion ? "Scanning selection…" : "Cleaning up image…");

  try {
    const variants = await preprocessVariants(blob, manualRegion);
    const results = [];
    const texts = [];

    for (let i = 0; i < variants.length; i++) {
      const label = `Reading image ${i + 1}/${variants.length}`;
      const text = await recognizeText(variants[i].canvas, (m) => {
        if (m.status === "recognizing text") {
          const pct = Math.round((m.progress || 0) * 100);
          setProgress(10 + ((i + m.progress) / variants.length) * 85, `${label}… ${pct}%`);
        }
      });
      texts.push(`[${variants[i].name}]\n${text.trim()}`);
      results.push(extractMeetingInfo(text));

      // stop early once enough variants agree
      if (combineResults(results).confidence === "high") break;
    }

    const info = combineResults(results);
    els.status.hidden = true;

    els.raw.textContent = texts.join("\n\n") || "(no text found)";
    els.rawWrap.hidden = false;

    els.meetingId.value = formatMeetingId(info.meetingId) || "";
    els.passcode.value = info.passcode || "";

    const agree = info.agreement.id;
    let msg;
    if (!info.meetingId) {
      msg = "Couldn't read a meeting ID — type it in, or drag a box over it above and Scan selection.";
    } else {
      msg = `Detected (confidence: ${info.confidence}`;
      msg += agree.votes >= 2 ? `, ${agree.votes} reads agree). ` : "). ";
      if (info.passcodeUnreadable) {
        msg += "Passcode couldn't be read reliably — enter it manually. ";
      }
      msg += "Check before joining.";
    }
    els.confidence.textContent = msg;
    els.confidence.className = "confidence " + info.confidence;
    els.result.hidden = false;
  } catch (err) {
    els.status.hidden = true;
    showError(`OCR failed: ${err?.message || err}`);
  } finally {
    busy = false;
  }
}

// ---- drag-to-crop selector ------------------------------------------------
let drag = null; // { x0, y0 } in stage pixels
let selection = null; // { x, y, w, h } in stage pixels

function clearSelection() {
  selection = null;
  drag = null;
  els.cropSel.hidden = true;
  els.cropScan.hidden = true;
  els.cropReset.hidden = true;
  els.cropHint.textContent =
    "Tip: drag a box over the ID / passcode to scan just that part";
}

function paintSel() {
  if (!selection) return;
  els.cropSel.hidden = false;
  els.cropSel.style.left = `${selection.x}px`;
  els.cropSel.style.top = `${selection.y}px`;
  els.cropSel.style.width = `${selection.w}px`;
  els.cropSel.style.height = `${selection.h}px`;
}

els.previewStage.addEventListener("pointerdown", (e) => {
  if (busy) return;
  const r = els.previewStage.getBoundingClientRect();
  drag = { x0: e.clientX - r.left, y0: e.clientY - r.top };
  els.previewStage.setPointerCapture(e.pointerId);
});
els.previewStage.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const r = els.previewStage.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
  const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
  selection = {
    x: Math.min(drag.x0, x),
    y: Math.min(drag.y0, y),
    w: Math.abs(x - drag.x0),
    h: Math.abs(y - drag.y0),
  };
  paintSel();
});
els.previewStage.addEventListener("pointerup", () => {
  drag = null;
  if (selection && selection.w > 12 && selection.h > 12) {
    els.cropScan.hidden = false;
    els.cropReset.hidden = false;
    els.cropHint.textContent = "Selected a region.";
  } else {
    clearSelection();
  }
});

els.cropScan.addEventListener("click", () => {
  if (!selection || !lastBlob) return;
  const r = els.previewStage.getBoundingClientRect();
  const sx = els.preview.naturalWidth / r.width;
  const sy = els.preview.naturalHeight / r.height;
  handleImage(lastBlob, {
    left: selection.x * sx,
    top: selection.y * sy,
    w: selection.w * sx,
    h: selection.h * sy,
  });
});
els.cropReset.addEventListener("click", () => {
  if (lastBlob) handleImage(lastBlob);
});

// ---- join actions -----------------------------------------------------------
function currentValues() {
  return {
    meetingId: els.meetingId.value.replace(/\D/g, ""),
    passcode: els.passcode.value.trim(),
    userName: els.userName.value.trim(),
  };
}

function launch(target) {
  const v = currentValues();
  if (!v.meetingId) return showError("Enter a meeting ID first.");
  clearError();
  let url;
  try {
    url = buildJoinUrl(target, v);
  } catch (e) {
    return showError(e.message);
  }
  if (target === "app") {
    // Trigger the OS protocol handler for the desktop client.
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } else {
    api.tabs?.create ? api.tabs.create({ url }) : window.open(url, "_blank");
  }
}

// ---- confirm modal: choose app vs browser before anything opens -------------
function openModal() {
  const v = currentValues();
  if (!v.meetingId) return showError("Enter a meeting ID first.");
  clearError();
  els.mSumId.textContent = formatMeetingId(v.meetingId) || v.meetingId;
  els.mSumPass.textContent = v.passcode || "(none)";
  els.mSumName.textContent = v.userName || "(not set)";
  els.modal.hidden = false;
  els.modalApp.focus();
}
function closeModal() {
  els.modal.hidden = true;
  els.join.focus();
}
function choose(target) {
  closeModal();
  launch(target);
}

els.join.addEventListener("click", openModal);
els.modalApp.addEventListener("click", () => choose("app"));
els.modalWeb.addEventListener("click", () => choose("web"));
els.modalCancel.addEventListener("click", closeModal);
els.modal.addEventListener("click", (e) => {
  if (e.target === els.modal) closeModal(); // click on backdrop
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !els.modal.hidden) closeModal();
});
els.copyLink.addEventListener("click", async () => {
  const v = currentValues();
  if (!v.meetingId) return showError("Enter a meeting ID first.");
  try {
    await navigator.clipboard.writeText(buildJoinUrl("app", v));
    els.copyLink.textContent = "Copied ✓";
    setTimeout(() => (els.copyLink.textContent = "Copy app link"), 1500);
  } catch {
    showError("Clipboard blocked by browser.");
  }
});

// keep the formatted ID tidy as the user edits
els.meetingId.addEventListener("blur", () => {
  const d = els.meetingId.value.replace(/\D/g, "");
  els.meetingId.value = formatMeetingId(d) || d;
});

// ---- ui helpers -----------------------------------------------------------
function setProgress(pct, text) {
  els.barFill.style.width = `${pct}%`;
  els.statusText.textContent = text;
}
function resetUI() {
  clearError();
  els.result.hidden = true;
  els.rawWrap.hidden = true;
}
function showError(msg) {
  els.error.textContent = msg;
  els.error.hidden = false;
}
function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}
