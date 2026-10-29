import type { Choice, Item } from '../types'

export type Parsed = { question: string; choices: Choice[] }

const LETTERS = 'abcdefghij'
const DIGITS = '123456789'
const LABEL_MAX = 200

// "a) x", "a. x", "a: x", "(a) x", "**a)** x", "- a) x", "1. x", "A) x"
const ITEM = /^\s*(?:[-*+]\s+)?(?:\*\*|__)?\(?([a-jA-J]|[1-9])[.):](?:\*\*|__)?\s+(\S.*)$/

type Group = { kind: 'letter' | 'digit'; start: number; end: number; choices: Choice[] }

// Words on the line just before a numbered list that offer it to pick from,
// and the headings that make it steps to follow whatever they mention.
const OFFER =
  /중에서|중 하나|둘 중|(?:두|세|네) 가지 (?:방법|안|선택지)|방법은 (?:두|세|네) 가지|골라|고르시|추천(?:합니다|드립니다|해요)[.:]?\s*$/
const STEPS = /진행 순서|진행 방식|다음 액션|할 일/

const clean = (text: string) => {
  const plain = text
    .replace(/\*\*|__|`/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return plain.length > LABEL_MAX ? `${plain.slice(0, LABEL_MAX - 1)}…` : plain
}

const asQuestion = (line: string) => clean(line).replace(/^(?:#+\s*|[-*+>]\s+)/, '')

// Every run of two or more consecutive options outside code fences, in order.
const groupsOf = (answer: string) => {
  const lines = answer.split('\n')
  const groups: Group[] = []
  let open: Group | null = null
  let isInFence = false

  const close = () => {
    if (open && open.choices.length >= 2) groups.push(open)
    open = null
  }

  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) {
      close()
      isInFence = !isInFence
      return
    }
    if (isInFence) return

    const match = ITEM.exec(line)
    if (!match) {
      // Blank or indented lines (an option's own description) keep a group open.
      if (open && line.trim() !== '' && !/^\s/.test(line)) close()
      return
    }

    const key = (match[1] ?? '').toLowerCase()
    const label = clean(match[2] ?? '')
    const kind = DIGITS.includes(key) ? 'digit' : 'letter'
    const order = kind === 'digit' ? DIGITS : LETTERS
    const current: Group | null = open

    if (current && current.kind === kind && order[current.choices.length] === key) {
      current.choices.push({ key, label })
      current.end = i
      return
    }

    close()
    if (key === order[0]) {
      open = { kind, start: i, end: i, choices: [{ key, label }] }
    }
  })
  close()

  return { lines, groups }
}

export const parseChoices = (answer: string): Parsed | null => {
  const { lines, groups } = groupsOf(answer)

  for (const group of groups.reverse()) {
    const before = lines.slice(0, group.start).filter(line => line.trim() !== '')
    const near = before.slice(-3)
    const after = lines.slice(group.end + 1)
    const hasQuestion = [...near, ...after].some(line => /[?？]/.test(line))
    const lead = before.slice(-1)
    const isOffered = lead.some(line => OFFER.test(line)) && !lead.some(line => STEPS.test(line))

    if (group.kind === 'digit' && !hasQuestion && !isOffered) continue

    const asked = [...near].reverse().find(line => /[?？]/.test(line))

    return { question: asked ? asQuestion(asked) : '', choices: group.choices }
  }

  return null
}

// "❓ Q1 - title: body", "**Q2.** body", "- Q3) body"
const QUESTION = /^\s*(?:[-*+>]\s+)?(?:❓|❔|\?)?\s*(?:\*\*|__)?Q(\d{1,2})(?:\*\*|__)?\s*[-–—:.)]\s*(\S.*)$/
// "➡️ 예. ...", "→ ...", "추천: ..."
const SUGGESTION = /^\s*(?:➡️|➡|→|=>|👉|(?:\*\*)?(?:추천|권장|Recommended)(?:\*\*)?\s*[:：])\s*(\S.*)$/
// The label a suggestion line may repeat after its arrow: "추천 답: ..."
const SUGGESTION_LABEL = /^(?:추천\s*답|추천|권장|Recommended)\s*[:：]\s*/i
// "a) ..." at the head of a suggestion names that option.
const NAMED = /^\(?([a-jA-J])[.):]\s/
const BREAK =/^\s*(?:-{3,}|\*{3,}|_{3,}|#{1,6}\s.*)\s*$/
const TITLE_MAX = 40

type Block = { id: string; body: string; lines: string[] }

const titleOf = (body: string) => {
  const text = clean(body)
  const head = /^(.{1,40}?)\s*[:：]\s/.exec(text)?.[1]
  if (head) return head

  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text
}

export const parseQuestions = (answer: string): Item[] | null => {
  const blocks: Block[] = []
  let open: Block | null = null
  let isInFence = false

  for (const line of answer.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      isInFence = !isInFence
      continue
    }
    if (isInFence) continue

    const match = QUESTION.exec(line)
    if (match) {
      open = { id: `Q${match[1]}`, body: match[2] ?? '', lines: [] }
      blocks.push(open)
      continue
    }
    if (BREAK.test(line)) {
      open = null
      continue
    }
    open?.lines.push(line)
  }

  const byId = new Map<string, Item>()
  for (const block of blocks) {
    const text = [block.body, ...block.lines].join('\n')
    const arrow = block.lines.map(line => SUGGESTION.exec(line)?.[1]).find(Boolean)
    const suggestion = arrow ? clean(arrow).replace(SUGGESTION_LABEL, '') : ''
    const choices = parseChoices(text)?.choices ?? []
    const isAsked = arrow !== undefined || choices.length > 0 || /[?？]/.test(text)
    if (!isAsked) continue

    const named = (NAMED.exec(suggestion)?.[1] ?? '').toLowerCase()
    const pick = choices.some(choice => choice.key === named) ? named : ''

    // A later question of the same number replaces the earlier one.
    byId.delete(block.id)
    byId.set(block.id, { id: block.id, title: titleOf(block.body), suggestion, choices, pick })
  }

  return byId.size > 0 ? [...byId.values()] : null
}

const AFTER_MAX = 3

// "1. 닫을까요?\n2. 열까요?" closing an answer: questions to answer one by
// one, named as the answer numbered them. Every item must ask, and at most a
// few lines may follow the list.
export const parseNumbered = (answer: string): Item[] | null => {
  const { lines, groups } = groupsOf(answer)
  const group = groups[groups.length - 1]
  if (group === undefined || group.kind !== 'digit') return null
  if (lines.slice(group.end + 1).filter(line => line.trim() !== '').length > AFTER_MAX) return null
  if (!group.choices.every(choice => /[?？]/.test(choice.label))) return null

  return group.choices.map(choice => ({ id: `${choice.key}번`, title: titleOf(choice.label), suggestion: '', choices: [], pick: '' }))
}
