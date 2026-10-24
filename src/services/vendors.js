import { requireSupabase } from "../lib/supabase.js";
import { toTitleCase } from "../utils/titleCase.js";
import { isTimestampInRange, resolveDateRange } from "../utils/dateRange.js";
import { onlineOrOfflineWrite, onlineOrOfflineRead } from "./offlineGuard.js";
import {
  offlineCreateVendor,
  offlineUpdateVendor,
  offlineDeleteVendor,
} from "./adminOfflineApply.js";
import { useMetaCacheStore } from "../stores/metaCache.js";
import { countProductsByField } from "../utils/localCatalogCounts.js";
import { matchesSearch } from "../utils/textSearch.js";

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
function listVendorsLocal({
  search = "",
  activeOnly = false,
  productFilter = "all",
  createdRangePreset = "all",
  createdFrom = null,
  createdTo = null,
  page = 1,
  pageSize = 20,
  sortKey = null,
  sortOrder = null,
} = {}) {
  const meta = useMetaCacheStore();
  const countMap = countProductsByField("vendor_id");
  const createdRange = resolveDateRange(createdRangePreset, createdFrom, createdTo);
  let enriched = meta.vendors.map((v) => ({
    ...v,
    product_count: countMap[v.id] || 0,
  }));
  if (search.trim()) {
    enriched = enriched.filter((v) => matchesSearch(v.name, search));
  }
  if (activeOnly) enriched = enriched.filter((v) => v.is_active !== false);
  if (productFilter === "none") enriched = enriched.filter((v) => v.product_count === 0);
  else if (productFilter === "has") enriched = enriched.filter((v) => v.product_count > 0);
  enriched = enriched.filter((v) => isTimestampInRange(v.created_at, createdRange));

  if (sortKey && sortOrder) {
    const asc = sortOrder === "ascend";
    enriched = [...enriched].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "product_count") cmp = a.product_count - b.product_count;
      else if (sortKey === "is_active") cmp = a.is_active === b.is_active ? 0 : a.is_active ? -1 : 1;
      else {
        cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""), undefined, {
          sensitivity: "base",
          numeric: true,
        });
      }
      return asc ? cmp : -cmp;
    });
  }
  const total = enriched.length;
  const from = (page - 1) * pageSize;
  const withoutProducts = enriched.filter((v) => v.product_count === 0).length;
  return {
    rows: enriched.slice(from, from + pageSize),
    total,
    summary: {
      vendorTotal: enriched.length,
      withProducts: enriched.filter((v) => v.product_count > 0).length,
      withoutProducts,
    },
  };
}

export async function listVendorsWithProductCounts(opts = {}) {
  return onlineOrOfflineRead(async () => {
    const {
      search = "",
      activeOnly = false,
      productFilter = "all",
      createdRangePreset = "all",
      createdFrom = null,
      createdTo = null,
      page = 1,
      pageSize = 20,
      sortKey = null,
      sortOrder = null,
    } = opts;
    const sb = requireSupabase();
    const createdRange = resolveDateRange(createdRangePreset, createdFrom, createdTo);

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
    useMetaCacheStore().setVendors(vendors ?? []);

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
    enriched = enriched.filter((v) => isTimestampInRange(v.created_at, createdRange));

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
          cmp = String(va).localeCompare(String(vb), undefined, {
            sensitivity: "base",
            numeric: true,
          });
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
  }, () => listVendorsLocal(opts));
}

export async function getVendor(id) {
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const { data, error } = await sb.from("vendors").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
    () => useMetaCacheStore().vendors.find((v) => v.id === id) || null
  );
}

export async function createVendor(payload) {
  return onlineOrOfflineWrite(async () => {
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
    useMetaCacheStore().upsertVendor(data);
    return data;
  }, () => offlineCreateVendor(payload));
}

export async function updateVendor(id, payload) {
  return onlineOrOfflineWrite(async () => {
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
    useMetaCacheStore().upsertVendor(data);
    return data;
  }, () => offlineUpdateVendor(id, payload));
}

/** Soft-delete vendor (is_active = false). Linked products keep vendor_id. */
export async function deleteVendor(id) {
  return onlineOrOfflineWrite(async () => {
    const sb = requireSupabase();
    const { data, error } = await sb.rpc("delete_vendor_if_unused", { p_vendor_id: id });
    if (error) throw error;
    useMetaCacheStore().upsertVendor({
      ...(useMetaCacheStore().vendors.find((v) => v.id === id) || { id }),
      is_active: false,
      updated_at: new Date().toISOString(),
    });
    return data;
  }, () => offlineDeleteVendor(id));
}

export async function listActiveVendorOptions() {
  return onlineOrOfflineRead(
    async () => {
      const sb = requireSupabase();
      const { data, error } = await sb
        .from("vendors")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    () =>
      useMetaCacheStore()
        .vendors.filter((v) => v.is_active !== false)
        .map((v) => ({ id: v.id, name: v.name }))
        .sort((a, b) => String(a.name).localeCompare(String(b.name)))
  );
}
