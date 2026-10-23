import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";
import { computeScheduledDiscountPkr, moneyClose } from "../utils/scheduledDiscount.js";
import { defaultPosSaleUnit, resolveSaleUnit, unitLabel } from "../utils/saleUnits.js";

const CART_STORAGE_KEY = "dw_pos_cart_v1";

function newLineId() {
  return crypto.randomUUID();
}

function loadPersistedCarts() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.carts)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedCarts(carts, activeCartId, cartSeq) {
  try {
    localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ carts, activeCartId, cartSeq, savedAt: Date.now() })
    );
  } catch {
    /* quota */
  }
}

function makeCart(label) {
  return {
    id: newLineId(),
    label,
    status: "active",
    items: [],
    discount: 0,
    scheduledDiscountId: null,
    scheduledAutoAmount: null,
    scheduledDiscountDismissed: false,
  };
}

function productSnapshot(product) {
  return {
    name: product.name,
    barcode: product.barcode,
    sku: product.sku,
    current_stock: product.current_stock,
    selling_price: product.selling_price,
    pieces_per_pack: product.pieces_per_pack,
    pieces_per_box: product.pieces_per_box,
    piece_selling_price: product.piece_selling_price,
    pack_selling_price: product.pack_selling_price,
    box_selling_price: product.box_selling_price,
    default_sale_unit: product.default_sale_unit,
  };
}

function linePieces(line) {
  return Math.max(1, Math.floor(Number(line.quantity) || 0)) * Math.max(1, Math.floor(Number(line.pieces_per_unit) || 1));
}

