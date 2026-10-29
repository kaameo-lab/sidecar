export type Choice = { key: string; label: string }

// One "Q1 - ..." question: its short title, the answer Claude suggests
// (its arrow line), any a/b/c options inside it, and the key of the option
// the suggestion names ('' when it names none).
export type Item = { id: string; title: string; suggestion: string; choices: Choice[]; pick: string }

// options: buttons are up; sent: pressed, turn not started yet;
// working: a turn runs; none: the last answer had no options.
export type Phase = 'options' | 'sent' | 'working' | 'none'

export type View = {
  phase: Phase
  question: string
  choices: Choice[]
  items: Item[]
  // Item id → the answer picked for it.
  answers: Record<string, string>
  // The item id the field answers, or '' when it answers the whole reply.
  editing: string
  sent: string
  draft: string
}

// One turn of the main conversation: what was asked, and a one-line gist and
// a few lines of detail of what Claude did ('' until the summary lands).
export type Entry = {
  id: string
  at: number
  prompt: string
  gist: string
  detail: string
  status: 'working' | 'done' | 'stopped'
}

// A box of the work diagram: a file or module this session built on.
export type DiagramNode = { id: string; label: string; note: string; status: 'new' | 'changed' | 'other' }

// An import or call from one box to another.
export type DiagramEdge = { from: string; to: string }

export type Summary = {
  goal: string
  decisions: string[]
  open: string[]
  nodes: DiagramNode[]
  edges: DiagramEdge[]
  // When it was made; 0 before the first.
  at: number
  isBusy: boolean
  // Why the last refresh made nothing, or ''.
  error: string
}

export type Stats = {
  startedAt: number
  turns: number
  // Turns since the summary was last refreshed.
  sinceSummary: number
  // Absolute paths Edit, Write and NotebookEdit changed, first change first.
  files: string[]
}

export type Folded = {
  choices: boolean
  summary: boolean
  diagram: boolean
  log: boolean
  // The log entry shown whole, or ''.
  open: string
}

declare module 'claude-code' {
  interface PluginState {
    'sidecar': {
      view: Shaped<View>
      log: Shaped<Entry[]>
      summary: Shaped<Summary>
      stats: Shaped<Stats>
      folded: Shaped<Folded>
    }
  }
}
