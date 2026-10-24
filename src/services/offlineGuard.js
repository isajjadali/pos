import { getIsOnline as browserIsOnline, onConnectivityChange } from "../composables/useOnlineStatus.js";
import { isLikelyNetworkError } from "./offlineSaleOutbox.js";

/**
 * After hard network failures we prefer the local path until the browser fires
 * `online` or a request succeeds — so hung Supabase calls don't freeze the UI.
 *
 * Sticky offline must NOT drive the yellow "Offline" banner (that uses
 * navigator.onLine only). A single slow request timeout is not "offline".
 */
let forcedOffline = false;
let consecutiveSoftFailures = 0;
let connectivityHooked = false;

/** Soft failures (timeouts) while browser says online before sticky-routing. */
const SOFT_FAILURES_BEFORE_STICKY = 3;

function ensureConnectivityHook() {
  if (connectivityHooked || typeof window === "undefined") return;
  connectivityHooked = true;
  onConnectivityChange((online) => {
    if (online) clearForcedOffline();
  });
}

/**
 * @param {{ hard?: boolean }} [opts] hard = definite network down (fetch failed / browser offline)
 */
export function markLikelyOffline(opts = {}) {
  ensureConnectivityHook();
  const hard = Boolean(opts.hard) || !browserIsOnline();

  if (!hard) {
    consecutiveSoftFailures += 1;
    if (consecutiveSoftFailures < SOFT_FAILURES_BEFORE_STICKY) {
      // One slow request ≠ offline — fall back for this call only (caller handles).
      return;
    }
  }

  consecutiveSoftFailures = 0;
  if (forcedOffline) return;
  forcedOffline = true;
}

export function clearForcedOffline() {
  consecutiveSoftFailures = 0;
  if (!forcedOffline) return;
  forcedOffline = false;
}

/** Call after any successful server round-trip. */
export function noteOnlineSuccess() {
  consecutiveSoftFailures = 0;
  clearForcedOffline();
}

export function getEffectiveOnline() {
  ensureConnectivityHook();
  if (!browserIsOnline()) return false;
  if (forcedOffline) return false;
  return true;
}

/** Prefer offline path when the browser reports offline (or we detected a dead network). */
export function shouldWriteOffline() {
  return !getEffectiveOnline();
}

/** Prefer cached reads when offline. */
export function shouldReadOffline() {
  return !getEffectiveOnline();
}

function isTimeoutError(err) {
  return err?.name === "TimeoutError" || String(err?.message || "").includes("timeout");
}

/**
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 */
export function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Request timeout after ${ms}ms`);
      err.name = "TimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Run an online write; on network failure / timeout, run the offline fallback.
 * @template T
 * @param {() => Promise<T>} onlineFn
 * @param {() => Promise<T>|T} offlineFn
 * @param {{ timeoutMs?: number|null }} [opts]
 */
export async function onlineOrOfflineWrite(onlineFn, offlineFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 8000;
  if (shouldWriteOffline()) {
    return await offlineFn();
  }
  try {
    const run = Promise.resolve().then(onlineFn);
    const result =
      timeoutMs == null || timeoutMs <= 0 ? await run : await withTimeout(run, timeoutMs);
    noteOnlineSuccess();
    return result;
  } catch (e) {
    if (isLikelyNetworkError(e) || isTimeoutError(e)) {
      markLikelyOffline({ hard: isLikelyNetworkError(e) && !isTimeoutError(e) });
      return await offlineFn();
    }
    throw e;
  }
}

/**
 * Cached read with a network timeout so UI stays snappy when the wire is dead.
 * Pass `timeoutMs: 0` (or null) to disable — needed for multi-page catalog fetches.
 * @template T
 * @param {() => Promise<T>} onlineFn
 * @param {() => Promise<T>|T} offlineFn
 * @param {{ timeoutMs?: number|null }} [opts]
 */
export async function onlineOrOfflineRead(onlineFn, offlineFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  if (shouldReadOffline()) {
    return await offlineFn();
  }
  try {
    const run = Promise.resolve().then(onlineFn);
    const result =
      timeoutMs == null || timeoutMs <= 0 ? await run : await withTimeout(run, timeoutMs);
    noteOnlineSuccess();
    return result;
  } catch (e) {
    if (isLikelyNetworkError(e) || isTimeoutError(e)) {
      // Timeout while browser says online → soft (no sticky until repeated).
      markLikelyOffline({ hard: isLikelyNetworkError(e) && !isTimeoutError(e) });
      return await offlineFn();
    }
    throw e;
  }
}

export function newLocalId(prefix = "local") {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function isLocalId(id) {
  return typeof id === "string" && (id.startsWith("local_") || id.startsWith("localv_") || id.startsWith("localc_"));
}
