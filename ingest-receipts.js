#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  PRODUCTS_FILE,
  appendProducts,
  assignReceiptProductIds,
  readSheet,
  writeSheet,
} from "./sheet-io.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const RECEIPTS_DIR = path.join(__dirname, "receipts");

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".heic"]);

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
}

const EXTRACT_PROMPT = `You read shopkeeper purchase receipts / invoices from Pakistan (English and Urdu).
Extract EVERY line item. Translate Urdu product names into clear simple English.

Return ONLY valid JSON (no markdown) with this shape:
{
  "vendor": "shop/vendor name",
  "invoiceNo": "string or empty",
  "date": "string or empty",
  "items": [
    {
      "lineNumber": 1,
      "productName": "English name",
      "quantity": 0,
      "purchasePrice": 0,
      "salePrice": null
    }
  ]
}

Rules:
- lineNumber = SR NO / row number on THIS receipt page, top to bottom, in print order.
- quantity = pieces bought (T/QTY / تعداد / PCS). Ignore PKG/carton unless that is the sold unit.
- purchasePrice = RATE / ریٹ (unit price on receipt). NOT the AMOUNT column.
- salePrice only if selling/MRP is printed; otherwise null.
- Do NOT merge duplicate-looking rows. One JSON object per printed line.
- Ignore product CODE/SKU for IDs (we assign NT-1, HT-2, etc. locally).
- Do not invent items. If unreadable, return items: [] and vendor if visible.`;

function parseArgs(argv) {
  const positional = [];
  const options = {
    output: PRODUCTS_FILE,
    replace: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output" || arg === "-o") options.output = path.resolve(argv[++i]);
    else if (arg === "--replace") options.replace = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (!arg.startsWith("-")) positional.push(arg);
  }

  return { positional, options };
}

function printHelp() {
  console.log(`
Receipt photo → products.csv

Usage:
  node ingest-receipts.js [receipts folder or image files]

With no arguments, reads all images from ./receipts in this repo.

Reads and updates one file: products.csv (tab-separated so paste splits columns).
Open it, Ctrl+A, Ctrl+C, then paste into Google Sheets.

Options:
  -o, --output <file.csv>    Sheet path (default: products.csv)
  --replace                  Overwrite sheet instead of adding quantities

API key (environment or .env file in project root):
  GEMINI_API_KEY     (free from Google AI Studio)  recommended
  OPENAI_API_KEY     (optional fallback)

Example:
  npm run ingest
  node ingest-receipts.js
  node ingest-receipts.js receipts/single.jpg
`);
}

function resolveInputPath(input) {
  if (path.isAbsolute(input) && fs.existsSync(input)) return input;
  const fromCwd = path.resolve(process.cwd(), input);
  if (fs.existsSync(fromCwd)) return fromCwd;
  const fromRepo = path.join(__dirname, input);
  if (fs.existsSync(fromRepo)) return fromRepo;
  throw new Error(`Not found: ${input}`);
}

function collectImages(inputs) {
  const files = [];
  for (const input of inputs) {
    const resolved = resolveInputPath(input);
    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(resolved).sort()) {
        const full = path.join(resolved, name);
        if (IMAGE_EXT.has(path.extname(name).toLowerCase()) && fs.statSync(full).isFile()) {
          files.push(full);
        }
      }
    } else {
      files.push(resolved);
    }
  }
  return files;
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function extractJson(text) {
  const raw = String(text ?? "").trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Model did not return JSON.");
  }
  return JSON.parse(body.slice(start, end + 1));
}

async function extractWithGemini(filePath) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!key) return null;

  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const b64 = fs.readFileSync(filePath).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { text: EXTRACT_PROMPT },
            { inline_data: { mime_type: mimeFor(filePath), data: b64 } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1 },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `Gemini HTTP ${res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("\n");
  return extractJson(text);
}

async function extractWithOpenAI(filePath) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const b64 = fs.readFileSync(filePath).toString("base64");
  const url = `data:${mimeFor(filePath)};base64,${b64}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACT_PROMPT },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error?.message || `OpenAI HTTP ${res.status}`);
  }
  return extractJson(data.choices?.[0]?.message?.content);
}

async function extractReceipt(filePath) {
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    return extractWithGemini(filePath);
  }
  if (process.env.OPENAI_API_KEY) {
    return extractWithOpenAI(filePath);
  }
  throw new Error(
    "No API key. Set GEMINI_API_KEY (Google AI Studio) or OPENAI_API_KEY, then run again."
  );
}

function receiptToProducts(parsed, existing) {
  const vendor = String(parsed.vendor ?? "").trim() || "Unknown vendor";
  const items = Array.isArray(parsed.items) ? parsed.items : [];
  const rows = [];

  for (const item of items) {
    const productName = String(item.productName ?? item.name ?? "").trim();
    const quantity = Math.max(0, Math.floor(Number(item.quantity) || 0));
    const purchasePrice = Number(item.purchasePrice ?? item.rate);
    const saleRaw = item.salePrice;
    const salePrice =
      saleRaw === null || saleRaw === undefined || String(saleRaw).trim() === ""
        ? ""
        : Number(saleRaw);

    if (!productName || quantity <= 0) continue;

    rows.push({
      lineNumber: item.lineNumber ?? item.srNo ?? item.serial,
      productName,
      quantity,
      salePrice: Number.isFinite(salePrice) ? salePrice : "",
      purchasePrice: Number.isFinite(purchasePrice) ? purchasePrice : "",
      vendor,
    });
  }

  return assignReceiptProductIds(vendor, rows, existing);
}

async function main() {
  loadDotEnv();
  const { positional, options } = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const inputs = positional.length > 0 ? positional : [RECEIPTS_DIR];
  if (!fs.existsSync(RECEIPTS_DIR) && positional.length === 0) {
    throw new Error(`Receipts folder not found: ${RECEIPTS_DIR}`);
  }

  const images = collectImages(inputs);
  if (images.length === 0) {
    throw new Error("No image files found.");
  }

  let products = options.replace ? [] : readSheet(options.output);
  const before = products.length;

  for (const image of images) {
    console.log(`Reading ${path.basename(image)} ...`);
    const parsed = await extractReceipt(image);
    const rows = receiptToProducts(parsed, products);
    console.log(
      `  vendor: ${parsed.vendor || "-"} | invoice: ${parsed.invoiceNo || "-"} | items: ${rows.length}`
    );
    products = appendProducts(products, rows);
  }

  if (products.length === before) {
    throw new Error("No line items extracted from the photos.");
  }

  writeSheet(options.output, products);

  console.log(`Sheet updated. ${products.length} rows (+${products.length - before} new lines, no merging).`);
  console.log(`File: ${options.output}`);
  console.log("Open products.csv, copy all, paste into Google Sheets. Columns should split.");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
