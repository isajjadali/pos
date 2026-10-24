import { requireSupabase } from "../lib/supabase.js";
import { applyTimestampFilter, resolveDateRange } from "../utils/dateRange.js";

/**
 * Admin audit log list (requires is_admin RLS).
 */
export async function listAuditLogs({
  search = "",
  action = null,
  entityType = null,
  actorId = null,
  createdRangePreset = "all",
  createdFrom = null,
  createdTo = null,
  page = 1,
  pageSize = 50,
} = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  const range = resolveDateRange(createdRangePreset, createdFrom, createdTo);

  let query = sb
    .from("audit_logs")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  query = applyTimestampFilter(query, "created_at", range);

  if (action) query = query.eq("action", action);
  if (entityType) query = query.eq("entity_type", entityType);
  if (actorId) query = query.eq("actor_id", actorId);

  const term = String(search || "").trim();
  if (term) {
    const safe = term.replace(/[%_,]/g, "");
    if (safe) {
      query = query.or(
        `summary.ilike.%${safe}%,actor_email.ilike.%${safe}%,actor_name.ilike.%${safe}%,entity_id.ilike.%${safe}%`
      );
    }
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

/** App-level audit entry (password reset, print job, etc.). */
export async function writeAuditLog({
  action,
  entityType,
  entityId = null,
  summary = null,
  before = null,
  after = null,
  meta = {},
} = {}) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("insert_audit_log", {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_summary: summary,
    p_before: before,
    p_after: after,
    p_meta: meta,
  });
  if (error) throw error;
  return data;
}
