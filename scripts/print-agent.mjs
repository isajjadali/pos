/**
 * Shop PC print agent — one-time setup, then Windows Startup.
 * - Keeps local zebra-bridge on :9288 (same-PC fast path)
 * - Polls Supabase zpl_print_queue and prints on the local Zebra
 *
 * Requires in project .env (shop PC only, never commit service role):
 *   VITE_SUPABASE_URL=...
 *   SUPABASE_SERVICE_ROLE_KEY=...
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BRIDGE_URL = "http://127.0.0.1:9288";
const POLL_MS = 2000;
const HEARTBEAT_MS = 15000;
const STATION_ID =
  process.env.PRINT_STATION_ID ||
  `shop-${os.hostname().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48)}`;

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

loadEnvFile();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

function log(...args) {
  console.log(`[print-agent ${new Date().toISOString()}]`, ...args);
}

async function pingBridge() {
  try {
    const res = await fetch(`${BRIDGE_URL}/ping`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return Boolean(data?.ok);
  } catch {
    return false;
  }
}

function startBridgeChild() {
  const script = path.join(__dirname, "zebra-bridge.mjs");
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (buf) => {
    const s = String(buf).trimEnd();
    if (s) console.log(s);
  });
  child.stderr.on("data", (buf) => {
    const s = String(buf).trimEnd();
    if (s) console.error(s);
  });
  child.on("exit", (code) => {
    log(`zebra-bridge exited code=${code} — will restart on next ensureBridge`);
  });
  return child;
}

let bridgeChild = null;

async function ensureBridge() {
  if (await pingBridge()) return true;
  if (bridgeChild && !bridgeChild.killed) {
    await new Promise((r) => setTimeout(r, 800));
    if (await pingBridge()) return true;
  }
  log("Starting local zebra-bridge on :9288…");
  bridgeChild = startBridgeChild();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (await pingBridge()) {
      log("zebra-bridge ready");
      return true;
    }
  }
  log("WARN: zebra-bridge did not become ready");
  return false;
}

async function bridgeHealth() {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function sendZplToBridge(zpl, printerName) {
  const res = await fetch(`${BRIDGE_URL}/windows-print`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: zpl,
      printer: printerName || "",
      docName: "Cloud ZPL Queue",
    }),
    signal: AbortSignal.timeout(180000),
  });
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* plain */
  }
  if (!res.ok) throw new Error(data?.error || text || `HTTP ${res.status}`);
  return data;
}

function requireSupabaseAdmin() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error(
      "Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env (shop PC agent only — do not put service role in the browser)"
    );
  }
  return createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function heartbeat(sb, printerName) {
  const { error } = await sb.rpc("upsert_print_station", {
    p_id: STATION_ID,
    p_name: process.env.PRINT_STATION_NAME || `Shop (${os.hostname()})`,
    p_host_name: os.hostname(),
    p_printer_name: printerName || null,
  });
  if (error) log("heartbeat failed:", error.message);
}

async function claimJob(sb) {
  const { data, error } = await sb.rpc("claim_zpl_print_job", {
    p_station_id: STATION_ID,
  });
  if (error) throw error;
  return data || null;
}

async function markJob(sb, id, status, errorMsg = null) {
  const patch = {
    status,
    error: errorMsg,
  };
  if (status === "printed") patch.printed_at = new Date().toISOString();
  const { error } = await sb.from("zpl_print_queue").update(patch).eq("id", id);
  if (error) log("mark job failed:", error.message);
}

async function processOne(sb, printerName) {
  const job = await claimJob(sb);
  if (!job || !job.id) return false;

  log(`Claimed job ${job.id} (${job.label_count || 1} labels)`);
  try {
    await ensureBridge();
    await sendZplToBridge(job.zpl, printerName);
    await markJob(sb, job.id, "printed");
    log(`Printed job ${job.id}`);
  } catch (e) {
    const msg = e.message || String(e);
    log(`Failed job ${job.id}:`, msg);
    await markJob(sb, job.id, "failed", msg.slice(0, 500));
  }
  return true;
}

async function main() {
  log(`Station id=${STATION_ID} host=${os.hostname()}`);
  const sb = requireSupabaseAdmin();

  await ensureBridge();
  let health = await bridgeHealth();
  let printerName = health?.labelPrinter || process.env.LABEL_PRINTER_NAME || "";
  if (health?.labelError) log("Printer detect:", health.labelError);

  await heartbeat(sb, printerName);
  log("Polling zpl_print_queue… (Ctrl+C to stop)");

  let lastBeat = 0;
  for (;;) {
    try {
      if (!(await pingBridge())) await ensureBridge();
      health = await bridgeHealth();
      if (health?.labelPrinter) printerName = health.labelPrinter;

      const now = Date.now();
      if (now - lastBeat >= HEARTBEAT_MS) {
        await heartbeat(sb, printerName);
        lastBeat = now;
      }

      const worked = await processOne(sb, printerName);
      if (!worked) await new Promise((r) => setTimeout(r, POLL_MS));
    } catch (e) {
      log("loop error:", e.message || e);
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  }
}

main().catch((e) => {
  console.error("[print-agent] fatal:", e.message || e);
  process.exit(1);
});
