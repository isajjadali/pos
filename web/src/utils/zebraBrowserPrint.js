/**
 * Send ZPL to Zebra via local zebra-bridge on http://127.0.0.1:9288
 * (Windows spooler → ZDesigner ZD220). Started by `npm run zebra-bridge` or `npm run dev`.
 */

const BRIDGE_URL = "http://127.0.0.1:9288";

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

async function postJson(url, body, timeoutMs = 90000) {
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

/** Send ZPL labels to the Windows ZDesigner ZD220 printer. */
export async function sendZplToZebra(zpl) {
  const chunks = String(zpl)
    .split(/\n(?=\^XA)/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("^XA"));

  if (!chunks.length) throw new Error("No label data to print.");

  const base = await resolveBrowserPrintBase();
  let printerName = "ZDesigner ZD220-203dpi ZPL";

  for (const chunk of chunks) {
    const result = await postJson(`${base}/windows-print`, {
      data: chunk,
      printer: printerName,
    });
    if (result?.printerName) printerName = result.printerName;
  }

  return { printerName };
}

export async function resolveBrowserPrintBaseForUi() {
  try {
    const base = await resolveBrowserPrintBase();
    return { ok: true, base };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}
