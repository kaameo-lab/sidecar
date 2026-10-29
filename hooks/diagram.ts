// Lays out the work diagram as text lines measured in terminal cells: a
// Hangul syllable or jamo takes two cells, an ASCII letter or a box-drawing
// line one. Only box-drawing characters frame the boxes, since a glyph such
// as ● or ▼ takes one cell in some terminals and two in others.

import type { DiagramEdge, DiagramNode } from '../types'
import { cells, fit } from './width'

export type Tone = 'new' | 'changed' | 'dim'
export type Seg = { text: string; tone?: Tone }
export type Line = Seg[]

const INNER_MAX = 18
const GAP = 2

const spaces = (n: number) => ' '.repeat(Math.max(0, n))

// Pads `text` with spaces to `width` cells.
const padTo = (text: string, width: number) => text + spaces(width - cells(text))

const toneOf = (node: DiagramNode): Tone | undefined =>
  node.status === 'new' ? 'new' : node.status === 'changed' ? 'changed' : undefined

// Longest path from a node nothing points at; a cycle is cut where it closes.
const ranksOf = (nodes: DiagramNode[], edges: DiagramEdge[]) => {
  const rank = new Map(nodes.map(node => [node.id, 0]))
  for (let pass = 0; pass < nodes.length; pass += 1) {
    let moved = false
    for (const edge of edges) {
      const from = rank.get(edge.from) ?? 0
      if ((rank.get(edge.to) ?? 0) < from + 1 && from + 1 < nodes.length) {
        rank.set(edge.to, from + 1)
        moved = true
      }
    }
    if (!moved) break
  }

  const rows: DiagramNode[][] = []
  for (const node of nodes) {
    const r = rank.get(node.id) ?? 0
    ;(rows[r] ??= []).push(node)
  }

  return rows.filter(row => row.length > 0)
}

type Box = { node: DiagramNode; label: string; note: string; inner: number; width: number; start: number; center: number }

const boxOf = (node: DiagramNode): Omit<Box, 'start' | 'center'> => {
  const label = fit(node.label, INNER_MAX)
  const note = node.note === '' ? '' : fit(node.note, INNER_MAX)
  const inner = Math.max(cells(label), cells(note)) + 2

  return { node, label, note, inner, width: inner + 2 }
}

// One cell of the bus between two rows of boxes: a line comes up from the
// boxes above at `up`, goes down into the boxes below at `down`.
const junction = (up: boolean, down: boolean, left: boolean, right: boolean) => {
  if (up && down) return left && right ? '┼' : right ? '├' : left ? '┤' : '│'
  if (up) return left && right ? '┴' : right ? '└' : left ? '┘' : '│'
  if (down) return left && right ? '┬' : right ? '┌' : left ? '┐' : '│'

  return '─'
}

