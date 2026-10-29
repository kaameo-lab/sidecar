// Terminal cells a character takes: Hangul, CJK, full-width forms and most
// emoji take two.
const isWide = (code: number) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0xa4cf) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe4f) ||
  (code >= 0xff00 && code <= 0xff60) ||
  (code >= 0xffe0 && code <= 0xffe6) ||
  (code >= 0x1f300 && code <= 0x1faff) ||
  (code >= 0x20000 && code <= 0x3fffd)

const cellsOf = (char: string) => (isWide(char.codePointAt(0) ?? 0) ? 2 : 1)

export const cells = (text: string) => [...text].reduce((sum, char) => sum + cellsOf(char), 0)

// Cuts `text` to at most `columns` cells, ending in "…" when cut.
export const fit = (text: string, columns: number) => {
  const room = Math.max(8, columns)
  if (cells(text) <= room) return text

  let used = 1
  let out = ''
  for (const char of text) {
    const width = cellsOf(char)
    if (used + width > room) break
    used += width
    out += char
  }

  return `${out}…`
}
