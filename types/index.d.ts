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
  // The item whose own field is open, or ''.
  editing: string
  sent: string
  // What that field holds, not yet its answer.
  draft: string
  // The bottom field: a note sent under the answers (with plain options, the
  // reply itself).
  note: string
}

// One turn of the main conversation: what was asked, and a one-line gist and
// a few lines of detail of what Claude did ('' until the summary lands).
export type Entry = {
  id: string
  at: number
  prompt: string
  // Who started the turn: the person, or the engine for a background task's
  // notice (its row reads 알림, its prompt the notice's summary).
  from: 'person' | 'notice'
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
  // Absolute paths Edit, Write and NotebookEdit changed, or git found changed
  // since `base`, first change first.
  files: string[]
  // The commit git compares the work tree with: the tree as the session found
  // it, or '' outside a repository.
  base: string
  // Absolute paths git did not track when the session began.
  untracked: string[]
}

export type Folded = {
  choices: boolean
  summary: boolean
  diagram: boolean
  log: boolean
  // The log entry shown whole, or ''.
  open: string
}

// What the store keeps of one session so a resumed one draws its pane
// again: every atom but the options, which must not come back stale.
export type Saved = {
  // The four atoms' shape tags when it was saved.
  shape: string
  log: Entry[]
  summary: Summary
  stats: Stats
  folded: Folded
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
