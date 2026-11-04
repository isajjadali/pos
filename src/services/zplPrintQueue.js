import { requireSupabase } from "../lib/supabase.js";

function countLabelsInZpl(zpl) {
  const m = String(zpl || "").match(/\^XA/gi);
  return Math.max(1, m ? m.length : 1);
}

/**
 * Enqueue ZPL for the shop print agent (any device → shop Zebra).
 * @param {string} zpl
 * @param {{ labelCount?: number }} [opts]
 */
export async function enqueueZplPrint(zpl, opts = {}) {
  const sb = requireSupabase();
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();
  if (userErr) throw userErr;
  if (!user?.id) throw new Error("Sign in required to queue a print job.");

  const labelCount = opts.labelCount ?? countLabelsInZpl(zpl);
  const { data, error } = await sb
    .from("zpl_print_queue")
    .insert({
      zpl: String(zpl),
      label_count: labelCount,
      status: "pending",
      created_by: user.id,
    })
    .select("id, status, label_count, created_at")
    .single();
  if (error) throw error;
  return data;
}

export async function getZplPrintJob(id) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("zpl_print_queue")
    .select("id, status, error, label_count, created_at, claimed_at, printed_at, station_id")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Poll until printed / failed / timeout.
 * @param {string} jobId
 * @param {{ timeoutMs?: number, intervalMs?: number, onStatus?: Function }} [opts]
 */
export async function waitForZplPrintJob(jobId, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 1500;
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const job = await getZplPrintJob(jobId);
    if (!job) throw new Error("Print job not found.");
    opts.onStatus?.(job);
    if (job.status === "printed") return job;
    if (job.status === "failed") {
      throw new Error(job.error || "Shop printer failed this job.");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    "Timed out waiting for shop print agent. On the PC with the Zebra, run scripts/start-printer-bridge.bat (keep it open / Startup)."
  );
}

/** Latest heartbeat from any shop station (for Settings UI). */
export async function listPrintStations() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("print_stations")
    .select("id, name, host_name, printer_name, last_seen_at")
    .order("last_seen_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return data ?? [];
}

export function stationIsOnline(station, withinMs = 45000) {
  if (!station?.last_seen_at) return false;
  const t = new Date(station.last_seen_at).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= withinMs;
}
