/**
 * Detect USB HID "wedge" barcode scanners (MediaTek / Zebra / etc.)
 * They type characters very fast and usually end with Enter.
 */

const CHAR_GAP_MS = 80;
const MIN_CODE_LEN = 3;

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
    if (lastAt && now - lastAt > CHAR_GAP_MS) {
      buffer = "";
    }
    lastAt = now;

    if (e.key === "Enter") {
      const code = buffer.trim();
      reset();
      if (code.length < MIN_CODE_LEN) return;
      e.preventDefault();
      e.stopPropagation();
      await onScan(code);
      return;
    }

    if (e.key.length === 1) {
      buffer += e.key;
      // Once it looks like a scan stream, keep keys out of random inputs
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
