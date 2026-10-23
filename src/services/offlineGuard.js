import { getIsOnline as browserIsOnline, onConnectivityChange } from "../composables/useOnlineStatus.js";
import { isLikelyNetworkError } from "./offlineSaleOutbox.js";

/**
 * After a network failure we stay on the local path until the browser fires
 * `online` — otherwise every click waits for a hung Supabase fetch (very slow).
 */
let forcedOffline = false;
let connectivityHooked = false;

function ensureConnectivityHook() {
  if (connectivityHooked || typeof window === "undefined") return;
  connectivityHooked = true;
  onConnectivityChange((online) => {
    if (online) clearForcedOffline();
  });
}

export function markLikelyOffline() {
  ensureConnectivityHook();
  if (forcedOffline) return;
  forcedOffline = true;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dw-forced-offline", { detail: { offline: true } }));
  }
}

export function clearForcedOffline() {
  if (!forcedOffline) return;
  forcedOffline = false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dw-forced-offline", { detail: { offline: false } }));
  }
}

export function getEffectiveOnline() {
  ensureConnectivityHook();
  if (forcedOffline) return false;
  return browserIsOnline();
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
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function onlineOrOfflineWrite(onlineFn, offlineFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 4000;
  if (shouldWriteOffline()) {
    return await offlineFn();
  }
  try {
    const run = Promise.resolve().then(onlineFn);
    // timeoutMs <= 0 or null → no race (long multi-page jobs)
    if (timeoutMs == null || timeoutMs <= 0) return await run;
    return await withTimeout(run, timeoutMs);
  } catch (e) {
    if (isLikelyNetworkError(e) || isTimeoutError(e)) {
      markLikelyOffline();
      return await offlineFn();
    }
    throw e;
  }
}

/**
 * Cached read with a short network timeout so UI stays snappy when the wire is dead.
 * Pass `timeoutMs: 0` (or null) to disable — needed for multi-page catalog fetches.
 * @template T
 * @param {() => Promise<T>} onlineFn
 * @param {() => Promise<T>|T} offlineFn
 * @param {{ timeoutMs?: number|null }} [opts]
 */
export async function onlineOrOfflineRead(onlineFn, offlineFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  if (shouldReadOffline()) {
    return await offlineFn();
  }
  try {
    const run = Promise.resolve().then(onlineFn);
    if (timeoutMs == null || timeoutMs <= 0) return await run;
    return await withTimeout(run, timeoutMs);
  } catch (e) {
    if (isLikelyNetworkError(e) || isTimeoutError(e)) {
      markLikelyOffline();
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
