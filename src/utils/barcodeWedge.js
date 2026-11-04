/**
 * Detect USB HID "wedge" barcode scanners (MediaTek / Zebra / etc.)
 * They type characters very fast and usually end with Enter.
 *
 * First 1–2 keystrokes can briefly leak into a focused input before we
 * know it is a scan burst — those must be stripped so POS does not keep "DW".
 */

const CHAR_GAP_MS = 80;
const MIN_CODE_LEN = 3;

/** Dispatched after a wedge scan is committed (success or handled error upstream). */
export const BARCODE_WEDGE_SCAN_EVENT = "dw-barcode-wedge-scan";

function clearLeakedInput(el, leakedPrefix) {
  if (!el || !leakedPrefix) return;
  const tag = el.tagName;
  if (tag !== "INPUT" && tag !== "TEXTAREA") return;
  const cur = String(el.value ?? "");
  if (!cur) return;
  // Typical leak: first 1–2 chars of the barcode while burst detection catches up
  let next = cur;
  if (cur === leakedPrefix || leakedPrefix.startsWith(cur) || cur.endsWith(leakedPrefix)) {
    next = "";
  } else if (cur.endsWith(leakedPrefix.slice(0, Math.min(2, leakedPrefix.length)))) {
    next = cur.slice(0, -Math.min(2, leakedPrefix.length));
  } else {
    return;
  }
  const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(el, next);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

/**
 * @param {(code: string) => void | Promise<void>} onScan
 * @param {{ enabled?: () => boolean }} [options]
 * @returns {() => void} cleanup
 */
export function attachBarcodeWedgeListener(onScan, options = {}) {
  let buffer = "";
  let lastAt = 0;

  function reset() {
    buffer = "";
    lastAt = 0;
  }

  async function handleKeyDown(e) {
    if (options.enabled && !options.enabled()) return;
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    const target = e.target;
    const type = (target?.type || "").toLowerCase();
    if (type === "password") return;
    if (target?.isContentEditable) return;

    const now = Date.now();
    const gap = lastAt ? now - lastAt : Infinity;
    if (lastAt && gap > CHAR_GAP_MS) {
      buffer = "";
    }
    lastAt = now;

    if (e.key === "Enter") {
      const code = buffer.trim();
      const leaked = code.slice(0, Math.min(2, code.length));
      reset();
      if (code.length < MIN_CODE_LEN) return;
      e.preventDefault();
      e.stopPropagation();
      clearLeakedInput(target, leaked);
      window.dispatchEvent(
        new CustomEvent(BARCODE_WEDGE_SCAN_EVENT, { detail: { code } })
      );
      await onScan(code);
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      // Fast 2nd+ keystroke ⇒ scanner burst — block field and strip prior leak
      if (buffer.length >= 2 && gap <= CHAR_GAP_MS) {
        e.preventDefault();
        e.stopPropagation();
        clearLeakedInput(target, buffer.slice(0, -1));
        return;
      }
      if (buffer.length >= MIN_CODE_LEN) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }

    if (e.key === "Backspace" && buffer) {
      buffer = buffer.slice(0, -1);
    }
  }

  window.addEventListener("keydown", handleKeyDown, true);
  return () => window.removeEventListener("keydown", handleKeyDown, true);
}
