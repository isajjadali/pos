<script setup>
import { computed } from "vue";
import RuleFilterBar from "./RuleFilterBar.vue";
import { DATE_RANGE_PRESET_OPTIONS, dateRangeFilterActive } from "../utils/dateRange.js";
import { DEFAULT_KEYWORD_FIELDS } from "../utils/productAdvancedFilters.js";
import {
  COMPARE_OPS,
  createdDateField,
  labelForIds,
  opLabel,
} from "../utils/ruleFilterOps.js";

const props = defineProps({
  canSeeCost: { type: Boolean, default: false },
  tagsReady: { type: Boolean, default: false },
  categoryOptions: { type: Array, default: () => [] },
  tagOptions: { type: Array, default: () => [] },
  unitOptions: { type: Array, default: () => [] },
});

const categoryFilter = defineModel("categoryFilter", { type: Array, default: () => [] });
const tagFilter = defineModel("tagFilter", { type: Array, default: () => [] });
const unitFilter = defineModel("unitFilter", { type: String, default: "all" });
const createdRangePreset = defineModel("createdRangePreset", { type: String, default: "all" });
const createdFrom = defineModel("createdFrom", { type: [String, null], default: null });
const createdTo = defineModel("createdTo", { type: [String, null], default: null });
const lowStockOnly = defineModel("lowStockOnly", { type: Boolean, default: false });
const activeOnly = defineModel("activeOnly", { type: Boolean, default: true });
const stockFilterEnabled = defineModel("stockFilterEnabled", { type: Boolean, default: false });
const stockOp = defineModel("stockOp", { type: String, default: "lte" });
const stockQty = defineModel("stockQty", { type: Number, default: 10 });
const priceFilterEnabled = defineModel("priceFilterEnabled", { type: Boolean, default: false });
const priceOp = defineModel("priceOp", { type: String, default: "gte" });
const priceQty = defineModel("priceQty", { type: Number, default: 0 });
const costFilterEnabled = defineModel("costFilterEnabled", { type: Boolean, default: false });
const costOp = defineModel("costOp", { type: String, default: "gt" });
const costQty = defineModel("costQty", { type: Number, default: 0 });
const keywordContains = defineModel("keywordContains", { type: String, default: "" });
const keywordFields = defineModel("keywordFields", {
  type: Array,
  default: () => [...DEFAULT_KEYWORD_FIELDS],
});
const vendorPresence = defineModel("vendorPresence", { type: String, default: "all" });
const barcodePresence = defineModel("barcodePresence", { type: String, default: "all" });
const vendorCatalogKeyword = defineModel("vendorCatalogKeyword", { type: String, default: "" });
const vendorCountEnabled = defineModel("vendorCountEnabled", { type: Boolean, default: false });
const vendorCountOp = defineModel("vendorCountOp", { type: String, default: "lt" });
const vendorCountN = defineModel("vendorCountN", { type: Number, default: 5 });

