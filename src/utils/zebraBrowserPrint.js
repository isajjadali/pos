/**
 * Send ZPL to Zebra via local zebra-bridge on http://127.0.0.1:9288
 * (Windows spooler → ZDesigner ZD220). Started by `npm run zebra-bridge` or `npm run dev`.
 *
 * Waits when the printer reports media out / offline so jobs don't finish
 * (and reconcile) until a new roll is loaded.
 */

const BRIDGE_URL = "http://127.0.0.1:9288";
/** Labels per Windows spool job — one PowerShell call, not one-per-label */
const LABELS_PER_SPOOL_JOB = 50;
/** Max time to wait for roll / offline recovery (15 min) */
const MEDIA_WAIT_MS = 15 * 60 * 1000;
const STATUS_POLL_MS = 2000;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      }
    );
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function candidateBases() {
  // Prefer direct bridge (IPv4) — Vite proxy on [::1] often fails on Windows
  return [BRIDGE_URL, `${window.location.origin}/zebra-browser-print`];
}

let cachedBase = null;

async function probe(base) {
  try {
    const res = await withTimeout(fetch(`${base}/ping`), 3000, "Printer bridge");
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

export async function resolveBrowserPrintBase() {
  if (cachedBase) {
    if (await probe(cachedBase)) return cachedBase;
    cachedBase = null;
  }
  for (const base of candidateBases()) {
    if (await probe(base)) {
      cachedBase = base;
      return base;
    }
  }
  throw new Error(
    "Printer bridge is not running on port 9288. Open a terminal in the web folder and run: npm run zebra-bridge  (keep it open). Then try Print again."
  );
}

async function postJson(url, body, timeoutMs = 120000) {
  const res = await withTimeout(
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    timeoutMs,
    "Print job"
  );
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain */
  }
  if (!res.ok) {
    throw new Error(data?.error || text || `HTTP ${res.status}`);
  }
  return data;
}

function splitLabelChunks(zpl) {
  return String(zpl)
    .split(/\n(?=\^XA)/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("^XA"));
}

/**
 * @param {string} base
 * @param {string} printerName
 */
export async function fetchPrinterStatus(base, printerName) {
  const q = encodeURIComponent(printerName || "");
  const res = await withTimeout(
    fetch(`${base}/printer-status?printer=${q}`),
    15000,
    "Printer status"
  );
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || `Printer status failed (HTTP ${res.status})`);
  }
  return data;
}

/**
 * Block until printer can accept/finish work.
 * @param {'ready' | 'idle'} mode ready = can send next job; idle = finished current work
 */
async function waitForPrinter(base, printerName, mode, { onStatus, timeoutMs = MEDIA_WAIT_MS } = {}) {
  const started = Date.now();
  let lastPhase = "";

  while (Date.now() - started < timeoutMs) {
    let status;
    try {
      status = await fetchPrinterStatus(base, printerName);
    } catch (e) {
      // Older bridge without /printer-status — skip wait rather than hard-fail
      if (String(e.message || "").includes("404") || String(e.message || "").includes("Unknown path")) {
        return { skipped: true, reason: "status-endpoint-missing" };
      }
      onStatus?.({
        phase: "status_error",
        message: e.message || "Status check failed",
      });
      await sleep(STATUS_POLL_MS);
      continue;
    }

    if (status.needsMedia || status.paperOut) {
      if (lastPhase !== "media_out") {
        lastPhase = "media_out";
        onStatus?.({
          phase: "media_out",
          message: "Label roll empty / paper out — load a new roll. Printing paused here.",
          status,
        });
      } else {
        onStatus?.({ phase: "media_out", status, waiting: true });
      }
      await sleep(STATUS_POLL_MS);
      continue;
    }

    if (status.offline) {
      lastPhase = "offline";
      onStatus?.({
        phase: "offline",
        message: "Printer offline hai — power/USB check karo.",
        status,
      });
      await sleep(STATUS_POLL_MS);
      continue;
    }

    if (mode === "ready") {
      if (status.ready || status.idle || (!status.needsMedia && !status.offline && !status.error)) {
        // Allow send even if still draining a previous job, unless media/offline
        if (!status.needsMedia && !status.offline) {
          if (status.printing && lastPhase !== "drain") {
            lastPhase = "drain";
            onStatus?.({
              phase: "printing",
              message: "Printer is finishing the previous job…",
              status,
            });
          }
          if (!status.printing) {
            onStatus?.({ phase: "ready", status });
            return status;
          }
        }
      }
      await sleep(STATUS_POLL_MS);
      continue;
    }

    // mode === 'idle' — wait until queue drained after our send
    if (!status.printing && !status.needsMedia && !status.offline) {
      onStatus?.({ phase: "idle", status });
      return status;
    }

    if (status.printing) {
      lastPhase = "printing";
      onStatus?.({
        phase: "printing",
        message: "Labels print ho rahe hain…",
        status,
      });
    }

    await sleep(STATUS_POLL_MS);
  }

  throw new Error(
    mode === "ready"
      ? "Timed out waiting for printer — check roll/offline and try again."
      : "Print finish hone ka wait timeout — printer queue / roll check karo."
  );
}

