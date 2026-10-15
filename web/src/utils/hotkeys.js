/** True when user is typing in a field (skip single-key shortcuts). */
export function isTypingInField(event) {
  const el = event.target;
  if (!el || typeof el !== "object") return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/** Function keys and Alt+digit work even while focused in an input. */
export function isGlobalChord(event) {
  if (/^F\d{1,2}$/i.test(event.key)) return true;
  if (event.altKey && /^[1-9]$/.test(event.key)) return true;
  if (event.ctrlKey && event.key === "/") return true;
  if (event.key === "?" && event.shiftKey) return true;
  if (event.key === "Escape") return true;
  return false;
}

export function shouldBlockShortcut(event) {
  if (isGlobalChord(event)) return false;
  return isTypingInField(event);
}

export const NAV_ROUTE_BY_ALT_DIGIT = [
  "dashboard",
  "pos",
  "products",
  "import",
  "inventory",
  "barcodes",
  "vendors",
  "sales",
  "settings",
];

export const SHORTCUT_GROUPS = [
  {
    title: "Everywhere",
    items: [
      { keys: "Shift + ?", desc: "Show keyboard shortcuts" },
      { keys: "Alt + 1 … 9", desc: "Go to menu page (1 = Dashboard, 2 = POS, …)" },
      { keys: "Esc", desc: "Close dialogs / receipt" },
    ],
  },
  {
    title: "POS / New Sale",
    items: [
      { keys: "F2", desc: "Focus barcode scan" },
      { keys: "F3", desc: "Focus product search" },
      { keys: "F4", desc: "Focus discount" },
      { keys: "F5", desc: "Focus cash received" },
      { keys: "F6", desc: "Cash received = exact total" },
      { keys: "F7", desc: "Hold order" },
      { keys: "F8", desc: "New order" },
      { keys: "F9", desc: "Complete sale" },
      { keys: "Ctrl + Enter", desc: "Complete sale" },
      { keys: "↑ / ↓", desc: "Move in search results" },
      { keys: "Enter", desc: "Add highlighted search result (when results open)" },
      { keys: "P", desc: "Print receipt (receipt open)" },
    ],
  },
  {
    title: "Products",
    items: [
      { keys: "/", desc: "Focus search" },
      { keys: "N", desc: "Add new product" },
      { keys: "R", desc: "Refresh list" },
    ],
  },
];
