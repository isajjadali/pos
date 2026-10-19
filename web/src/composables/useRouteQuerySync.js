import { watch, nextTick, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";

function queryValueEqual(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  return String(a) === String(b);
}

/**
 * Keep list filters / pagination in the URL query string (survives refresh & shareable links).
 *
 * @param {Record<string, {
 *   ref: import('vue').Ref,
 *   default?: unknown,
 *   parse?: (raw: string) => unknown,
 *   serialize?: (value: unknown) => string | undefined | null,
 *   debounceMs?: number,
 * }>} fields
 * @param {{ onApplied?: () => void }} [options] — after URL → state sync (e.g. browser back)
 * @returns {{ routeSyncing: import('vue').Ref<boolean> }}
 */
export function useRouteQuerySync(fields, options = {}) {
  const route = useRoute();
  const router = useRouter();
  const routeSyncing = ref(false);
  const debounceTimers = {};
  let syncingToRoute = false;
  let writesEnabled = false;

  onMounted(() => {
    writesEnabled = true;
    pushQueryToRoute();
  });

  function parseField(key, raw) {
    const spec = fields[key];
    if (raw == null || raw === "") return spec.default;
    if (spec.parse) return spec.parse(String(raw));
    return String(raw);
  }

  function serializeField(key, value) {
    const spec = fields[key];
    if (spec.serialize) {
      const out = spec.serialize(value);
      if (out == null || out === "") return undefined;
      return String(out);
    }
    const def = spec.default;
    if (value === def || value == null || value === "") return undefined;
    return String(value);
  }

  function refsMatchQuery(query) {
    for (const key of Object.keys(fields)) {
      const parsed = parseField(key, query[key]);
      const current = fields[key].ref.value;
      if (!queryValueEqual(parsed, current)) return false;
    }
    return true;
  }

  function applyQueryToRefs(query) {
    routeSyncing.value = true;
    for (const key of Object.keys(fields)) {
      fields[key].ref.value = parseField(key, query[key]);
    }
    nextTick(() => {
      routeSyncing.value = false;
      options.onApplied?.();
    });
  }

  function buildQuery() {
    const out = {};
    for (const [k, v] of Object.entries(route.query)) {
      if (!(k in fields)) out[k] = v;
    }
    for (const key of Object.keys(fields)) {
      const serialized = serializeField(key, fields[key].ref.value);
      if (serialized !== undefined) out[key] = serialized;
    }
    return out;
  }

  function queriesShallowEqual(a, b) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const va = a[k];
      const vb = b[k];
      if (Array.isArray(va) || Array.isArray(vb)) {
        if (String(va) !== String(vb)) return false;
      } else if (!queryValueEqual(va, vb)) return false;
    }
    return true;
  }

  function pushQueryToRoute() {
    if (!writesEnabled || routeSyncing.value || syncingToRoute) return;
    const next = buildQuery();
    if (queriesShallowEqual(route.query, next)) return;
    syncingToRoute = true;
    router.replace({ query: next }).finally(() => {
      syncingToRoute = false;
    });
  }

  applyQueryToRefs(route.query);

  for (const [key, spec] of Object.entries(fields)) {
    const run = () => {
      if (spec.debounceMs) {
        clearTimeout(debounceTimers[key]);
        debounceTimers[key] = setTimeout(pushQueryToRoute, spec.debounceMs);
      } else {
        pushQueryToRoute();
      }
    };
    watch(spec.ref, run, { deep: true });
  }

  watch(
    () => route.query,
    (q) => {
      if (syncingToRoute) return;
      if (refsMatchQuery(q)) return;
      applyQueryToRefs(q);
    }
  );

  return { routeSyncing };
}

export const routeQuery = {
  string(ref, defaultValue = "") {
    return {
      ref,
      default: defaultValue,
      parse: (s) => s,
      serialize: (v) => (v ? String(v) : undefined),
    };
  },
  optionalString(ref) {
    return {
      ref,
      default: null,
      parse: (s) => s || null,
      serialize: (v) => (v ? String(v) : undefined),
    };
  },
  positiveInt(ref, defaultValue) {
    return {
      ref,
      default: defaultValue,
      parse: (s) => {
        const n = parseInt(s, 10);
        return Number.isFinite(n) && n > 0 ? n : defaultValue;
      },
      serialize: (v) => {
        const n = Math.floor(Number(v));
        if (!Number.isFinite(n) || n <= 0 || n === defaultValue) return undefined;
        return String(n);
      },
    };
  },
  booleanFlag(ref, defaultValue = false) {
    return {
      ref,
      default: defaultValue,
      parse: (s) => s === "1" || s === "true",
      serialize: (v) => {
        const on = Boolean(v);
        if (on === defaultValue) return undefined;
        return on ? "1" : "0";
      },
    };
  },
  enumValue(ref, defaultValue, allowed) {
    const set = new Set(allowed);
    return {
      ref,
      default: defaultValue,
      parse: (s) => (set.has(s) ? s : defaultValue),
      serialize: (v) => (v === defaultValue || v == null ? undefined : String(v)),
    };
  },
};
