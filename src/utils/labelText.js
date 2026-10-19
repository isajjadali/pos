/**
 * Rough line count for centered label text (matches ZPL ^FB word wrap).
 * @param {string} text
 * @param {number} innerWidthDots
 * @param {number} fontHeightDots
 */
export function estimateWrappedLines(text, innerWidthDots, fontHeightDots) {
  const s = String(text ?? "").trim();
  if (!s) return 1;
  const avgCharW = fontHeightDots * 0.52;
  const charsPerLine = Math.max(6, Math.floor(innerWidthDots / avgCharW));
  const words = s.split(/\s+/);
  let lines = 1;
  let current = 0;
  for (const word of words) {
    const wl = word.length;
    if (wl > charsPerLine) {
      const chunks = Math.ceil(wl / charsPerLine);
      if (current > 0) lines += 1;
      lines += chunks - 1;
      current = wl % charsPerLine || charsPerLine;
      continue;
    }
    if (current === 0) {
      current = wl;
    } else if (current + 1 + wl <= charsPerLine) {
      current += 1 + wl;
    } else {
      lines += 1;
      current = wl;
    }
  }
  return lines;
}

/** Word-wrap for on-screen preview (same rules as estimateWrappedLines). */
export function wrapLabelLines(text, innerWidthDots, fontHeightDots, maxLines) {
  const s = String(text ?? "").trim();
  if (!s) return [""];
  const avgCharW = fontHeightDots * 0.52;
  const charsPerLine = Math.max(6, Math.floor(innerWidthDots / avgCharW));
  const words = s.split(/\s+/);
  const lines = [];
  let current = "";

  function pushLine() {
    if (current) lines.push(current);
    current = "";
  }

  for (const word of words) {
    if (word.length > charsPerLine) {
      if (current) pushLine();
      for (let i = 0; i < word.length; i += charsPerLine) {
        lines.push(word.slice(i, i + charsPerLine));
        if (lines.length >= maxLines) return lines.slice(0, maxLines);
      }
      continue;
    }
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= charsPerLine) {
      current += ` ${word}`;
    } else {
      pushLine();
      current = word;
    }
    if (lines.length >= maxLines) return lines.slice(0, maxLines);
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

export function maxNameLinesForLabel(widthMm, heightMm) {
  if (heightMm >= 35) return 4;
  if (heightMm >= 25) return 3;
  return 2;
}
