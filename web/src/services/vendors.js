import { requireSupabase } from "../lib/supabase.js";

export async function listVendors({ search = "", activeOnly = false, page = 1, pageSize = 20 } = {}) {
  const sb = requireSupabase();
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = sb
    .from("vendors")
    .select("*", { count: "exact" })
    .order("name")
    .range(from, to);

  if (search.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  return { rows: data ?? [], total: count ?? 0 };
}

export async function getVendor(id) {
  const sb = requireSupabase();
  const { data, error } = await sb.from("vendors").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createVendor(payload) {
  const sb = requireSupabase();
  const row = {
    name: String(payload.name ?? "").trim(),
    contact_person: payload.contact_person?.trim() || null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    notes: payload.notes?.trim() || null,
    is_active: payload.is_active !== false,
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Vendor name is required");
  const { data, error } = await sb.from("vendors").insert(row).select().single();
  if (error) throw error;
  return data;
}

export async function updateVendor(id, payload) {
  const sb = requireSupabase();
  const row = {
    name: String(payload.name ?? "").trim(),
    contact_person: payload.contact_person?.trim() || null,
    phone: payload.phone?.trim() || null,
    address: payload.address?.trim() || null,
    notes: payload.notes?.trim() || null,
    is_active: Boolean(payload.is_active),
    updated_at: new Date().toISOString(),
  };
  if (!row.name) throw new Error("Vendor name is required");
  const { data, error } = await sb.from("vendors").update(row).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function listActiveVendorOptions() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from("vendors")
    .select("id, name")
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return data ?? [];
}
