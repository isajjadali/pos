/**
 * Local printer bridge on :9288
 * - POST /windows-print  → Zebra ZD220 (ZPL labels)
 * - POST /receipt-print  → Black Copper / ESC/POS receipt printers
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 9288;
const DEFAULT_LABEL_PRINTER = "ZDesigner ZD220-203dpi ZPL";
const DEFAULT_RECEIPT_PRINTER =
  process.env.RECEIPT_PRINTER_NAME || "Black Copper 80";

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  setCors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listAllPrinterNames() {
  const ps = `Get-Printer | Select-Object -ExpandProperty Name`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  if (r.status !== 0) return [];
  return String(r.stdout || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listZebraPrinters() {
  return listAllPrinterNames().filter(
    (n) => /ZD|Zebra|ZPL/i.test(n)
  );
}

function listReceiptPrinters() {
  return listAllPrinterNames().filter((n) =>
    /Black\s*Copper|BC-?\d|POS-?80|POS80|Receipt|Thermal|XP-80|Generic.*Text/i.test(n)
  );
}

function resolveLabelPrinter(requested) {
  if (requested) return requested;
  const found = listZebraPrinters();
  if (found.includes(DEFAULT_LABEL_PRINTER)) return DEFAULT_LABEL_PRINTER;
  return found[0] || DEFAULT_LABEL_PRINTER;
}

function resolveReceiptPrinter(requested) {
  if (requested) return requested;
  const all = listAllPrinterNames();
  const exactDefault = all.find((n) => n.toLowerCase() === DEFAULT_RECEIPT_PRINTER.toLowerCase());
  if (exactDefault) return exactDefault;
  const preferred = listReceiptPrinters();
  // Prefer names that look like Black Copper 80
  const bc = preferred.find((n) => /black\s*copper/i.test(n));
  if (bc) return bc;
  if (preferred.length) return preferred[0];
  const fuzzy = all.find((n) => /copper|black/i.test(n));
  if (fuzzy) return fuzzy;
  throw new Error(
    `Receipt printer not found. Install Black Copper and add it in Windows Printers. Available: ${all.join(", ") || "(none)"}`
  );
}

/** Print plain text via Windows Out-Printer (GDI/text path — reliable for Black Copper driver) */
function sendTextViaOutPrinter(printerName, text) {
  const tmp = path.join(
    os.tmpdir(),
    `receipt-${Date.now()}-${Math.random().toString(16).slice(2)}.txt`
  );
  fs.writeFileSync(tmp, text, "utf8");
  const escapedPath = tmp.replace(/'/g, "''");
  const escapedPrinter = printerName.replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
Get-Content -LiteralPath '${escapedPath}' -Raw | Out-Printer -Name '${escapedPrinter}'
Remove-Item -LiteralPath '${escapedPath}' -Force -ErrorAction SilentlyContinue
Write-Output 'OK'
`;

  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  });

  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }

  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "Unknown error").trim();
    throw new Error(err || `Out-Printer failed for ${printerName}`);
  }
  return { ok: true, method: "out-printer-text" };
}

/** Send raw bytes (ZPL or ESC/POS) via Windows RAW spooler */
function sendRawBytesViaWindows(printerName, bytes, docName = "Raw Print", dataType = "RAW") {
  const tmp = path.join(
    os.tmpdir(),
    `pos-raw-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`
  );
  fs.writeFileSync(tmp, bytes);

  const escapedPath = tmp.replace(/'/g, "''");
  const escapedPrinter = printerName.replace(/'/g, "''");
  const escapedDoc = String(docName).replace(/'/g, "''");

  const ps = `
$ErrorActionPreference = 'Stop'
$printerName = '${escapedPrinter}'
$dataPath = '${escapedPath}'
$docName = '${escapedDoc}'
$bytes = [System.IO.File]::ReadAllBytes($dataPath)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RawPrinterHelper {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
  public class DOCINFOA {
    [MarshalAs(UnmanagedType.LPStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPStr)] public string pDataType;
  }
  [DllImport("winspool.Drv", EntryPoint = "OpenPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool OpenPrinter([MarshalAs(UnmanagedType.LPStr)] string szPrinter, out IntPtr hPrinter, IntPtr pd);
  [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool ClosePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterA", SetLastError = true, CharSet = CharSet.Ansi, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);
  [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndDocPrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool StartPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool EndPagePrinter(IntPtr hPrinter);
  [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
  public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
  public static bool SendBytesToPrinter(string printerName, byte[] bytes, string docName, string dataType) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = docName;
    di.pDataType = dataType;
    if (!StartDocPrinter(hPrinter, 1, di)) { ClosePrinter(hPrinter); return false; }
    StartPagePrinter(hPrinter);
    IntPtr pBytes = Marshal.AllocCoTaskMem(bytes.Length);
    Marshal.Copy(bytes, 0, pBytes, bytes.Length);
    int written;
    bool ok = WritePrinter(hPrinter, pBytes, bytes.Length, out written);
    Marshal.FreeCoTaskMem(pBytes);
    EndPagePrinter(hPrinter);
    EndDocPrinter(hPrinter);
    ClosePrinter(hPrinter);
    return ok;
  }
}
"@

$dataType = '${String(dataType).replace(/'/g, "''")}'
$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes, $docName, $dataType)
Remove-Item -Force $dataPath -ErrorAction SilentlyContinue
if (-not $ok) { throw "WritePrinter failed for $printerName" }
Write-Output "OK"
`;

  // Scale timeout with payload size (multi-label batches can be large)
  const timeoutMs = Math.min(180000, Math.max(60000, 20000 + Math.ceil(bytes.length / 50)));
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  });

  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }

  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "Unknown error").trim();
    throw new Error(err || `Failed to print to ${printerName}`);
  }
  return { ok: true, method: "windows-raw", bytes: bytes.length };
}

/** Cache resolved printer so we don't spawn PowerShell Get-Printer on every job */
let cachedLabelPrinter = null;

function resolveLabelPrinterCached(requested) {
  if (requested) {
    cachedLabelPrinter = requested;
    return requested;
  }
  if (cachedLabelPrinter) return cachedLabelPrinter;
  cachedLabelPrinter = resolveLabelPrinter(null);
  return cachedLabelPrinter;
}

/**
 * Windows printer status (Win32_Printer).
 * Used so the UI can wait when the label roll runs out.
 */
function getLabelPrinterStatus(printerName) {
  const name = resolveLabelPrinterCached(printerName);
  const escaped = name.replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
$name = '${escaped}'
$p = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $name } | Select-Object -First 1
if (-not $p) { throw "Printer not found: $name" }
$jobCount = 0
try {
  $jobCount = @(Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue).Count
} catch { $jobCount = 0 }
[PSCustomObject]@{
  name = $p.Name
  printerStatus = [int]$p.PrinterStatus
  printerState = [int]$p.PrinterState
  detectedErrorState = [int]$p.DetectedErrorState
  workOffline = [bool]$p.WorkOffline
  jobCount = [int]$jobCount
} | ConvertTo-Json -Compress
`;
  const r = spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 12000,
  });
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || "status failed").trim();
    throw new Error(err || `Could not read status for ${name}`);
  }
  const raw = JSON.parse(String(r.stdout || "").trim());
  const state = Number(raw.printerState) || 0;
  const status = Number(raw.printerStatus) || 0;
  const detected = Number(raw.detectedErrorState) || 0;
  const jobCount = Number(raw.jobCount) || 0;
  const workOffline = Boolean(raw.workOffline);

  // PrinterState bits: 1 paused, 2 error, 8 jam, 16 paper out, 64 paper problem, 128 offline, 1024 printing
  const paused = (state & 1) !== 0;
  const error = (state & 2) !== 0;
  const paperJam = (state & 8) !== 0;
  const paperOut = (state & 16) !== 0 || detected === 3 || detected === 4;
  const paperProblem = (state & 64) !== 0;
  const offline = workOffline || (state & 128) !== 0 || status === 7;
  const printing = (state & 1024) !== 0 || status === 4 || jobCount > 0;
  const idle = status === 3 && !printing && !paperOut && !offline;
  const needsMedia = paperOut || paperJam || paperProblem;
  const ready = !needsMedia && !offline && !error && !workOffline && (idle || (!printing && !paused));

  return {
    ok: true,
    printerName: raw.name || name,
    printerStatus: status,
    printerState: state,
    detectedErrorState: detected,
    workOffline,
    jobCount,
    paused,
    error,
    paperOut,
    paperJam,
    paperProblem,
    offline,
    printing,
    idle,
    needsMedia,
    ready,
  };
}

