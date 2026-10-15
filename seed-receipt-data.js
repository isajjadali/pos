/**
 * One-time seed from receipt photos (context). Run: node seed-receipt-data.js
 * Each line = receipt row order; purchase price = unit RATE (not line total).
 */
import { PRODUCTS_FILE, assignReceiptProductIds, writeSheet, appendProducts } from "./sheet-io.js";

const nouman = {
  vendor: "Nouman Toys",
  items: [
    { lineNumber: 1, productName: "4Pcs Figure Bag S", quantity: 4, purchasePrice: 150 },
    { lineNumber: 2, productName: "12Pcs Jungle Zoo", quantity: 4, purchasePrice: 200 },
    { lineNumber: 3, productName: "Zoo Bag Mr", quantity: 4, purchasePrice: 220 },
    { lineNumber: 4, productName: "12Pcs Light Ball", quantity: 1, purchasePrice: 680 },
    { lineNumber: 5, productName: "Spinner S", quantity: 12, purchasePrice: 65 },
    { lineNumber: 6, productName: "8.5 Tab", quantity: 6, purchasePrice: 210 },
    { lineNumber: 7, productName: "2-Side 12P Car Box", quantity: 12, purchasePrice: 220 },
    { lineNumber: 8, productName: "Car Strip", quantity: 2, purchasePrice: 140 },
    { lineNumber: 9, productName: "Bubble Clapping", quantity: 12, purchasePrice: 180 },
    { lineNumber: 10, productName: "6Pcs Yellow Chuch", quantity: 6, purchasePrice: 180 },
    { lineNumber: 11, productName: "Ring Mesh S", quantity: 3, purchasePrice: 170 },
    { lineNumber: 12, productName: "Racket Mesh S", quantity: 3, purchasePrice: 130 },
    { lineNumber: 13, productName: "Pizza Strip", quantity: 3, purchasePrice: 230 },
  ],
};

const hashmiOct14 = {
  vendor: "Hashmi Traders",
  items: [
    { lineNumber: 1, productName: "Oil Brush", quantity: 6, purchasePrice: 150 },
    { lineNumber: 2, productName: "Tissue", quantity: 3, purchasePrice: 150 },
    { lineNumber: 3, productName: "Tissue", quantity: 18, purchasePrice: 130 },
    { lineNumber: 4, productName: "Tissue", quantity: 20, purchasePrice: 150 },
    { lineNumber: 5, productName: "Non-stick Spoon", quantity: 4, purchasePrice: 150 },
    { lineNumber: 6, productName: "Non-stick Spoon", quantity: 12, purchasePrice: 190 },
    { lineNumber: 7, productName: "Non-stick Spoon", quantity: 4, purchasePrice: 100 },
    { lineNumber: 8, productName: "Non-stick Spoon", quantity: 6, purchasePrice: 180 },
    { lineNumber: 9, productName: "Non-stick Spoon", quantity: 4, purchasePrice: 220 },
    { lineNumber: 10, productName: "Tumbler Bottle", quantity: 1, purchasePrice: 1480 },
    { lineNumber: 11, productName: "Tumbler Bottle", quantity: 5, purchasePrice: 1750 },
    { lineNumber: 12, productName: "Tumbler Bottle", quantity: 2, purchasePrice: 1550 },
    { lineNumber: 13, productName: "Tumbler Bottle", quantity: 2, purchasePrice: 1650 },
  ],
};

