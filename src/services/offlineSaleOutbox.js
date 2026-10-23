const STORAGE_KEY = "dw_sale_outbox_v1";

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

export function listOutboxEntries() {
  return loadRaw();
}

export function getOutboxPendingCount() {
  return loadRaw().filter((e) => e.status === "pending" || e.status === "syncing" || e.status === "failed")
    .length;
}

export function enqueueOfflineSale(entry) {
  const rows = loadRaw();
  rows.push({
    ...entry,
    status: entry.status || "pending",
    lastError: entry.lastError ?? null,
  });
  saveRaw(rows);
  return entry;
}

export function updateOutboxEntry(clientSaleId, patch) {
  const rows = loadRaw();
  const idx = rows.findIndex((e) => e.clientSaleId === clientSaleId);
  if (idx === -1) return null;
  rows[idx] = { ...rows[idx], ...patch };
  saveRaw(rows);
  return rows[idx];
}

export function removeOutboxEntry(clientSaleId) {
  const rows = loadRaw().filter((e) => e.clientSaleId !== clientSaleId);
  saveRaw(rows);
}

export function replaceOutbox(entries) {
  saveRaw(entries);
}

/** After an offline product syncs, rewrite pending sale lines to the server UUID. */
export function rewriteProductIdsInSaleOutbox(localId, serverId) {
  if (!localId || !serverId || localId === serverId) return;
  const rows = loadRaw();
  let changed = false;
  for (const entry of rows) {
    if (Array.isArray(entry.lines)) {
      for (const line of entry.lines) {
        if (line?.product_id === localId) {
          line.product_id = serverId;
          changed = true;
        }
      }
    }
    if (Array.isArray(entry.receiptItems)) {
      for (const item of entry.receiptItems) {
        if (item?.product_id === localId) {
          item.product_id = serverId;
          changed = true;
        }
      }
    }
  }
  if (changed) saveRaw(rows);
}

/** True when the failure is transient (retry later). */
export function isLikelyNetworkError(err) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = String(err?.message || err || "").toLowerCase();
  const name = String(err?.name || "");
  if (name === "TypeError" && msg.includes("fetch")) return true;
  return (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("network request failed") ||
    msg.includes("load failed") ||
    msg.includes("offline") ||
    msg.includes("net::") ||
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    err?.status === 0
  );
}

/** Hard business errors should not auto-retry forever. */
export function isHardSyncError(err) {
  if (isLikelyNetworkError(err)) return false;
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("insufficient") ||
    msg.includes("stock") ||
    msg.includes("not found") ||
    msg.includes("inactive") ||
    msg.includes("permission") ||
    msg.includes("jwt") ||
    msg.includes("auth") ||
    msg.includes("row-level security") ||
    msg.includes("rls")
  );
}