function handlePrinterStatus(req, res) {
  try {
    const u = new URL(req.url || "/", `http://${LISTEN_HOST}`);
    const requested = u.searchParams.get("printer") || u.searchParams.get("name") || "";
    const status = getLabelPrinterStatus(requested || null);
    json(res, 200, status);
  } catch (e) {
    json(res, 500, { ok: false, error: e.message || String(e) });
  }
}

async function handleWindowsPrint(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const zpl = body.data || body.zpl || "";
    if (!String(zpl).trim()) {
      json(res, 400, { error: "Missing ZPL data" });
      return;
    }
    const printerName = resolveLabelPrinterCached(body.printer || body.printerName);
    const docName = body.docName || "ZPL Labels";
    const bytes = Buffer.from(String(zpl), "utf8");
    // Large multi-label jobs need more time than a single sticker
    const result = sendRawBytesViaWindows(printerName, bytes, docName);
    json(res, 200, {
      ok: true,
      printerName,
      bytes: bytes.length,
      ...result,
    });
  } catch (e) {
    json(res, 500, { error: e.message || String(e) });
  }
}

async function handleReceiptPrint(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const printerName = resolveReceiptPrinter(body.printer || body.printerName);
    const mode = body.mode || (body.text ? "text" : "escpos");

    if (mode === "text") {
      const text = String(body.text || body.data || "");
      if (!text.trim()) {
        json(res, 400, { error: "Missing receipt text" });
        return;
      }
      let result;
      try {
        result = sendTextViaOutPrinter(printerName, text);
      } catch {
        // Fallback: RAW bytes as plain text
        result = sendRawBytesViaWindows(printerName, Buffer.from(text, "utf8"), "Receipt", "RAW");
        result.method = "windows-raw-text";
      }
      json(res, 200, { ok: true, printerName, ...result });
      return;
    }

    let bytes;
    if (body.dataBase64) {
      bytes = Buffer.from(String(body.dataBase64), "base64");
    } else if (body.data) {
      bytes = Buffer.from(String(body.data), "utf8");
    } else {
      json(res, 400, { error: "Missing receipt data (dataBase64 or text)" });
      return;
    }
    if (!bytes.length) {
      json(res, 400, { error: "Empty receipt data" });
      return;
    }
    const result = sendRawBytesViaWindows(printerName, bytes, "Receipt", "RAW");
    json(res, 200, { ok: true, printerName, ...result });
  } catch (e) {
    json(res, 500, { error: e.message || String(e) });
  }
}

