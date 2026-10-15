/**
 * Local printer bridge on :9288
 * Sends raw ZPL to Windows printer (ZDesigner ZD220) — no Browser Print needed.
 */
import http from "node:http";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = 9288;
const DEFAULT_PRINTER = "ZDesigner ZD220-203dpi ZPL";

let cachedPrinters = null;
let cachedPrintersAt = 0;

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

function listZebraPrinters() {
  const now = Date.now();
  if (cachedPrinters && now - cachedPrintersAt < 60000) return cachedPrinters;

  const ps = `Get-Printer | Where-Object { $_.Name -like '*ZD*' -or $_.Name -like '*Zebra*' -or $_.DriverName -like '*ZPL*' } | Select-Object -ExpandProperty Name`;
  const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  });
  const list =
    r.status === 0
      ? String(r.stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
  cachedPrinters = list.length ? list : [DEFAULT_PRINTER];
  cachedPrintersAt = now;
  return cachedPrinters;
}

function resolvePrinterName(requested) {
  if (requested) return requested;
  const found = listZebraPrinters();
  if (found.includes(DEFAULT_PRINTER)) return DEFAULT_PRINTER;
  return found[0] || DEFAULT_PRINTER;
}

function sendZplViaWindows(printerName, zpl) {
  const tmp = path.join(
    os.tmpdir(),
    `zebra-label-${Date.now()}-${Math.random().toString(16).slice(2)}.zpl`
  );
  fs.writeFileSync(tmp, zpl, "utf8");

  const escapedPath = tmp.replace(/'/g, "''");
  const escapedPrinter = printerName.replace(/'/g, "''");
  const ps = `
$ErrorActionPreference = 'Stop'
$printerName = '${escapedPrinter}'
$zplPath = '${escapedPath}'
$zpl = [System.IO.File]::ReadAllText($zplPath)

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
  public static bool SendBytesToPrinter(string printerName, byte[] bytes) {
    IntPtr hPrinter;
    if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero)) return false;
    DOCINFOA di = new DOCINFOA();
    di.pDocName = "ZPL Label";
    di.pDataType = "RAW";
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

$bytes = [System.Text.Encoding]::UTF8.GetBytes($zpl)
$ok = [RawPrinterHelper]::SendBytesToPrinter($printerName, $bytes)
Remove-Item -Force $zplPath -ErrorAction SilentlyContinue
if (-not $ok) { throw "WritePrinter failed for $printerName" }
Write-Output "OK"
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
    throw new Error(err || `Failed to print to ${printerName}`);
  }
  return { ok: true, method: "windows-raw" };
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
    const printerName = body.printer || body.printerName || DEFAULT_PRINTER;
    const result = sendZplViaWindows(printerName, String(zpl));
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

  // Instant ping — never call PowerShell here (that was hanging the probe)
  if (url === "/ping" || url === "/health") {
    json(res, 200, { ok: true, mode: "windows-spooler", defaultPrinter: DEFAULT_PRINTER });
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
    const name = DEFAULT_PRINTER;
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

  if (url === "/windows-print" || url === "/write") {
    if (req.method !== "POST") {
      json(res, 405, { error: "POST required" });
      return;
    }
    await handleWindowsPrint(req, res);
    return;
  }

  json(res, 404, { error: `Unknown path ${url}` });
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    // Another bridge (or leftover process) already owns 9288.
    // Stay alive so `npm run dev` (concurrently -k) does not kill Vite.
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
  console.log(`[zebra-bridge] Default printer: ${DEFAULT_PRINTER}`);
  console.log(`[zebra-bridge] POST /windows-print to print labels`);
});
