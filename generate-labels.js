#!/usr/bin/env node
import fs from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import bwipjs from "bwip-js";
import { PRODUCTS_FILE, readSheet } from "./sheet-io.js";

const MM_TO_PT = 72 / 25.4;

function parseArgs(argv) {
  const positional = [];
  const options = {
    output: null,
    widthMm: 50,
    heightMm: 30,
    currency: "Rs",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--output" || arg === "-o") {
      options.output = argv[++i];
    } else if (arg === "--width-mm") {
      options.widthMm = Number(argv[++i]);
    } else if (arg === "--height-mm") {
      options.heightMm = Number(argv[++i]);
    } else if (arg === "--currency") {
      options.currency = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }

  return { positional, options };
}

function printHelp() {
  console.log(`
Barcode Label Generator (local)

Usage:
  node generate-labels.js [products.csv] [options]

Default sheet: products.csv (same file receipts update).
Copy/paste that CSV into Google Sheets anytime.

Options:
  -o, --output <file.pdf>   Output PDF path (default: labels-<timestamp>.pdf)
  --width-mm <number>       Label width in mm (default: 50)
  --height-mm <number>      Label height in mm (default: 30)
  --currency <symbol>       Price prefix (default: Rs)

Sheet columns:
  product id, Product name, quantity, sale price, purchase price, per piece price, vendor

Each label shows: barcode (product id), name, sale price.
Prints one label per row in quantity (e.g. qty 5 => 5 identical labels).

Example:
  node generate-labels.js
  node generate-labels.js products.csv -o my-labels.pdf --width-mm 40 --height-mm 25
`);
}

function readProducts(filePath) {
  const products = readSheet(filePath).filter((p) => {
    if (!p.productId || !p.productName) {
      console.warn("Skipping row: missing product id or name.");
      return false;
    }
    if (p.quantity <= 0) {
      console.warn(`Skipping ${p.productId}: quantity is 0.`);
      return false;
    }
    return true;
  });
  if (products.length === 0) {
    throw new Error("No valid product rows found.");
  }
  return products;
}

function formatPrice(value, currency) {
  const raw = String(value ?? "").trim();
  if (raw === "") return "";
  const num = Number(raw.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(num)) {
    return `${currency} ${num.toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
  }
  return `${currency} ${raw}`;
}

function truncate(text, maxLen) {
  const s = String(text);
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen - 1)}…`;
}

async function makeBarcodePng(productId) {
  return bwipjs.toBuffer({
    bcid: "code128",
    text: productId,
    scale: 2,
    height: 8,
    includetext: false,
    paddingwidth: 2,
    paddingheight: 2,
  });
}

async function buildPdf(products, options) {
  const widthPt = options.widthMm * MM_TO_PT;
  const heightPt = options.heightMm * MM_TO_PT;
  const margin = 4;
  const contentWidth = widthPt - margin * 2;

  const doc = new PDFDocument({
    size: [widthPt, heightPt],
    margin: 0,
    autoFirstPage: false,
  });

  const chunks = [];
  doc.on("data", (c) => chunks.push(c));

  const done = new Promise((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let totalLabels = 0;

  for (const product of products) {
    const barcodeBuffer = await makeBarcodePng(product.productId);
    const priceText = formatPrice(product.salePrice, options.currency);
    const nameText = truncate(product.productName, 28);
    const idText = `ID: ${product.productId}`;

    for (let i = 0; i < product.quantity; i++) {
      doc.addPage({ size: [widthPt, heightPt], margin: 0 });
      totalLabels++;

      let y = margin;

      doc.font("Helvetica-Bold").fontSize(7).text(nameText, margin, y, {
        width: contentWidth,
        align: "center",
        lineBreak: false,
        ellipsis: true,
      });
      y += 10;

      const barcodeHeight = Math.min(36, heightPt * 0.45);
      doc.image(barcodeBuffer, margin, y, {
        fit: [contentWidth, barcodeHeight],
        align: "center",
        valign: "center",
      });
      y += barcodeHeight + 2;

      doc.font("Helvetica").fontSize(6.5).text(idText, margin, y, {
        width: contentWidth,
        align: "center",
      });
      y += 8;

      doc.font("Helvetica-Bold").fontSize(9).text(priceText, margin, y, {
        width: contentWidth,
        align: "center",
      });
    }
  }

  doc.end();
  const buffer = await done;
  return { buffer, totalLabels };
}

async function main() {
  const { positional, options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const inputPath = path.resolve(positional[0] || PRODUCTS_FILE);
  if (!fs.existsSync(inputPath)) {
    console.error(`File not found: ${inputPath}`);
    process.exit(1);
  }

  const outputPath =
    options.output ??
    path.join(
      path.dirname(inputPath),
      `labels-${path.basename(inputPath, path.extname(inputPath))}-${Date.now()}.pdf`
    );

  const products = readProducts(inputPath);
  const { buffer, totalLabels } = await buildPdf(products, options);

  fs.writeFileSync(outputPath, buffer);

  const skuCount = products.length;
  console.log(`Done. ${totalLabels} label(s) for ${skuCount} product(s).`);
  console.log(`PDF: ${outputPath}`);
  console.log("Open the PDF and print to your barcode printer (one label per page).");
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