const hashmiDollarWorld = {
  vendor: "Hashmi Traders",
  items: [
    { lineNumber: 1, productName: "Disposable Plate", quantity: 2, purchasePrice: 270 },
    { lineNumber: 2, productName: "Disposable Plate", quantity: 1, purchasePrice: 260 },
    { lineNumber: 3, productName: "Disposable Plate", quantity: 1, purchasePrice: 95 },
    { lineNumber: 4, productName: "Disposable Plate", quantity: 6, purchasePrice: 180 },
    { lineNumber: 5, productName: "Tool Kit", quantity: 4, purchasePrice: 240 },
    { lineNumber: 6, productName: "Tool Kit", quantity: 2, purchasePrice: 260 },
    { lineNumber: 7, productName: "Wet Tissue", quantity: 2, purchasePrice: 250 },
    { lineNumber: 8, productName: "Paper Soap", quantity: 24, purchasePrice: 40 },
    { lineNumber: 9, productName: "Nail Card", quantity: 30, purchasePrice: 60 },
    { lineNumber: 10, productName: "Glue", quantity: 3, purchasePrice: 80 },
    { lineNumber: 11, productName: "Candle", quantity: 7, purchasePrice: 95 },
    { lineNumber: 12, productName: "Candle", quantity: 5, purchasePrice: 60 },
    { lineNumber: 13, productName: "Candle", quantity: 3, purchasePrice: 50 },
    { lineNumber: 14, productName: "Diary", quantity: 6, purchasePrice: 270 },
    { lineNumber: 15, productName: "Sticker", quantity: 3, purchasePrice: 60 },
    { lineNumber: 16, productName: "Sticker", quantity: 3, purchasePrice: 50 },
    { lineNumber: 17, productName: "Chatpata Diary", quantity: 24, purchasePrice: 60 },
    { lineNumber: 18, productName: "File Bag", quantity: 12, purchasePrice: 40 },
    { lineNumber: 19, productName: "Zipper", quantity: 6, purchasePrice: 90 },
    { lineNumber: 20, productName: "Cotton Buds 100Pcs", quantity: 20, purchasePrice: 20 },
    { lineNumber: 21, productName: "Cotton Buds 100Pcs", quantity: 6, purchasePrice: 200 },
    { lineNumber: 22, productName: "Cotton Buds 100Pcs", quantity: 6, purchasePrice: 120 },
    { lineNumber: 23, productName: "Cotton Buds 100Pcs", quantity: 6, purchasePrice: 65 },
    { lineNumber: 24, productName: "Toothpick", quantity: 4, purchasePrice: 80 },
    { lineNumber: 25, productName: "Chopstick", quantity: 4, purchasePrice: 60 },
    { lineNumber: 26, productName: "Fan", quantity: 4, purchasePrice: 300 },
    { lineNumber: 27, productName: "Fan", quantity: 4, purchasePrice: 240 },
    { lineNumber: 28, productName: "Nail Card", quantity: 22, purchasePrice: 60 },
    { lineNumber: 29, productName: "Keychain", quantity: 24, purchasePrice: 120 },
    { lineNumber: 30, productName: "Nail Card", quantity: 3, purchasePrice: 100 },
    { lineNumber: 31, productName: "Dustbin Shopper", quantity: 2, purchasePrice: 210 },
    { lineNumber: 32, productName: "Dustbin Shopper", quantity: 4, purchasePrice: 180 },
    { lineNumber: 33, productName: "Iron 1004", quantity: 6, purchasePrice: 180 },
    { lineNumber: 34, productName: "Pouch", quantity: 4, purchasePrice: 350 },
    { lineNumber: 35, productName: "Chit Pad Diary", quantity: 18, purchasePrice: 50 },
    { lineNumber: 36, productName: "Zipper", quantity: 2, purchasePrice: 220 },
    { lineNumber: 37, productName: "Pin", quantity: 3, purchasePrice: 140 },
    { lineNumber: 38, productName: "Pin", quantity: 34, purchasePrice: 90 },
    { lineNumber: 39, productName: "Mop Brush", quantity: 2, purchasePrice: 180 },
    { lineNumber: 40, productName: "Pin", quantity: 3, purchasePrice: 220 },
    { lineNumber: 41, productName: "Bag", quantity: 6, purchasePrice: 70 },
    { lineNumber: 42, productName: "Window Wiper", quantity: 4, purchasePrice: 190 },
    { lineNumber: 43, productName: "Fly Swatter", quantity: 3, purchasePrice: 40 },
    { lineNumber: 44, productName: "Comb", quantity: 3, purchasePrice: 50 },
    { lineNumber: 45, productName: "Comb", quantity: 2, purchasePrice: 30 },
    { lineNumber: 46, productName: "Comb", quantity: 7, purchasePrice: 40 },
    { lineNumber: 47, productName: "Toy", quantity: 6, purchasePrice: 180 },
    { lineNumber: 48, productName: "Pin", quantity: 1, purchasePrice: 2800 },
    { lineNumber: 49, productName: "Bag", quantity: 6, purchasePrice: 150 },
    { lineNumber: 50, productName: "Bag", quantity: 12, purchasePrice: 60 },
    { lineNumber: 51, productName: "Duster", quantity: 6, purchasePrice: 150 },
    { lineNumber: 52, productName: "Duster", quantity: 3, purchasePrice: 240 },
    { lineNumber: 53, productName: "Hanger", quantity: 12, purchasePrice: 70 },
    { lineNumber: 54, productName: "Cleaner", quantity: 3, purchasePrice: 130 },
    { lineNumber: 55, productName: "Sponge", quantity: 5, purchasePrice: 70 },
    { lineNumber: 56, productName: "Gift Box", quantity: 12, purchasePrice: 80 },
    { lineNumber: 57, productName: "Apron", quantity: 6, purchasePrice: 90 },
    { lineNumber: 58, productName: "Comb", quantity: 6, purchasePrice: 120 },
    { lineNumber: 59, productName: "Clothesline Rope", quantity: 4, purchasePrice: 90 },
    { lineNumber: 60, productName: "Clothesline Rope", quantity: 4, purchasePrice: 140 },
    { lineNumber: 61, productName: "Clothespin", quantity: 2, purchasePrice: 230 },
    { lineNumber: 62, productName: "Clothespin", quantity: 4, purchasePrice: 170 },
    { lineNumber: 63, productName: "Clothespin", quantity: 4, purchasePrice: 190 },
    { lineNumber: 64, productName: "Mat", quantity: 9, purchasePrice: 250 },
    { lineNumber: 65, productName: "Mat", quantity: 2, purchasePrice: 200 },
    { lineNumber: 66, productName: "Mat", quantity: 2, purchasePrice: 190 },
  ],
};

let products = [];
for (const batch of [nouman, hashmiOct14, hashmiDollarWorld]) {
  const rows = assignReceiptProductIds(batch.vendor, batch.items, products);
  products = appendProducts(products, rows);
}

writeSheet(PRODUCTS_FILE, products);
console.log(`Wrote ${products.length} rows to ${PRODUCTS_FILE}`);