// Boxes rank by rank, top to bottom; null when a rank does not fit `columns`.
const boxes = (nodes: DiagramNode[], edges: DiagramEdge[], columns: number): Line[] | null => {
  const rows = ranksOf(nodes, edges).map(row => row.map(boxOf))
  const widths = rows.map(row => row.reduce((sum, box) => sum + box.width, 0) + GAP * (row.length - 1))
  const total = Math.max(...widths)
  if (total > columns) return null

  const placed: Box[][] = rows.map((row, r) => {
    let at = Math.floor((total - (widths[r] ?? 0)) / 2)

    return row.map(box => {
      const start = at
      at += box.width + GAP

      return { ...box, start, center: start + Math.floor(box.width / 2) }
    })
  })
  const rankOf = new Map(placed.flatMap((row, r) => row.map(box => [box.node.id, r] as const)))
  const between = (r: number) =>
    edges.filter(edge => rankOf.get(edge.from) === r && rankOf.get(edge.to) === r + 1)

  const lines: Line[] = []
  placed.forEach((row, r) => {
    const into = new Set(r > 0 ? between(r - 1).map(edge => edge.to) : [])
    const outOf = new Set(between(r).map(edge => edge.from))
    const hasNote = row.some(box => box.note !== '')

    // Each line of a row is the boxes' own parts joined with the gaps.
    const part = (draw: (box: Box) => Seg[]) => {
      const line: Line = []
      let at = 0
      for (const box of row) {
        line.push({ text: spaces(box.start - at) })
        line.push(...draw(box))
        at = box.start + box.width
      }

      return line
    }
    const border = (box: Box, left: string, mid: string, right: string, isMarked: boolean) => {
      const half = Math.floor(box.width / 2) - 1
      const rest = box.inner - half - 1

      return [{ text: isMarked ? `${left}${'─'.repeat(half)}${mid}${'─'.repeat(rest)}${right}` : `${left}${'─'.repeat(box.inner)}${right}` }]
    }

    lines.push(part(box => border(box, '┌', '┴', '┐', into.has(box.node.id))))
    lines.push(
      part(box => {
        const tone = toneOf(box.node)

        return [{ text: '│ ' }, { text: box.label, ...(tone ? { tone } : {}) }, { text: `${padTo('', box.inner - 1 - cells(box.label))}│` }]
      }),
    )
    if (hasNote) {
      lines.push(
        part(box => [{ text: '│ ' }, { text: box.note, tone: 'dim' }, { text: `${padTo('', box.inner - 1 - cells(box.note))}│` }]),
      )
    }
    lines.push(part(box => border(box, '└', '┬', '┘', outOf.has(box.node.id))))

    const next = placed[r + 1]
    if (!next) return
    const links = between(r)
    if (links.length === 0) return

    const centers = new Map([...row, ...next].map(box => [box.node.id, box.center]))
    const ups = new Set(links.map(edge => centers.get(edge.from) ?? 0))
    const downs = new Set(links.map(edge => centers.get(edge.to) ?? 0))
    const lo = Math.min(...ups, ...downs)
    const hi = Math.max(...ups, ...downs)
    let bus = spaces(lo)
    for (let c = lo; c <= hi; c += 1) bus += junction(ups.has(c), downs.has(c), c > lo, c < hi)
    lines.push([{ text: bus }])
  })

  return lines
}

// The narrow form: each root and what it points at, as a tree.
const tree = (nodes: DiagramNode[], edges: DiagramEdge[], columns: number): Line[] => {
  const byId = new Map(nodes.map(node => [node.id, node]))
  const children = (id: string) => edges.filter(edge => edge.from === id).map(edge => edge.to)
  const pointedAt = new Set(edges.map(edge => edge.to))
  const roots = nodes.filter(node => !pointedAt.has(node.id))
  const seen = new Set<string>()
  const lines: Line[] = []

  const walk = (id: string, lead: string, branch: string) => {
    const node = byId.get(id)
    if (!node) return
    const tone = toneOf(node)
    const room = Math.max(8, columns - cells(lead + branch))
    const label = fit(node.label, room)
    const note = node.note === '' ? '' : fit(node.note, Math.max(0, room - cells(label) - 2))
    const isAgain = seen.has(id)
    lines.push([
      { text: lead + branch },
      { text: label, ...(tone ? { tone } : {}) },
      ...(isAgain ? [{ text: '  (위)', tone: 'dim' as const }] : note !== '' ? [{ text: `  ${note}`, tone: 'dim' as const }] : []),
    ])
    if (isAgain) return
    seen.add(id)

    const kids = children(id)
    kids.forEach((kid, index) => {
      const isLast = index === kids.length - 1
      const nextLead = branch === '' ? lead : lead + (branch.startsWith('└') ? '   ' : '│  ')
      walk(kid, nextLead, isLast ? '└─ ' : '├─ ')
    })
  }

  for (const root of roots.length > 0 ? roots : nodes.slice(0, 1)) walk(root.id, '', '')
  // Whatever a cycle kept out of reach of every root.
  for (const node of nodes) if (!seen.has(node.id)) walk(node.id, '', '')

  return lines
}

export const layout = (nodes: DiagramNode[], edges: DiagramEdge[], columns: number): Line[] => {
  if (nodes.length === 0) return []

  return boxes(nodes, edges, columns) ?? tree(nodes, edges, columns)
}

export const plainText = (line: Line) => line.map(seg => seg.text).join('')
