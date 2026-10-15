import { defineStore } from "pinia";
import { ref, computed } from "vue";

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

  function ensureActiveCart() {
    if (activeCart.value) return activeCart.value;
    const cart = makeCart(`Sale ${cartSeq++}`);
    carts.value.push(cart);
    activeCartId.value = cart.id;
    return cart;
  }

  function addProduct(product, addQty = 1) {
    const cart = ensureActiveCart();
    const delta = Math.max(1, Math.floor(Number(addQty) || 1));
    const price = Number(product.selling_price) || 0;
    const existing = cart.items.find((l) => l.product_id === product.id);
    if (existing) {
      existing.quantity += delta;
      existing.line_total = existing.quantity * existing.unit_selling_price;
      existing.products = productSnapshot(product);
    } else {
      cart.items.push({
        lineId: newLineId(),
        product_id: product.id,
        quantity: delta,
        unit_selling_price: price,
        line_total: price * delta,
        products: productSnapshot(product),
      });
    }
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
    cart.discount = Math.max(0, Number(amount) || 0);
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
    ensureActiveCart,
    addProduct,
    setLineQty,
    removeLine,
    setDiscount,
    newSaleTab,
    selectCart,
    holdActiveCart,
    clearActiveCart,
    removeCart,
    init,
    afterCompletedSale,
    linesForCheckout,
  };
});
