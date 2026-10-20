import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { computeScheduledDiscountPkr, moneyClose } from "../utils/scheduledDiscount.js";

function newLineId() {
  return crypto.randomUUID();
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
  };
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

  /** Qty reserved in all open local tabs (active + on hold), until sale completes or tab cleared. */
  const reservedByProductId = computed(() => {
    const map = {};
    for (const cart of carts.value) {
      for (const line of cart.items) {
        map[line.product_id] = (map[line.product_id] || 0) + line.quantity;
      }
    }
    return map;
  });

  function availableToAdd(productId, catalogStock) {
    const reserved = reservedByProductId.value[productId] || 0;
    return Math.max(0, Math.floor(Number(catalogStock) || 0) - reserved);
  }

  function maxQtyForLine(line, catalogStock) {
    const reserved = reservedByProductId.value[line.product_id] || 0;
    const stock = Math.floor(Number(catalogStock) || 0);
    return Math.max(0, stock - reserved + line.quantity);
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

  function addProduct(product, addQty = 1) {
    const cart = ensureActiveCart();
    const delta = Math.max(1, Math.floor(Number(addQty) || 1));
    const price = Number(product.selling_price) || 0;
    const stock = Math.floor(Number(product.current_stock) || 0);
    const existing = cart.items.find((l) => l.product_id === product.id);
    if (existing) {
      const max = maxQtyForLine(existing, stock);
      if (existing.quantity + delta > max) {
        throw new Error(max <= 0 ? "Out of stock for this tab" : `Only ${max} available (${stock} in store, others in tabs)`);
      }
      existing.quantity += delta;
      existing.line_total = existing.quantity * existing.unit_selling_price;
      existing.products = productSnapshot(product);
      focusQtyLineId.value = existing.lineId;
      return existing;
    }
    const avail = availableToAdd(product.id, stock);
    if (avail < delta) {
      throw new Error(avail <= 0 ? "Out of stock for this tab" : `Only ${avail} available (${stock} in store, others in tabs)`);
    }
    const line = {
      lineId: newLineId(),
      product_id: product.id,
      quantity: delta,
      unit_selling_price: price,
      line_total: price * delta,
      products: productSnapshot(product),
    };
    cart.items.push(line);
    focusQtyLineId.value = line.lineId;
    return line;
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
      throw new Error(max <= 0 ? "Out of stock for this tab" : `Only ${max} available for this line`);
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

  function init() {
    if (!carts.value.length) ensureActiveCart();
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
    availableToAdd,
    maxQtyForLine,
    syncLineStockFromCatalog,
    focusQtyLineId,
    ensureActiveCart,
    addProduct,
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