const server = http.createServer(async (req, res) => {
  setCors(res);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || "/").split("?")[0];

  if (url === "/ping") {
    json(res, 200, { ok: true, mode: "windows-spooler" });
    return;
  }

  if (url === "/health") {
    let printers = [];
    try {
      printers = listAllPrinterNames();
    } catch {
      printers = [];
    }
    json(res, 200, {
      ok: true,
      mode: "windows-spooler",
      labelPrinter: DEFAULT_LABEL_PRINTER,
      receiptPrinterHint: DEFAULT_RECEIPT_PRINTER,
      printers,
    });
    return;
  }

  if (url === "/available") {
    const printers = listZebraPrinters().map((name) => ({
      name,
      uid: name,
      connection: "usb",
      deviceType: "printer",
    }));
    json(res, 200, { printer: printers });
    return;
  }

  if (url === "/default") {
    const name = resolveLabelPrinter(null);
    json(res, 200, {
      name,
      uid: name,
      connection: "usb",
      deviceType: "printer",
      version: 1,
      provider: "windows-spooler",
      manufacturer: "Zebra",
    });
    return;
  }

  if (url === "/printer-status") {
    handlePrinterStatus(req, res);
    return;
  }

  if (url === "/windows-print" || url === "/write") {
    if (req.method !== "POST") {
      json(res, 405, { error: "POST required" });
      return;
    }
    await handleWindowsPrint(req, res);
    return;
  }

  if (url === "/receipt-print") {
    if (req.method !== "POST") {
      json(res, 405, { error: "POST required" });
      return;
    }
    await handleReceiptPrint(req, res);
    return;
  }

  json(res, 404, { error: `Unknown path ${url}` });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.log(
      `[zebra-bridge] Port ${LISTEN_PORT} already in use — reusing existing bridge. Vite will keep running.`
    );
    setInterval(() => {}, 1 << 30);
    return;
  }
  console.error("[zebra-bridge]", err);
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log(`[zebra-bridge] READY http://${LISTEN_HOST}:${LISTEN_PORT}`);
  console.log(`[zebra-bridge] Labels → ${DEFAULT_LABEL_PRINTER} (POST /windows-print)`);
  console.log(`[zebra-bridge] Receipts → Black Copper / POS (POST /receipt-print)`);
  try {
    const all = listAllPrinterNames();
    console.log(`[zebra-bridge] Windows printers: ${all.join(", ") || "(none)"}`);
  } catch {
    /* ignore */
  }
});
