/** Minimal RFC4180-style CSV parser (UTF-8). */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  const s = String(text ?? "").replace(/^\uFEFF/, "");

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const next = s[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field.trim());
      field = "";
    } else if (c === "\n") {
      row.push(field.trim());
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") {
      field += c;
    }
  }

  row.push(field.trim());
  if (row.some((cell) => cell !== "")) rows.push(row);

  return rows;
}

export function rowsToObjects(rows) {
  if (!rows.length) return { headers: [], records: [] };
  const headers = rows[0].map((h) => String(h).trim());
  const records = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] ?? "";
    });
    return obj;
  });
  return { headers, records };
}

export const IMPORT_FIELD_OPTIONS = [
  { value: "external_product_id", label: "Product ID" },
  { value: "name", label: "Product name" },
  { value: "quantity", label: "Quantity" },
  { value: "purchase_price", label: "Purchase price" },
  { value: "selling_price", label: "Sale price" },
  { value: "vendor", label: "Vendor" },
  { value: "sku", label: "SKU" },
  { value: "barcode", label: "Barcode" },
  { value: "category", label: "Category" },
  { value: "skip", label: "(Skip column)" },
];

export const SAMPLE_CSV = `product id,Product name,quantity,sale price,purchase price,vendor
AR-1,Oil Sprayer,8,350,250,Al Rehman International`;