/**
 * Send ZPL labels to the Windows ZDesigner ZD220 printer.
 * Batches labels; pauses when Windows reports media out until a roll is loaded.
 * @param {string} zpl
 * @param {{ onProgress?: Function, onStatus?: Function }} [opts]
 */
export async function sendZplToZebra(zpl, opts = {}) {
  const { onProgress, onStatus } = opts;
  const chunks = splitLabelChunks(zpl);

  if (!chunks.length) throw new Error("No label data to print.");

  const base = await resolveBrowserPrintBase();
  let printerName = "ZDesigner ZD220-203dpi ZPL";

  const jobs = [];
  for (let i = 0; i < chunks.length; i += LABELS_PER_SPOOL_JOB) {
    jobs.push(chunks.slice(i, i + LABELS_PER_SPOOL_JOB).join("\n"));
  }

  // Before first label: don't start if roll already empty
  onStatus?.({ phase: "checking", message: "Printer status check…" });
  await waitForPrinter(base, printerName, "ready", { onStatus });

  let sent = 0;
  for (let j = 0; j < jobs.length; j++) {
    const batchSize = Math.min(LABELS_PER_SPOOL_JOB, chunks.length - sent);

    // Between jobs: wait if roll ran out while previous batch was printing
    await waitForPrinter(base, printerName, "ready", { onStatus });

    onProgress?.({
      sent,
      total: chunks.length,
      job: j + 1,
      jobs: jobs.length,
    });
    onStatus?.({
      phase: "sending",
      message: `Spool job ${j + 1}/${jobs.length} (${batchSize} labels)…`,
    });

    const timeoutMs = Math.min(180000, 30000 + batchSize * 800);
    const result = await postJson(
      `${base}/windows-print`,
      {
        data: jobs[j],
        printer: printerName,
        docName: `ZPL Labels ${j + 1}/${jobs.length} (${batchSize})`,
      },
      timeoutMs
    );
    if (result?.printerName) printerName = result.printerName;
    sent += batchSize;

    // Wait until this batch finishes (or pause on media out until roll replaced)
    onStatus?.({
      phase: "waiting_print",
      message: "Print finish / roll check…",
    });
    await waitForPrinter(base, printerName, "idle", { onStatus });
  }

  onProgress?.({
    sent: chunks.length,
    total: chunks.length,
    job: jobs.length,
    jobs: jobs.length,
  });
  onStatus?.({ phase: "done", message: "All labels printed." });

  return { printerName, labelCount: chunks.length, jobCount: jobs.length };
}

export async function resolveBrowserPrintBaseForUi() {
  try {
    const base = await resolveBrowserPrintBase();
    return { ok: true, base };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
