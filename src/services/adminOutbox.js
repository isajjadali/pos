import { rewriteProductIdsInSaleOutbox } from "./offlineSaleOutbox.js";

const STORAGE_KEY = "dw_admin_outbox_v1";
const REMAP_KEY = "dw_id_remap_v1";

function loadRaw() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRaw(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* quota */
  }
}

export function listAdminOutbox() {
  return loadRaw();
}

export function getAdminOutboxPendingCount() {
  return loadRaw().filter((e) => e.status === "pending" || e.status === "syncing" || e.status === "failed")
    .length;
}

export function enqueueAdminMutation(entry) {
  const row = {
    id: entry.id || crypto.randomUUID(),
    type: entry.type,
    payload: entry.payload ?? {},
    label: entry.label || entry.type,
    createdAt: entry.createdAt || new Date().toISOString(),
    status: entry.status || "pending",
    lastError: entry.lastError ?? null,
  };
  const rows = loadRaw();
  rows.push(row);
  saveRaw(rows);
  return row;
}

export function updateAdminMutation(id, patch) {
  const rows = loadRaw();
  const idx = rows.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch };
  saveRaw(rows);
  return rows[idx];
}

export function removeAdminMutation(id) {
  saveRaw(loadRaw().filter((e) => e.id !== id));
}

export function loadIdRemap() {
  try {
    const raw = localStorage.getItem(REMAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveIdRemap(map) {
  try {
    localStorage.setItem(REMAP_KEY, JSON.stringify(map || {}));
  } catch {
    /* quota */
  }
}

export function remapId(id) {
  if (!id) return id;
  const map = loadIdRemap();
  return map[id] || id;
}

export function rememberIdRemap(localId, serverId) {
  if (!localId || !serverId || localId === serverId) return;
  const map = loadIdRemap();
  map[localId] = serverId;
  saveIdRemap(map);
  // Keep queued offline sales pointing at the new server product id
  rewriteProductIdsInSaleOutbox(localId, serverId);
  import("../stores/posCart.js")
    .then(({ usePosCartStore }) => {
      const cart = usePosCartStore();
      for (const c of cart.carts || []) {
        for (const line of c.items || []) {
          if (line.product_id === localId) line.product_id = serverId;
        }
      }
    })
    .catch(() => {});
}

/** Rewrite local_* ids inside a payload using the remap table. */
export function applyRemapToPayload(payload) {
  const map = loadIdRemap();
  const walk = (v) => {
    if (typeof v === "string" && map[v]) return map[v];
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") {
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(payload);
}
