/**
 * Send ZPL to Zebra via local zebra-bridge on http://127.0.0.1:9288
 * Bridge must run on EACH PC that has the label printer (PROD or DEV).
 * Printer name is auto-detected on that PC — not hardcoded to one laptop.
 */

const BRIDGE_URL = "http://127.0.0.1:9288";
const LABELS_PER_SPOOL_JOB = 50;
const MEDIA_WAIT_MS = 15 * 60 * 1000;
const STATUS_POLL_MS = 2000;
const PRINTER_PREF_KEY = "dw_label_printer_name";

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
  // Prefer direct bridge (IPv4) — works for PROD HTTPS pages (localhost exception)
  // Vite proxy only exists in local `npm run dev`
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
    "Printer bridge is not running on this PC (port 9288). On the laptop that has the Zebra plugged in, open a terminal in the project folder and run: npm run zebra-bridge  — keep that window open, then print again."
  );
}

export function getPreferredLabelPrinter() {
  try {
    return String(localStorage.getItem(PRINTER_PREF_KEY) || "").trim();
  } catch {
    return "";
  }
}

export function setPreferredLabelPrinter(name) {
  const n = String(name || "").trim();
  try {
    if (n) localStorage.setItem(PRINTER_PREF_KEY, n);
    else localStorage.removeItem(PRINTER_PREF_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Ask the local bridge which Zebra printer exists on THIS Windows PC.
 * @returns {Promise<{ base: string, name: string, zebraPrinters: string[], host?: string }>}
 */
export async function resolveLabelPrinterOnThisPc() {
  const base = await resolveBrowserPrintBase();
  const preferred = getPreferredLabelPrinter();

  try {
    const res = await withTimeout(fetch(`${base}/health`), 8000, "Printer health");
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      const zebra = Array.isArray(data.zebraPrinters) ? data.zebraPrinters : [];
      if (preferred && (zebra.includes(preferred) || (data.printers || []).includes(preferred))) {
        return { base, name: preferred, zebraPrinters: zebra, host: data.host };
      }
      if (data.labelPrinter) {
        return { base, name: data.labelPrinter, zebraPrinters: zebra, host: data.host };
      }
      if (data.labelError) throw new Error(data.labelError);
    }
  } catch (e) {
    if (String(e.message || "").includes("No Zebra")) throw e;
  }

  try {
    const res = await withTimeout(fetch(`${base}/default`), 8000, "Default printer");
    const data = await res.json().catch(() => null);
    if (res.ok && data?.name) {
      return { base, name: data.name, zebraPrinters: [data.name], host: data.host };
    }
    if (data?.error) throw new Error(data.error);
  } catch (e) {
    if (String(e.message || "").includes("No Zebra") || String(e.message || "").includes("not found")) {
      throw e;
    }
  }

  throw new Error(
    "No Zebra label printer found on this PC. Install the ZDesigner / Zebra ZPL driver, plug in the printer, then restart: npm run zebra-bridge"
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
    .split(/\r?\n(?=\^XA)/)
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
 * @param {'ready' | 'idle'} mode
 */
async function waitForPrinter(base, printerName, mode, { onStatus, timeoutMs = MEDIA_WAIT_MS } = {}) {
  const started = Date.now();
  let lastPhase = "";

  while (Date.now() - started < timeoutMs) {
    let status;
    try {
      status = await fetchPrinterStatus(base, printerName);
    } catch (e) {
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
 * Local bridge path (same PC as Zebra + agent/bridge running).
 */
async function sendZplViaLocalBridge(zpl, opts = {}) {
  const { onProgress, onStatus, printer: printerOverride } = opts;
  const chunks = splitLabelChunks(zpl);
  if (!chunks.length) throw new Error("No label data to print.");

  onStatus?.({ phase: "checking", message: "Local printer bridge…" });
  const resolved = await resolveLabelPrinterOnThisPc();
  const base = resolved.base;
  let printerName = String(printerOverride || resolved.name || "").trim();
  if (!printerName) throw new Error("No label printer resolved on this PC.");

  const jobs = [];
  for (let i = 0; i < chunks.length; i += LABELS_PER_SPOOL_JOB) {
    jobs.push(chunks.slice(i, i + LABELS_PER_SPOOL_JOB).join("\r\n"));
  }

  onStatus?.({
    phase: "checking",
    message: `Using printer “${printerName}”${resolved.host ? ` on ${resolved.host}` : ""}…`,
  });
  await waitForPrinter(base, printerName, "ready", { onStatus });

  let sent = 0;
  for (let j = 0; j < jobs.length; j++) {
    const batchSize = Math.min(LABELS_PER_SPOOL_JOB, chunks.length - sent);
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
  onStatus?.({ phase: "done", message: "All labels printed (local)." });

  return {
    mode: "local",
    printerName,
    labelCount: chunks.length,
    jobCount: jobs.length,
    host: resolved.host,
  };
}

/**
 * Cloud queue → shop print agent (phone / other laptop / PROD without local bridge).
 */
async function sendZplViaCloudQueue(zpl, opts = {}) {
  const { onStatus, onProgress } = opts;
  const chunks = splitLabelChunks(zpl);
  if (!chunks.length) throw new Error("No label data to print.");

  const { enqueueZplPrint, waitForZplPrintJob } = await import("../services/zplPrintQueue.js");

  onStatus?.({
    phase: "queued",
    message: "Local bridge offline — queueing for shop print agent…",
  });
  const row = await enqueueZplPrint(zpl, { labelCount: chunks.length });
  onProgress?.({ sent: 0, total: chunks.length, job: 1, jobs: 1 });
  onStatus?.({
    phase: "queued",
    message: "Waiting for shop PC agent to print…",
    jobId: row.id,
  });

  const done = await waitForZplPrintJob(row.id, {
    onStatus: (job) => {
      if (job.status === "pending") {
        onStatus?.({
          phase: "queued",
          message: "Queued — shop agent will pick this up…",
          job,
        });
      } else if (job.status === "printing") {
        onStatus?.({
          phase: "printing",
          message: "Shop printer is printing…",
          job,
        });
      }
    },
  });

  onProgress?.({
    sent: chunks.length,
    total: chunks.length,
    job: 1,
    jobs: 1,
  });
  onStatus?.({ phase: "done", message: "All labels printed (shop agent)." });

  return {
    mode: "queued",
    jobId: done.id,
    printerName: done.station_id || "shop-agent",
    labelCount: chunks.length,
    jobCount: 1,
  };
}

/**
 * Raw ZPL path: local bridge first.
 * Cloud queue ONLY when preferQueue:true (optional shop agent) — never auto-fallback,
 * so PROD PCs without migration/agent don't hit missing zpl_print_queue.
 * @param {string} zpl
 * @param {{ onProgress?: Function, onStatus?: Function, printer?: string, preferQueue?: boolean }} [opts]
 */
export async function sendZplToZebra(zpl, opts = {}) {
  const chunks = splitLabelChunks(zpl);
  if (!chunks.length) throw new Error("No label data to print.");

  if (opts.preferQueue) {
    return sendZplViaCloudQueue(zpl, opts);
  }

  try {
    const base = await resolveBrowserPrintBase();
    if (base) return await sendZplViaLocalBridge(zpl, opts);
  } catch (e) {
    throw new Error(
      `${e.message || "Local printer bridge offline."} Use normal Print (browser → Zebra dialog) instead of raw ZPL, or start the shop print agent.`
    );
  }

  throw new Error(
    "Local printer bridge offline. Use normal Print (browser → Zebra dialog) — no agent setup needed."
  );
}

export async function resolveBrowserPrintBaseForUi() {
  try {
    const resolved = await resolveLabelPrinterOnThisPc();
    return {
      ok: true,
      mode: "local",
      base: resolved.base,
      printerName: resolved.name,
      zebraPrinters: resolved.zebraPrinters,
      host: resolved.host,
    };
  } catch (e) {
    return { ok: false, mode: "local", message: e.message };
  }
}
