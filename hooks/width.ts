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

// Text with what a terminal draws as nothing taken out, so no words the
// person never saw ride along with words they did: control, format,
// private-use and unassigned code points, every default-ignorable one (the
// tag block, variation selectors, Hangul fillers) and the blank braille
// cell. Combining marks stack two deep at most. Emoji stay whole: one
// U+FE0F straight after a pictograph, and a zero-width joiner between an
// emoji's parts (❤️‍🔥, 👩🏽‍💻).
const HIDDEN = /[\p{Cc}\p{Cf}\p{Co}\p{Cn}\p{Default_Ignorable_Code_Point}\u2800]/u
const MARK = /\p{M}/u
const PICTOGRAPH = /\p{Extended_Pictographic}/u
const EMOJI_PART = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\ufe0f]/u
const MARKS_MAX = 2

export const visible = (text: string) => {
  const chars = [...text]
  let out = ''
  let before = ''
  let marks = 0

  chars.forEach((char, index) => {
    const after = chars.at(index + 1) ?? ''
    const isKept =
      char === '\ufe0f'
        ? PICTOGRAPH.test(before)
        : char === '\u200d'
          ? EMOJI_PART.test(before) && PICTOGRAPH.test(after)
          : HIDDEN.test(char)
            ? false
            : !MARK.test(char) || marks < MARKS_MAX
    if (!isKept) return

    marks = MARK.test(char) ? marks + 1 : 0
    out += char
    before = char
  })

  return out
}
