<script setup>
import { ref, onMounted, onUnmounted, computed, h, watch } from "vue";
import { useRouter } from "vue-router";
import {
  NBadge,
  NButton,
  NDropdown,
  NText,
  NIcon,
  useMessage,
} from "naive-ui";
import { NotificationsOutline } from "@vicons/ionicons5";
import { supabase, supabaseConfigured } from "../lib/supabase.js";
import {
  listShopifyOrderEvents,
  countUnreadShopifyOrderEvents,
  markShopifyOrderEventsRead,
  markAllShopifyOrderEventsRead,
  shopifyOrdersPollSync,
} from "../services/shopify.js";
import { formatPkr } from "../utils/format.js";
import { useAuthStore } from "../stores/auth.js";

const router = useRouter();
const message = useMessage();
const auth = useAuthStore();

const unread = ref(0);
const recent = ref([]);
const open = ref(false);
let channel = null;
let audioCtx = null;
let pollTimer = null;
/** @type {Set<string>} */
const seenIds = new Set();
let primed = false;

const show = computed(() => supabaseConfigured && auth.isAdmin);

function playChime() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    const ctx = audioCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.stop(ctx.currentTime + 0.4);
  } catch {
    /* ignore */
  }
}

function notifyNewOrder(row) {
  if (!row?.id || row.read_at) return;
  if (seenIds.has(row.id)) return;
  seenIds.add(row.id);

  playChime();
  const title = `Shopify ${row.order_name || "order"}`;
  const body = `${row.customer_name || "Customer"}${
    row.total_amount != null ? ` · ${formatPkr(row.total_amount)}` : ""
  }`;
  // In-app only (desktop OS toasts disabled for now)
  message.info(`${title} — ${body}`, { duration: 6000 });
}

async function refresh({ announceNew = false, pollShopify = false } = {}) {
  if (!show.value) return;
  try {
    // Webhooks often don't arrive — poll Shopify Admin API while POS is open
    if (pollShopify) {
      try {
        await shopifyOrdersPollSync();
      } catch {
        /* scopes / network — local refresh still runs */
      }
    }
    unread.value = await countUnreadShopifyOrderEvents();
    const rows = await listShopifyOrderEvents({ limit: 12 });
    recent.value = rows;
    if (!primed) {
      for (const r of rows) seenIds.add(r.id);
      primed = true;
      return;
    }
    if (announceNew) {
      for (const r of [...rows].reverse()) {
        if (!r.read_at) notifyNewOrder(r);
        else seenIds.add(r.id);
      }
    }
  } catch {
    /* ignore when table missing until migration */
  }
}

function onRealtime(payload) {
  const row = payload.new;
  if (!row) return;
  recent.value = [row, ...recent.value.filter((r) => r.id !== row.id)].slice(0, 12);
  if (!row.read_at) {
    unread.value += 1;
    notifyNewOrder(row);
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") {
    refresh({ announceNew: true, pollShopify: true });
  }
}

onMounted(async () => {
  if (!show.value || !supabase) return;
  await refresh({ announceNew: false, pollShopify: true });
  document.addEventListener("visibilitychange", onVisibility);
  channel = supabase
    .channel("shopify-order-events")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "shopify_order_events" },
      onRealtime
    )
    .subscribe();

  // Poll Shopify every 15s while POS is open (reliable vs flaky webhooks)
  pollTimer = window.setInterval(
    () => refresh({ announceNew: true, pollShopify: true }),
    15000
  );
});

onUnmounted(() => {
  document.removeEventListener("visibilitychange", onVisibility);
  if (pollTimer) window.clearInterval(pollTimer);
  if (channel && supabase) {
    supabase.removeChannel(channel);
    channel = null;
  }
});

watch(
  () => auth.isAdmin,
  (v) => {
    if (v && supabaseConfigured) refresh({ announceNew: false });
  }
);

const options = computed(() => {
  const items = recent.value.map((r) => ({
    label: () =>
      h("div", { style: "max-width: 260px; line-height: 1.3" }, [
        h("div", { style: "font-weight: 600" }, r.order_name || "Order"),
        h(
          NText,
          { depth: 3, style: "font-size: 12px" },
          () =>
            `${r.customer_name || "Customer"} · ${r.total_amount != null ? formatPkr(r.total_amount) : ""}`
        ),
      ]),
    key: r.id,
  }));
  if (!items.length) {
    items.push({ label: "No recent orders", key: "empty", disabled: true });
  }
  items.push({ type: "divider", key: "d1" });
  items.push({ label: "View all Shopify orders", key: "all" });
  if (unread.value > 0) {
    items.push({ label: "Mark all read", key: "mark" });
  }
  return items;
});

async function onSelect(key) {
  if (key === "empty") return;
  if (key === "all") {
    open.value = false;
    router.push({ name: "shopify-orders" });
    return;
  }
  if (key === "mark") {
    await markAllShopifyOrderEventsRead();
    unread.value = 0;
    await refresh({ announceNew: false });
    return;
  }
  const row = recent.value.find((r) => r.id === key);
  if (row && !row.read_at) {
    await markShopifyOrderEventsRead([row.id]);
    unread.value = Math.max(0, unread.value - 1);
    row.read_at = new Date().toISOString();
  }
  open.value = false;
  router.push({ name: "shopify-orders" });
}
</script>

<template>
  <NDropdown
    v-if="show"
    trigger="click"
    :options="options"
    :show="open"
    @update:show="(v) => (open = v)"
    @select="onSelect"
  >
    <NBadge :value="unread" :max="99" :show="unread > 0">
      <NButton quaternary circle aria-label="Shopify order notifications">
        <template #icon>
          <NIcon :component="NotificationsOutline" />
        </template>
      </NButton>
    </NBadge>
  </NDropdown>
</template>
