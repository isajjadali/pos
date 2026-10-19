/** Label size presets (width × height). Zebra ZPL uses mm for layout math. */
export const LABEL_PRESETS = [
  {
    id: "40x25",
    label: "40 × 25 mm (recommended)",
    widthMm: 40,
    heightMm: 25,
    default: true,
  },
  {
    id: "1x1.5in",
    label: '1″ × 1.5″ (25 × 38 mm)',
    widthMm: 25.4,
    heightMm: 38.1,
  },
  {
    id: "50x30",
    label: "50 × 30 mm",
    widthMm: 50,
    heightMm: 30,
  },
];

export const LABEL_PRESET_STORAGE_KEY = "barcode_label_preset_id";

export function getPresetById(id) {
  return LABEL_PRESETS.find((p) => p.id === id) || LABEL_PRESETS.find((p) => p.default) || LABEL_PRESETS[0];
}

export function loadStoredPresetId() {
  try {
    const id = localStorage.getItem(LABEL_PRESET_STORAGE_KEY);
    if (id && LABEL_PRESETS.some((p) => p.id === id)) return id;
  } catch {
    /* ignore */
  }
  return getPresetById(null).id;
}

export function saveStoredPresetId(id) {
  try {
    localStorage.setItem(LABEL_PRESET_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}
