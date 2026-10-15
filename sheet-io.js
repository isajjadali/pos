import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import XLSX from "xlsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const PRODUCTS_FILE = path.join(__dirname, "products.csv");

export const HEADERS = [
  "product id",
  "Product name",
  "quantity",
  "sale price",
  "purchase price",
  "per piece price",
  "vendor",
];

const COLUMN_ALIASES = {
  productId: ["product id", "productid", "product_id", "id", "sku", "barcode"],
  productName: ["product name", "productname", "product_name", "name", "title", "description"],
  quantity: ["quantity", "qty", "count", "stock"],
  salePrice: ["sale price", "saleprice", "sale_price", "price", "mrp", "selling price"],
  purchasePrice: ["purchase price", "purchaseprice", "purchase_price", "cost", "rate"],
  perPiecePrice: ["per piece price", "perpieceprice", "per_piece_price", "piece price"],
  vendor: ["vendor", "supplier", "supplier name"],
};

export function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function vendorPrefix(vendor) {
  const words = String(vendor ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "XX";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 3);
}

/** e.g. "12Pcs Jungle Zoo", "4PCS", "100Pcs", "2-Side 12P Car Box" → piece count */
export function parsePiecesFromProductName(productName) {
  const name = String(productName ?? "");
  if (/\b\d+\s*dz\b/i.test(name)) return 12;
  const patterns = [
    /\b(\d+)\s*pcs\b/i,
    /\b(\d+)\s*pc\b/i,
    /\b(\d+)pc\b/i,
    /\b(\d+)p(?=\s|[a-z])/i,
  ];
  for (const re of patterns) {
    const m = name.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

export function computePerPiecePrice(purchasePrice, productName) {
  const pieces = parsePiecesFromProductName(productName);
  const rate = Number(purchasePrice);
  if (!pieces || !Number.isFinite(rate)) return "";
  const per = rate / pieces;
  return Math.round(per * 100) / 100;
}

export function enrichRow(row) {
  const purchase = row.purchasePrice;
  const perPiece =
    row.perPiecePrice !== "" && row.perPiecePrice !== undefined && row.perPiecePrice !== null
      ? Number(row.perPiecePrice)
      : computePerPiecePrice(purchase, row.productName);
  return {
    ...row,
    perPiecePrice: Number.isFinite(perPiece) ? perPiece : row.perPiecePrice ?? "",
  };
}

function maxIdNumberForPrefix(prefix, ids) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`, "i");
  for (const id of ids) {
    const m = String(id).match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

/** Vendor prefix + receipt line number (SR NO). If taken, next free number. */
export function assignReceiptProductIds(vendor, items, existing = []) {
  const prefix = vendorPrefix(vendor);
  const used = new Set(
    existing.map((p) => String(p.productId ?? "").trim().toUpperCase()).filter(Boolean)
  );
  let nextFree = maxIdNumberForPrefix(prefix, used) + 1;

  return items.map((item, index) => {
    const lineNo = Math.max(
      1,
      Math.floor(Number(item.lineNumber ?? item.srNo ?? item.serial ?? index + 1))
    );
    let productId = `${prefix}-${lineNo}`;
    if (used.has(productId.toUpperCase())) {
      productId = `${prefix}-${nextFree}`;
      nextFree += 1;
    } else {
      nextFree = Math.max(nextFree, lineNo + 1);
    }
    used.add(productId.toUpperCase());

    return enrichRow({
      productId,
      productName: item.productName,
      quantity: item.quantity,
      salePrice: item.salePrice ?? "",
      purchasePrice: item.purchasePrice,
      vendor,
    });
  });
}

export function appendProducts(existing, incoming) {
  return [...existing, ...incoming.map((r) => enrichRow(r))];
}

function mapColumns(headers) {
  const normalized = headers.map(normalizeHeader);
  const index = {};
  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    const idx = normalized.findIndex((h) => aliases.includes(h));
    if (idx !== -1) index[field] = idx;
  }
  return index;
}

function cell(row, index, fallback = "") {
  if (index === undefined) return fallback;
  return row[index] ?? fallback;
}

export function rowsToProducts(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((h) => String(h));
  const col = mapColumns(headers);
  const products = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => String(c ?? "").trim() === "")) continue;

    const productId = String(cell(row, col.productId)).trim();
    const productName = String(cell(row, col.productName)).trim();
    const vendor = String(cell(row, col.vendor)).trim();
    const quantity = Math.max(0, Math.floor(Number(cell(row, col.quantity)) || 0));
    const saleRaw = String(cell(row, col.salePrice)).trim();
    const purchaseRaw = String(cell(row, col.purchasePrice)).trim();
    const perPieceRaw = String(cell(row, col.perPiecePrice)).trim();
    const salePrice = saleRaw === "" ? "" : Number(saleRaw.replace(/[^\d.-]/g, ""));
    const purchasePrice =
      purchaseRaw === "" ? "" : Number(purchaseRaw.replace(/[^\d.-]/g, ""));
    const perPiecePrice =
      perPieceRaw === "" ? "" : Number(perPieceRaw.replace(/[^\d.-]/g, ""));

    if (!productId || !productName) continue;

    products.push(
      enrichRow({
        productId,
        productName,
        quantity,
        salePrice: Number.isFinite(salePrice) ? salePrice : saleRaw,
        purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : purchaseRaw,
        perPiecePrice: Number.isFinite(perPiecePrice) ? perPiecePrice : perPieceRaw,
        vendor,
      })
    );
  }

  return products;
}

function detectDelimiter(text) {
  const firstLine = String(text).split(/\r?\n/, 1)[0] || "";
  const tabs = (firstLine.match(/\t/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return tabs >= commas ? "\t" : ",";
}

export function readSheet(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
    const text = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
    const workbook = XLSX.read(text, {
      type: "string",
      FS: detectDelimiter(text),
      raw: false,
    });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
    return rowsToProducts(rows);
  }

  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  return rowsToProducts(rows);
}

export function productsToAoA(products) {
  return [
    HEADERS,
    ...products.map((p) => {
      const row = enrichRow(p);
      return [
        row.productId,
        row.productName,
        row.quantity,
        row.salePrice === "" || row.salePrice === undefined ? "" : row.salePrice,
        row.purchasePrice === "" || row.purchasePrice === undefined ? "" : row.purchasePrice,
        row.perPiecePrice === "" || row.perPiecePrice === undefined ? "" : row.perPiecePrice,
        row.vendor,
      ];
    }),
  ];
}

export function writeSheet(filePath, products) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const aoa = productsToAoA(products);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv" || ext === ".tsv" || ext === ".txt") {
    const tsv = XLSX.utils.sheet_to_csv(XLSX.utils.aoa_to_sheet(aoa), {
      FS: "\t",
      RS: "\r\n",
    });
    fs.writeFileSync(filePath, tsv, "utf8");
    return;
  }

  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(aoa);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 28 },
    { wch: 10 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "products");
  XLSX.writeFile(workbook, filePath);
}
