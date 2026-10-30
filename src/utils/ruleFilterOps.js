/** Shared Jira-style filter operators / labels for RuleFilterBar. */

export const COMPARE_OPS = [
  { label: "is less than", value: "lt" },
  { label: "is at most", value: "lte" },
  { label: "is", value: "eq" },
  { label: "is at least", value: "gte" },
  { label: "is more than", value: "gt" },
];

export const PRESENCE_OPS = [
  { label: "is set", value: "has" },
  { label: "is empty", value: "missing" },
];

export const CONTAINS_OPS = [{ label: "contains", value: "contains" }];
export const IS_ANY_OPS = [{ label: "is any of", value: "in" }];
export const IS_OPS = [{ label: "is", value: "eq" }];
export const IN_OPS = [{ label: "is in", value: "in" }];
export const FLAG_OPS = [{ label: "is", value: "true" }];

export const OP_LABEL = {
  lt: "is less than",
  lte: "is at most",
  eq: "is",
  gte: "is at least",
  gt: "is more than",
};

export function opLabel(op) {
  return OP_LABEL[op] || op;
}

export function labelForIds(options, ids) {
  const map = new Map((options || []).map((o) => [String(o.value), o.label]));
  return (ids || []).map((id) => map.get(String(id)) || id).join(", ");
}

/** Shared “Created date” field for RuleFilterBar. */
export function createdDateField({
  preset,
  from,
  to,
  dateRangeFilterActive,
  DATE_RANGE_PRESET_OPTIONS,
}) {
  return {
    id: "created",
    label: "Created date",
    valueType: "created",
    occupied: () => dateRangeFilterActive(preset.value, from.value, to.value),
    chipText: () => {
      if (preset.value === "custom") {
        return `Created ${from.value || "…"} → ${to.value || "…"}`;
      }
      const p = DATE_RANGE_PRESET_OPTIONS.find((o) => o.value === preset.value);
      return `Created ${p?.label || preset.value}`;
    },
    getDraft: () => ({
      createdPreset: preset.value,
      createdFrom: from.value,
      createdTo: to.value,
    }),
    apply: (d) => {
      if (!dateRangeFilterActive(d.createdPreset, d.createdFrom, d.createdTo)) return false;
      preset.value = d.createdPreset;
      from.value = d.createdFrom;
      to.value = d.createdTo;
    },
    clear: () => {
      preset.value = "all";
      from.value = null;
      to.value = null;
    },
  };
}