export const usePosCartStore = defineStore("posCart", () => {
  const carts = ref([]);
  const activeCartId = ref(null);
  let cartSeq = 1;

  const activeCart = computed(() => carts.value.find((c) => c.id === activeCartId.value) ?? null);

  const items = computed(() => activeCart.value?.items ?? []);

  const subtotal = computed(() =>
    items.value.reduce((s, line) => s + Number(line.line_total || 0), 0)
  );

  const heldCarts = computed(() => carts.value.filter((c) => c.status === "on_hold"));
  const openCarts = computed(() => carts.value.filter((c) => c.status === "active"));

  /** Pieces reserved in all open local tabs (active + on hold). */
  const reservedPiecesByProductId = computed(() => {
    const map = {};
    for (const cart of carts.value) {
      for (const line of cart.items) {
        map[line.product_id] = (map[line.product_id] || 0) + linePieces(line);
      }
    }
    return map;
  });

  /** @deprecated use reservedPiecesByProductId — kept as alias for any old refs */
  const reservedByProductId = reservedPiecesByProductId;

  function availablePiecesToAdd(productId, catalogStock) {
    const reserved = reservedPiecesByProductId.value[productId] || 0;
    return Math.max(0, Math.floor(Number(catalogStock) || 0) - reserved);
  }

  function availableToAdd(productId, catalogStock, piecesPerUnit = 1) {
    const pcs = Math.max(1, Math.floor(Number(piecesPerUnit) || 1));
    return Math.floor(availablePiecesToAdd(productId, catalogStock) / pcs);
  }

  function maxQtyForLine(line, catalogStock) {
    const reserved = reservedPiecesByProductId.value[line.product_id] || 0;
    const stock = Math.floor(Number(catalogStock) || 0);
    const freePieces = stock - reserved + linePieces(line);
    const ppu = Math.max(1, Math.floor(Number(line.pieces_per_unit) || 1));
    return Math.max(0, Math.floor(freePieces / ppu));
  }

  function syncLineStockFromCatalog(findProduct) {
    if (typeof findProduct !== "function") return;
    for (const cart of carts.value) {
      for (const line of cart.items) {
        const fresh = findProduct(line.product_id);
        if (fresh) line.products = productSnapshot(fresh);
      }
    }
  }

  function ensureActiveCart() {
    if (activeCart.value) return activeCart.value;
    const cart = makeCart(`Sale ${cartSeq++}`);
    carts.value.push(cart);
    activeCartId.value = cart.id;
    return cart;
  }

  /** Line whose qty input should receive focus after a scan add */
  const focusQtyLineId = ref(null);

  /**
   * @param {object} product
   * @param {number} [addQty]
   * @param {string} [saleUnit] piece|pack|box — defaults to pack when pack size > 1
   */
  function addProduct(product, addQty = 1, saleUnit = null) {
    const cart = ensureActiveCart();
    const delta = Math.max(1, Math.floor(Number(addQty) || 1));
    const resolved = resolveSaleUnit(product, saleUnit ?? defaultPosSaleUnit(product));
    const stock = Math.floor(Number(product.current_stock) || 0);
    const existing = cart.items.find(
      (l) => l.product_id === product.id && l.sale_unit === resolved.sale_unit
    );
    if (existing) {
      const max = maxQtyForLine(existing, stock);
      if (existing.quantity + delta > max) {
        throw new Error(
          max <= 0
            ? "Out of stock for this tab"
            : `Only ${max} ${unitLabel(existing.sale_unit).toLowerCase()}(s) available (${stock} pcs in store)`
        );
      }
      existing.quantity += delta;
      existing.line_total = existing.quantity * existing.unit_selling_price;
      existing.products = productSnapshot(product);
      focusQtyLineId.value = existing.lineId;
      return existing;
    }
    const avail = availableToAdd(product.id, stock, resolved.pieces_per_unit);
    if (avail < delta) {
      throw new Error(
        avail <= 0
          ? "Out of stock for this tab"
          : `Only ${avail} ${unitLabel(resolved.sale_unit).toLowerCase()}(s) available (${stock} pcs in store)`
      );
    }
    const line = {
      lineId: newLineId(),
      product_id: product.id,
      quantity: delta,
      sale_unit: resolved.sale_unit,
      pieces_per_unit: resolved.pieces_per_unit,
      unit_selling_price: resolved.unit_selling_price,
      line_total: resolved.unit_selling_price * delta,
      products: productSnapshot(product),
    };
    cart.items.push(line);
    focusQtyLineId.value = line.lineId;
    return line;
  }

  function setLineSaleUnit(lineId, saleUnit) {
    const cart = activeCart.value;
    if (!cart) return;
    const line = cart.items.find((l) => l.lineId === lineId);
    if (!line) return;
    if (line.sale_unit === saleUnit) return;

    const product = {
      ...(line.products || {}),
      id: line.product_id,
      current_stock: line.products?.current_stock,
    };
    const resolved = resolveSaleUnit(product, saleUnit);
    const stock = Math.floor(Number(product.current_stock) || 0);
    const qtyToKeep = line.quantity;

    const otherSame = cart.items.find(
      (l) =>
        l.lineId !== lineId &&
        l.product_id === line.product_id &&
        l.sale_unit === resolved.sale_unit
    );

    if (otherSame) {
      removeLine(lineId);
      const max = maxQtyForLine(otherSame, stock);
      const next = Math.min(otherSame.quantity + qtyToKeep, max);
      if (next < otherSame.quantity + qtyToKeep) {
        otherSame.quantity = Math.max(otherSame.quantity, next);
        otherSame.line_total = otherSame.quantity * otherSame.unit_selling_price;
        throw new Error(
          `Merged what stock allows — only ${otherSame.quantity} ${unitLabel(resolved.sale_unit).toLowerCase()}(s) on that line`
        );
      }
      otherSame.quantity = next;
      otherSame.line_total = next * otherSame.unit_selling_price;
      return;
    }

    line.sale_unit = resolved.sale_unit;
    line.pieces_per_unit = resolved.pieces_per_unit;
    line.unit_selling_price = resolved.unit_selling_price;
    const max = maxQtyForLine(line, stock);
    if (line.quantity > max) {
      if (max < 1) throw new Error("Not enough stock for this unit");
      line.quantity = max;
    }
    line.line_total = line.quantity * line.unit_selling_price;
  }

  function clearFocusQtyLine() {
    focusQtyLineId.value = null;
  }

  function setLineQty(lineId, qty) {
    const cart = activeCart.value;
    if (!cart) return;
    const line = cart.items.find((l) => l.lineId === lineId);
    if (!line) return;
    const next = Math.floor(Number(qty) || 1);
    if (next < 1) {
      removeLine(lineId);
      return;
    }
    const stock = line.products?.current_stock ?? 0;
    const max = maxQtyForLine(line, stock);
    if (next > max) {
      throw new Error(
        max <= 0
          ? "Out of stock for this tab"
          : `Only ${max} ${unitLabel(line.sale_unit).toLowerCase()}(s) available for this line`
      );
    }
    line.quantity = next;
    line.line_total = next * Number(line.unit_selling_price);
  }

  function removeLine(lineId) {
    const cart = activeCart.value;
    if (!cart) return;
    cart.items = cart.items.filter((l) => l.lineId !== lineId);
  }

  function setDiscount(amount) {
    const cart = ensureActiveCart();
    const d = Math.max(0, Number(amount) || 0);
    cart.discount = d;
    if (cart.scheduledDiscountId) {
      const autoAmt = Number(cart.scheduledAutoAmount);
      if (d === 0) {
        cart.scheduledDiscountDismissed = true;
        cart.scheduledDiscountId = null;
        cart.scheduledAutoAmount = null;
      } else if (Number.isFinite(autoAmt) && !moneyClose(d, autoAmt)) {
        cart.scheduledDiscountDismissed = true;
        cart.scheduledDiscountId = null;
        cart.scheduledAutoAmount = null;
      }
    }
  }

  /**
   * Apply active date-range promo to the current tab unless cashier removed it.
   * @param {object|null} promo
   * @param {number|Array} [subtotalOrItems] prefer cart items so price/specific scopes work
   */
  function syncScheduledDiscount(promo, subtotalOrItems = 0) {
    const cart = activeCart.value;
    if (!cart || cart.scheduledDiscountDismissed) return;

    if (!promo) {
      if (cart.scheduledDiscountId) {
        cart.discount = 0;
        cart.scheduledDiscountId = null;
        cart.scheduledAutoAmount = null;
      }
      return;
    }

    const base = Array.isArray(subtotalOrItems) ? subtotalOrItems : cart.items;
    const amt = computeScheduledDiscountPkr(promo, base);
    const samePromo = cart.scheduledDiscountId === promo.id;
    if (samePromo && moneyClose(cart.discount, amt)) return;

    const onAuto =
      cart.scheduledDiscountId != null && moneyClose(cart.scheduledAutoAmount, cart.discount);

    if (cart.discount === 0 || onAuto || samePromo) {
      cart.scheduledDiscountId = promo.id;
      cart.scheduledAutoAmount = amt;
      cart.discount = amt;
    }
  }

  function dismissScheduledDiscount() {
    const cart = activeCart.value;
    if (!cart) return;
    cart.scheduledDiscountDismissed = true;
    cart.scheduledDiscountId = null;
    cart.scheduledAutoAmount = null;
    cart.discount = 0;
  }

  function newSaleTab() {
    const cart = makeCart(`Sale ${cartSeq++}`);
    carts.value.push(cart);
    activeCartId.value = cart.id;
  }

  function selectCart(cartId) {
    const cart = carts.value.find((c) => c.id === cartId);
    if (!cart) return;
    if (cart.status === "on_hold") cart.status = "active";
    activeCartId.value = cartId;
  }

  function selectAdjacentCart(delta) {
    if (!carts.value.length) return;
    const ids = carts.value.map((c) => c.id);
    const idx = ids.indexOf(activeCartId.value);
    const start = idx >= 0 ? idx : 0;
    const next = (start + delta + ids.length) % ids.length;
    selectCart(ids[next]);
  }

  function holdActiveCart() {
    const cart = activeCart.value;
    if (!cart || !cart.items.length) return false;
    cart.status = "on_hold";
    cart.label = cart.label.includes("hold") ? cart.label : `${cart.label} (hold)`;
    activeCartId.value = null;
    newSaleTab();
    return true;
  }

  function clearActiveCart() {
    const cart = activeCart.value;
    if (!cart) return;
    cart.items = [];
    cart.discount = 0;
    cart.scheduledDiscountId = null;
    cart.scheduledAutoAmount = null;
    cart.scheduledDiscountDismissed = false;
  }

  function removeCart(cartId) {
    carts.value = carts.value.filter((c) => c.id !== cartId);
    if (activeCartId.value === cartId) {
      activeCartId.value = openCarts.value[0]?.id ?? heldCarts.value[0]?.id ?? null;
      if (!activeCartId.value && carts.value.length === 0) ensureActiveCart();
      else if (!activeCartId.value) newSaleTab();
    }
  }

  let persistWatchAttached = false;

  function attachPersist() {
    if (persistWatchAttached) return;
    persistWatchAttached = true;
    watch(
      [carts, activeCartId],
      () => {
        savePersistedCarts(carts.value, activeCartId.value, cartSeq);
      },
      { deep: true }
    );
  }

  function init() {
    if (!carts.value.length) {
      const saved = loadPersistedCarts();
      if (saved?.carts?.length) {
        carts.value = saved.carts;
        activeCartId.value = saved.activeCartId || saved.carts[0]?.id || null;
        const labels = saved.carts.map((c) => {
          const m = String(c.label || "").match(/Sale\s+(\d+)/i);
          return m ? Number(m[1]) : 0;
        });
        cartSeq = Math.max(saved.cartSeq || 1, ...labels, 0) + 1;
      } else {
        ensureActiveCart();
      }
    }
    if (!activeCart.value) ensureActiveCart();
    attachPersist();
  }

  function afterCompletedSale() {
    const id = activeCartId.value;
    if (id) removeCart(id);
    else ensureActiveCart();
  }

  function linesForCheckout() {
    return items.value.map((l) => ({
      product_id: l.product_id,
      quantity: l.quantity,
      unit_selling_price: Number(l.unit_selling_price),
      sale_unit: l.sale_unit || "piece",
      pieces_per_unit: Math.max(1, Math.floor(Number(l.pieces_per_unit) || 1)),
    }));
  }

  return {
    carts,
    activeCartId,
    activeCart,
    items,
    subtotal,
    heldCarts,
    openCarts,
    reservedByProductId,
    reservedPiecesByProductId,
    availableToAdd,
    availablePiecesToAdd,
    maxQtyForLine,
    syncLineStockFromCatalog,
    focusQtyLineId,
    ensureActiveCart,
    addProduct,
    setLineSaleUnit,
    clearFocusQtyLine,
    setLineQty,
    removeLine,
    setDiscount,
    syncScheduledDiscount,
    dismissScheduledDiscount,
    newSaleTab,
    selectCart,
    selectAdjacentCart,
    holdActiveCart,
    clearActiveCart,
    removeCart,
    init,
    afterCompletedSale,
    linesForCheckout,
  };
});
