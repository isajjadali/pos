import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase } from "../utils/titleCase.js";

export async function listVendors({ search = "", activeOnly = false, page = 1, pageSize = 20 } = {}) {
  const res = await listVendorsWithProductCounts({
    search,
    activeOnly,
    productFilter: "all",
    page,
    pageSize,
  });
  return { rows: res.rows, total: res.total };
}

/**
 * Vendors with linked product counts + filter (all | none | has).
 * productFilter "none" = safe to delete (0 products).
 */
export async function listVendorsWithProductCounts({
  search = "",
  activeOnly = false,
  productFilter = "all",
  page = 1,
  pageSize = 20,
  sortKey = null,
  sortOrder = null,
} = {}) {
  const sb = requireSupabase();

  let query = sb.from("vendors").select("*").order("name");
  if (search.trim()) {
    query = query.ilike("name", `%${search.trim()}%`);
  }
  if (activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data: vendors, error } = await query;
  if (error) throw error;

  const { data: products, error: pErr } = await sb.from("products").select("vendor_id");
  if (pErr) throw pErr;

  const countMap = {};
  for (const p of products ?? []) {
    if (p.vendor_id) {
      countMap[p.vendor_id] = (countMap[p.vendor_id] || 0) + 1;
    }
  }

  let enriched = (vendors ?? []).map((v) => ({
    ...v,
    product_count: countMap[v.id] || 0,
  }));

  if (productFilter === "none") {
    enriched = enriched.filter((v) => v.product_count === 0);
  } else if (productFilter === "has") {
    enriched = enriched.filter((v) => v.product_count > 0);
  }

  if (sortKey && sortOrder) {
    const asc = sortOrder === "ascend";
    enriched = [...enriched].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "product_count") {
        cmp = a.product_count - b.product_count;
      } else if (sortKey === "is_active") {
        cmp = a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1;
      } else {
        const va = a[sortKey] ?? "";
        const vb = b[sortKey] ?? "";
        cmp = String(va).localeCompare(String(vb), undefined, { sensitivity: "base", numeric: true });
      }
      return asc ? cmp : -cmp;
    });
  }

  const total = enriched.length;
  const from = (page - 1) * pageSize;
  const rows = enriched.slice(from, from + pageSize);

  const summary = {
    vendorTotal: (vendors ?? []).length,
    withProducts: (vendors ?? []).filter((v) => (countMap[v.id] || 0) > 0).length,
    withoutProducts: (vendors ?? []).filter((v) => (countMap[v.id] || 0) === 0).length,
  };

  return { rows, total, summary };
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
    name: toTitleCase(payload.name),
    contact_person: payload.contact_person?.trim()
      ? toTitleCase(payload.contact_person)
      : null,
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
    name: toTitleCase(payload.name),
    contact_person: payload.contact_person?.trim()
      ? toTitleCase(payload.contact_person)
      : null,
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

/** Deletes vendor only when zero products are linked (admin RPC). */
export async function deleteVendor(id) {
  const sb = requireSupabase();
  const { data, error } = await sb.rpc("delete_vendor_if_unused", { p_vendor_id: id });
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