const fields = computed(() => {
  const list = [
    {
      id: "stock",
      label: "Stock",
      hint: "On-hand quantity",
      valueType: "number",
      ops: COMPARE_OPS,
      defaultNumber: 10,
      occupied: () => stockFilterEnabled.value,
      chipText: () => `Stock ${opLabel(stockOp.value)} ${stockQty.value ?? ""}`,
      getDraft: () => ({ op: stockOp.value, number: stockQty.value }),
      apply: (d) => {
        stockOp.value = d.op;
        stockQty.value = Number(d.number) || 0;
        stockFilterEnabled.value = true;
      },
      clear: () => {
        stockFilterEnabled.value = false;
      },
    },
    {
      id: "price",
      label: "Selling price",
      valueType: "number",
      ops: COMPARE_OPS,
      precision: 2,
      defaultNumber: 0,
      occupied: () => priceFilterEnabled.value,
      chipText: () => `Selling price ${opLabel(priceOp.value)} ${priceQty.value ?? ""}`,
      getDraft: () => ({ op: priceOp.value, number: priceQty.value }),
      apply: (d) => {
        priceOp.value = d.op;
        priceQty.value = Number(d.number) || 0;
        priceFilterEnabled.value = true;
      },
      clear: () => {
        priceFilterEnabled.value = false;
      },
    },
  ];

  if (props.canSeeCost) {
    list.push({
      id: "cost",
      label: "Purchase",
      hint: "Same as Purchase column (avg cost / piece)",
      valueType: "number",
      ops: COMPARE_OPS,
      precision: 2,
      defaultNumber: 0,
      occupied: () => costFilterEnabled.value,
      chipText: () => `Purchase ${opLabel(costOp.value)} ${costQty.value ?? ""}`,
      getDraft: () => ({ op: costOp.value, number: costQty.value }),
      apply: (d) => {
        costOp.value = d.op;
        costQty.value = Number(d.number) || 0;
        costFilterEnabled.value = true;
      },
      clear: () => {
        costFilterEnabled.value = false;
      },
    });
  }

  list.push(
    {
      id: "keyword",
      label: "Name / SKU / barcode",
      valueType: "text",
      occupied: () => Boolean(keywordContains.value.trim()),
      chipText: () => `Name / SKU / barcode contains “${keywordContains.value.trim()}”`,
      getDraft: () => ({ text: keywordContains.value }),
      apply: (d) => {
        const t = String(d.text || "").trim();
        if (!t) return false;
        keywordContains.value = t;
        keywordFields.value = [...DEFAULT_KEYWORD_FIELDS];
      },
      clear: () => {
        keywordContains.value = "";
        keywordFields.value = [...DEFAULT_KEYWORD_FIELDS];
      },
    },
    {
      id: "category",
      label: "Category",
      valueType: "multi",
      options: () => props.categoryOptions,
      occupied: () => (categoryFilter.value?.length ?? 0) > 0,
      chipText: () =>
        `Category is any of ${labelForIds(props.categoryOptions, categoryFilter.value)}`,
      getDraft: () => ({ multi: [...(categoryFilter.value || [])] }),
      apply: (d) => {
        if (!(d.multi?.length > 0)) return false;
        categoryFilter.value = [...d.multi];
      },
      clear: () => {
        categoryFilter.value = [];
      },
    }
  );

  if (props.tagsReady) {
    list.push({
      id: "tag",
      label: "Tag",
      valueType: "multi",
      options: () => props.tagOptions,
      occupied: () => (tagFilter.value?.length ?? 0) > 0,
      chipText: () => `Tag is any of ${labelForIds(props.tagOptions, tagFilter.value)}`,
      getDraft: () => ({ multi: [...(tagFilter.value || [])] }),
      apply: (d) => {
        if (!(d.multi?.length > 0)) return false;
        tagFilter.value = [...d.multi];
      },
      clear: () => {
        tagFilter.value = [];
      },
    });
  }

  list.push(
    {
      id: "unit",
      label: "Unit type",
      valueType: "select",
      options: () => (props.unitOptions || []).filter((o) => o.value !== "all"),
      occupied: () => unitFilter.value !== "all",
      chipText: () => {
        const u = (props.unitOptions || []).find((o) => o.value === unitFilter.value);
        return `Unit type is ${u?.label || unitFilter.value}`;
      },
      getDraft: () => ({ select: unitFilter.value }),
      apply: (d) => {
        if (!d.select) return false;
        unitFilter.value = d.select;
      },
      clear: () => {
        unitFilter.value = "all";
      },
    },
    createdDateField({
      preset: createdRangePreset,
      from: createdFrom,
      to: createdTo,
      dateRangeFilterActive,
      DATE_RANGE_PRESET_OPTIONS,
    }),
    {
      id: "vendorPresence",
      label: "Vendor",
      hint: "Whether the product has a vendor",
      valueType: "presence",
      occupied: () => vendorPresence.value !== "all",
      chipText: () =>
        vendorPresence.value === "missing" ? "Vendor is empty" : "Vendor is set",
      getDraft: () => ({ op: vendorPresence.value === "missing" ? "missing" : "has" }),
      apply: (d) => {
        vendorPresence.value = d.op === "missing" ? "missing" : "has";
      },
      clear: () => {
        vendorPresence.value = "all";
      },
    },
    {
      id: "barcodePresence",
      label: "Barcode",
      hint: "Whether barcode is filled",
      valueType: "presence",
      occupied: () => barcodePresence.value !== "all",
      chipText: () =>
        barcodePresence.value === "missing" ? "Barcode is empty" : "Barcode is set",
      getDraft: () => ({ op: barcodePresence.value === "missing" ? "missing" : "has" }),
      apply: (d) => {
        barcodePresence.value = d.op === "missing" ? "missing" : "has";
      },
      clear: () => {
        barcodePresence.value = "all";
      },
    },
    {
      id: "lowStock",
      label: "Low stock",
      hint: "At or below threshold",
      valueType: "flag",
      occupied: () => lowStockOnly.value,
      chipText: () => "Low stock is true",
      getDraft: () => ({}),
      apply: () => {
        lowStockOnly.value = true;
      },
      clear: () => {
        lowStockOnly.value = false;
      },
    },
    {
      id: "includeInactive",
      label: "Inactive products",
      hint: "Include deactivated items",
      valueType: "flag",
      occupied: () => !activeOnly.value,
      chipText: () => "Inactive products is true",
      getDraft: () => ({}),
      apply: () => {
        activeOnly.value = false;
      },
      clear: () => {
        activeOnly.value = true;
      },
    },
    {
      id: "vendorCatalog",
      label: "Vendor catalog text",
      hint: "Vendors that sell something matching this text — show all their products",
      valueType: "text",
      placeholder: "e.g. samsung",
      occupied: () => Boolean(vendorCatalogKeyword.value.trim()),
      chipText: () =>
        `Vendor catalog text contains “${vendorCatalogKeyword.value.trim()}”`,
      getDraft: () => ({ text: vendorCatalogKeyword.value }),
      apply: (d) => {
        const t = String(d.text || "").trim();
        if (!t) return false;
        vendorCatalogKeyword.value = t;
      },
      clear: () => {
        vendorCatalogKeyword.value = "";
      },
    },
    {
      id: "vendorCount",
      label: "Vendor’s product count",
      hint: "Vendors with this many products — show all their products",
      valueType: "number",
      ops: COMPARE_OPS,
      defaultNumber: 5,
      occupied: () => vendorCountEnabled.value,
      chipText: () =>
        `Vendor’s product count ${opLabel(vendorCountOp.value)} ${vendorCountN.value ?? ""}`,
      getDraft: () => ({ op: vendorCountOp.value, number: vendorCountN.value }),
      apply: (d) => {
        vendorCountOp.value = d.op;
        vendorCountN.value = Math.floor(Number(d.number) || 0);
        vendorCountEnabled.value = true;
      },
      clear: () => {
        vendorCountEnabled.value = false;
      },
    }
  );

  return list;
});
</script>

<template>
  <RuleFilterBar :fields="fields" />
</template>
