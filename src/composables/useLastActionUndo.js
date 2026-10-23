import { computed, ref } from "vue";

const UNDO_TTL_MS = 30_000;

/** @type {import('vue').Ref<null | { id: string, label: string, run: () => Promise<void>, expiresAt: number }>} */
const pending = ref(null);
let expireTimer = null;
let running = false;

function clearTimer() {
  if (expireTimer != null) {
    clearTimeout(expireTimer);
    expireTimer = null;
  }
}

function clearPending() {
  clearTimer();
  pending.value = null;
}

/**
 * Session one-step undo (Gmail-style). New registration replaces any previous undo.
 * @param {{ label: string, run: () => Promise<void>, ttlMs?: number }} opts
 */
export function registerLastActionUndo({ label, run, ttlMs = UNDO_TTL_MS }) {
  clearTimer();
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const expiresAt = Date.now() + Math.max(1000, ttlMs);
  pending.value = { id, label: String(label || "Undo"), run, expiresAt };
  expireTimer = setTimeout(() => {
    if (pending.value?.id === id) pending.value = null;
    expireTimer = null;
  }, Math.max(1000, ttlMs));
  return id;
}

export function clearLastActionUndo() {
  clearPending();
}

export function canUndoLastAction() {
  const p = pending.value;
  return Boolean(p && Date.now() < p.expiresAt && typeof p.run === "function");
}

/**
 * @returns {Promise<{ ok: boolean, label?: string, error?: string }>}
 */
export async function undoLastAction() {
  if (running) return { ok: false, error: "Undo already running" };
  const p = pending.value;
  if (!p || Date.now() >= p.expiresAt) {
    clearPending();
    return { ok: false, error: "Nothing to undo" };
  }
  clearPending();
  running = true;
  try {
    await p.run();
    return { ok: true, label: p.label };
  } catch (e) {
    return { ok: false, error: e?.message || "Undo failed", label: p.label };
  } finally {
    running = false;
  }
}

/** Reactive helpers for Products (and future screens). */
export function useLastActionUndo() {
  const hasUndo = computed(() => {
    const p = pending.value;
    return Boolean(p && Date.now() < p.expiresAt);
  });
  const undoLabel = computed(() => pending.value?.label || "Undo");
  const undoExpiresAt = computed(() => pending.value?.expiresAt ?? 0);

  return {
    hasUndo,
    undoLabel,
    undoExpiresAt,
    register: registerLastActionUndo,
    clear: clearLastActionUndo,
    undo: undoLastAction,
    canUndo: canUndoLastAction,
    ttlMs: UNDO_TTL_MS,
  };
}

export const LAST_ACTION_UNDO_TTL_MS = UNDO_TTL_MS;
