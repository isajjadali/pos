/** Fields we never show in audit detail (ids / noise / full dumps). */
const SKIP_KEYS = new Set([
  "id",
  "created_at",
  "updated_at",
  "created_by",
  "external_product_id_sort",
  "is_low_stock",
]);

/** Friendly labels for known columns. */
const FIELD_LABELS = {
  name: "Name",
  full_name: "Name",
  email: "Email",
  role: "Role",
  sku: "SKU",
  barcode: "Barcode",
  external_product_id: "Product ID",
  category_id: "Category",
  vendor_id: "Vendor",
  selling_price: "Selling price",
  weighted_avg_cost: "Purchase cost (avg)",
  current_stock: "Stock",
  unprinted_barcode_qty: "Unprinted labels",
  low_stock_threshold: "Low stock threshold",
  is_active: "Active",
  pieces_per_pack: "Pieces per pack",
  pieces_per_box: "Pieces per box",
  piece_selling_price: "Piece price",
  pack_selling_price: "Pack price",
  box_selling_price: "Box price",
  default_sale_unit: "Default sale unit",
  tags: "Tags",
  contact_person: "Contact person",
  phone: "Phone",
  address: "Address",
  notes: "Notes",
  status: "Status",
  sale_reference: "Sale reference",
  total_amount: "Total",
  payment_method: "Payment",
  cash_received: "Cash received",
  change_amount: "Change",
  completed_at: "Completed at",
  store_name: "Store name",
  currency_code: "Currency",
  default_low_stock_threshold: "Default low stock",
  receipt_footer: "Receipt footer",
  label_width_mm: "Label width (mm)",
  label_height_mm: "Label height (mm)",
  movement_type: "Movement type",
  quantity_change: "Qty change",
  previous_quantity: "Qty before",
  new_quantity: "Qty after",
  unit_cost: "Unit cost",
  product_id: "Product",
  reference_type: "Reference type",
  reference_id: "Reference",
  percent_off: "Percent off",
  starts_at: "Starts",
  ends_at: "Ends",
  target_type: "Target type",
  target_ids: "Targets",
};

function labelFor(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return String(key || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function valuesEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb) && na === nb) return true;
  }
  const boolish = (v) => {
    if (v === true || v === "true" || v === "t") return true;
    if (v === false || v === "false" || v === "f") return false;
    return null;
  };
  const ba = boolish(a);
  const bb = boolish(b);
  if (ba !== null && bb !== null) return ba === bb;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function formatValue(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (v === "true" || v === "t") return "Yes";
  if (v === "false" || v === "f") return "No";
  if (Array.isArray(v)) {
    if (!v.length) return "—";
    return v.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
  }
  if (isPlainObject(v)) {
    const keys = Object.keys(v);
    if (!keys.length) return "—";
    // Keep compact for nested blobs
    return keys
      .slice(0, 8)
      .map((k) => `${labelFor(k)}: ${formatValue(v[k])}`)
      .join("; ");
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    try {
      return new Date(s).toLocaleString();
    } catch {
      return s;
    }
  }
  return s;
}

/**
 * Build human-readable change rows for an audit log entry.
 * @returns {Array<{ key: string, label: string, kind: 'changed'|'added'|'removed'|'set', from?: string, to?: string, value?: string }>}
 */
export function buildAuditChangeRows(before, after, action = "update") {
  const beforeObj = isPlainObject(before) ? before : null;
  const afterObj = isPlainObject(after) ? after : null;

  if (!beforeObj && afterObj) {
    // Create — show fields that were set
    return Object.keys(afterObj)
      .filter((k) => !SKIP_KEYS.has(k))
      .filter((k) => {
        const v = afterObj[k];
        return v != null && v !== "" && !(Array.isArray(v) && !v.length);
      })
      .sort((a, b) => labelFor(a).localeCompare(labelFor(b)))
      .map((key) => ({
        key,
        label: labelFor(key),
        kind: "set",
        value: formatValue(afterObj[key]),
      }));
  }

  if (beforeObj && !afterObj) {
    // Delete — show what existed
    return Object.keys(beforeObj)
      .filter((k) => !SKIP_KEYS.has(k))
      .filter((k) => {
        const v = beforeObj[k];
        return v != null && v !== "" && !(Array.isArray(v) && !v.length);
      })
      .sort((a, b) => labelFor(a).localeCompare(labelFor(b)))
      .map((key) => ({
        key,
        label: labelFor(key),
        kind: "removed",
        value: formatValue(beforeObj[key]),
      }));
  }

  if (!beforeObj || !afterObj) return [];

  const keys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const rows = [];
  for (const key of keys) {
    if (SKIP_KEYS.has(key)) continue;
    const from = beforeObj[key];
    const to = afterObj[key];
    if (valuesEqual(from, to)) continue;

    const fromEmpty = from == null || from === "" || (Array.isArray(from) && !from.length);
    const toEmpty = to == null || to === "" || (Array.isArray(to) && !to.length);

    if (fromEmpty && !toEmpty) {
      rows.push({ key, label: labelFor(key), kind: "added", value: formatValue(to) });
    } else if (!fromEmpty && toEmpty) {
      rows.push({ key, label: labelFor(key), kind: "removed", value: formatValue(from) });
    } else {
      rows.push({
        key,
        label: labelFor(key),
        kind: "changed",
        from: formatValue(from),
        to: formatValue(to),
      });
    }
  }

  rows.sort((a, b) => a.label.localeCompare(b.label));

  // Soft-delete / cancel often only flips one field — still fine
  if (!rows.length && (action === "soft_delete" || action === "cancel" || action === "reactivate")) {
    return [
      {
        key: "_action",
        label: "Action",
        kind: "set",
        value: String(action).replace(/_/g, " "),
      },
    ];
  }

  return rows;
}
