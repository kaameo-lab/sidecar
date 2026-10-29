import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Choice, Entry, Folded, Item, Saved, Stats, Summary, View } from '../types'
import {
  baseName,
  clockTime,
  fallbackGist,
  gistPrompt,
  parseGist,
  parseSummary,
  promptLine,
  span,
  summaryPrompt,
} from './digest'
import { layout } from './diagram'
import { parseChoices, parseNumbered, parseQuestions } from './parse'
import { cells, fit } from './width'

const EMPTY_VIEW: View = {
  phase: 'none',
  question: '',
  choices: [],
  items: [],
  answers: {},
  editing: '',
  sent: '',
  draft: '',
  note: '',
}
const NO_ENTRIES: Entry[] = []
const EMPTY_SUMMARY: Summary = {
  goal: '',
  decisions: [],
  open: [],
  nodes: [],
  edges: [],
  at: 0,
  isBusy: false,
  error: '',
}
const EMPTY_STATS: Stats = { startedAt: 0, turns: 0, sinceSummary: 0, files: [], base: '', untracked: [] }
const EMPTY_FOLDED: Folded = { choices: false, summary: false, diagram: false, log: false, open: '' }

// Change a tag when its type's fields change: it declines what an earlier
// version stored, which outlives a reload.
const view = atom({ plugin: 'sidecar', key: 'view' } as const, EMPTY_VIEW, { shape: 'view-4' })
const log = atom({ plugin: 'sidecar', key: 'log' } as const, NO_ENTRIES, { shape: 'log-1' })
const summary = atom({ plugin: 'sidecar', key: 'summary' } as const, EMPTY_SUMMARY, { shape: 'summary-2' })
const stats = atom({ plugin: 'sidecar', key: 'stats' } as const, EMPTY_STATS, { shape: 'stats-2' })
const folded = atom({ plugin: 'sidecar', key: 'folded' } as const, EMPTY_FOLDED, { shape: 'folded-2' })

// The tags of the atoms a session's snapshot holds: change it with theirs.
const SAVED_SHAPE = 'log-1 summary-2 stats-2 folded-2'
const SESSIONS_KEPT = 20

const PLUGIN = 'sidecar'
const PANE = 'sidecar'
const TITLE = 'Sidecar'
const RECOMMEND = '추천대로'
const MARK = ' ✓추천'
const SUMMARY_EVERY = 5
const LOG_KEPT = 200
const LOG_SHOWN = 30
const GIT_TIMEOUT_MS = 5000
// Cells left blank down the pane's left edge.
const MARGIN = 2

// The last answer of the main loop: a fork's transcript ends before it.
let lastAnswer = ''

// Counts the conversations this process has drawn. Work begun under one
// (a summary, a sweep) that ends after a /clear or /resume drops its result
// rather than write the old conversation into the new pane.
let epoch = 0

// A press goes out as the user's own words, so it sends only what the pane
// showed whole in `room` cells: an option cut to fit goes out as its key, a
// suggestion cut to fit is left out.
const isWhole = (text: string, room: number) => fit(text, room) === text

const said = (choice: Choice) => `${choice.key}) ${choice.label}`

const pickLabel = (item: Item, choice: Choice) => `${said(choice)}${choice.key === item.pick ? MARK : ''}`

const picked = (item: Item, choice: Choice, room: number) =>
  isWhole(pickLabel(item, choice), room) ? said(choice) : choice.key

// The answer "as recommended" sends: the option the suggestion names, else
// the suggestion itself (shown on its ➡ row, four cells in).
const recommended = (item: Item, room: number) => {
  const named = item.choices.find(choice => choice.key === item.pick)
  if (named) return picked(item, named, room)

  return isWhole(item.suggestion, room - 4) ? `${RECOMMEND} (${item.suggestion})` : RECOMMEND
}

// One line per answered question; with `fillRest`, the unanswered ones that
// carry a suggestion take it.
const compose = (v: View, fillRest: boolean, room: number) =>
  v.items
    .flatMap(item => {
      const given = v.answers[item.id] ?? (fillRest && item.suggestion !== '' ? recommended(item, room) : undefined)

      return given === undefined ? [] : [`${item.id}: ${given}`]
    })
    .join('\n')

const mark = (item: Item, answer: string | undefined) => {
  if (answer === undefined) return '–'
  if (answer.startsWith(RECOMMEND)) return '✓'

  return item.choices.find(choice => answer === said(choice) || answer === choice.key)?.key ?? '✎'
}

const send = async ($: EngineInterface, text: string) => {
  const trimmed = text.trim()
  if (trimmed === '') return

  await update($, view, (v): View => ({ ...v, phase: 'sent', sent: trimmed, draft: '', note: '', editing: '' }))
  await $.prompt.submit({ text: trimmed, asUser: true })
}

// A reply with the bottom field's note under it, a blank line between.
const withNote = (reply: string, note: string) => [reply, note.trim()].filter(part => part !== '').join('\n\n')

// The answers with the open question's unsaved text kept as its own: what
// the field shows is what the person means, unless they now answer that
// same question another way (`except`).
const kept = (v: View, except = ''): Record<string, string> => {
  const text = v.draft.trim()
  if (v.editing === '' || v.editing === except || text === '') return v.answers

  return { ...v.answers, [v.editing]: text }
}

const answer = ($: EngineInterface, id: string, text: string) =>
  update($, view, (v): View => {
    const answers = { ...kept(v, id) }
    if (text.trim() === '') delete answers[id]
    else answers[id] = text.trim()

    return { ...v, answers, editing: '', draft: '' }
  })

type Section = 'choices' | 'summary' | 'diagram' | 'log'

// Moves the keys onto a field the pane draws, once it is drawn; a pane that
// does not hold the keys refuses, and that is fine.
const focusOn = ($: EngineInterface, key: string) => $.ui.focus({ requestId: PANE, key }).catch(() => undefined)

const fold = ($: EngineInterface, part: Section) =>
  update($, folded, (f): Folded => ({ ...f, [part]: !f[part] }))

// Fills an entry's gist and detail with a small model's reading of the turn.
const describe = async ($: EngineInterface, id: string, prompt: string, said: string) => {
  let gist = ''
  let detail = ''
  try {
    const reply = await $.model.complete({ model: 'haiku', prompt: gistPrompt(prompt, said), maxTokens: 300 })
    if (reply.isAnswered) ({ gist, detail } = parseGist(reply.text))
  } catch {
    // A refused request leaves the fallback below.
  }

  await update($, log, (entries): Entry[] =>
    entries.map(entry => (entry.id === id ? { ...entry, gist: gist || fallbackGist(said), detail } : entry)),
  )
}

const refresh = async ($: EngineInterface) => {
  if ((await read($, summary)).isBusy) return
  const began = epoch

  await update($, summary, (s): Summary => ({ ...s, isBusy: true, error: '' }))
  await update($, stats, (s): Stats => ({ ...s, sinceSummary: 0 }))
  await sweep($)

  const { files } = await read($, stats)
  let made: Partial<Summary> = { error: '요약하지 못했어요.' }
  try {
    const reply = await $.model.fork({ prompt: summaryPrompt(lastAnswer, files) })
    if (reply.isAnswered) {
      const parsed = parseSummary(reply.text, files)
      made = parsed ? { ...parsed, at: await $.clock.now(), error: '' } : { error: '요약을 읽지 못했어요.' }
    } else if (reply.reason === 'nothing-to-fork') {
      made = { error: '아직 요약할 대화가 없어요.' }
    }
  } catch {
    // Keeps the error above.
  }

  if (epoch !== began) return
  await update($, summary, (s): Summary => ({ ...s, ...made, isBusy: false }))
  await save($).catch(() => undefined)
}

const track = ($: EngineInterface, paths: string[]) =>
  update($, stats, (s): Stats => {
    const added = paths.filter((path, index) => !s.files.includes(path) && paths.indexOf(path) === index)

    return added.length === 0 ? s : { ...s, files: [...s.files, ...added] }
  })

// What git printed, or null when it failed, is not there or said too much
// to read whole.
const git = async ($: EngineInterface, args: string[]) => {
  try {
    const ran = await $.process.run(['git', ...args], { timeoutMs: GIT_TIMEOUT_MS })

    return ran.exitCode === 0 && !ran.isStdoutTruncated ? ran.stdout : null
  } catch {
    return null
  }
}

const split = (out: string | null, separator = '\n') => (out ?? '').split(separator).filter(line => line !== '')

// The repository's root and the untracked files under it, as absolute paths.
const untrackedNow = async ($: EngineInterface) => {
  const top = split(await git($, ['rev-parse', '--show-toplevel']))[0]
  if (top === undefined) return null

  const others = split(await git($, ['ls-files', '--others', '--exclude-standard', '--full-name', '-z']), '\0')

  return { top, others: others.map(path => `${top}/${path}`) }
}

// Remembers the work tree as the session found it: uncommitted changes in a
// stash commit nothing points at, else HEAD.
const settle = async ($: EngineInterface) => {
  if ((await read($, stats)).base !== '') return

  const found = await untrackedNow($)
  if (found === null) return
  const base = split(await git($, ['stash', 'create']))[0] ?? split(await git($, ['rev-parse', 'HEAD']))[0]
  if (base === undefined) return

  await update($, stats, (s): Stats => ({ ...s, base, untracked: found.others }))
}

// Adds what git sees changed since the session began, whatever changed it.
// A file untracked then stays out even once added, since the base lacks it;
// a rename counts as both its paths. With no base yet (a repository with no
// commit when the session began), it first tries to settle one.
const sweep = async ($: EngineInterface) => {
  const began = epoch
  if ((await read($, stats)).base === '') await settle($)
  const { base, untracked } = await read($, stats)
  if (base === '') return

  const found = await untrackedNow($)
  if (found === null) return
  const diff = await git($, ['diff', '--name-only', '--no-renames', '-z', base])
  if (diff === null) return

  const changed = split(diff, '\0').map(path => `${found.top}/${path}`)
  if (epoch !== began) return
  await track($, [...changed, ...found.others].filter(path => !untracked.includes(path)))
}

const savedKey = (id: string) => `session:${id}`

// Keeps this session's pane in the store, which outlives the process, so a
// resumed session draws it again; only the latest few sessions are kept, and
// of each only the log rows the pane shows, so the store stays under its cap.
const save = async ($: EngineInterface, ending?: string) => {
  const id = ending ?? (await $.session.id())
  const saved: Saved = {
    shape: SAVED_SHAPE,
    log: (await read($, log)).slice(-LOG_SHOWN),
    summary: await read($, summary),
    stats: await read($, stats),
    folded: await read($, folded),
  }
  await $.store.set(savedKey(id), saved)

  const held = await $.store.get('sessions')
  const others = Array.isArray(held) ? held.filter((one): one is string => typeof one === 'string' && one !== id) : []
  const order = [id, ...others]
  await $.store.set('sessions', order.slice(0, SESSIONS_KEPT))
  for (const old of order.slice(SESSIONS_KEPT)) await $.store.delete(savedKey(old))
}

// Draws a resumed session's pane again from what the store kept of it. A
// turn still running when the process ended counts as stopped. The files it
// listed stay, but git is measured afresh from here, so what changed between
// the two processes is not taken for this session's work.
const restore = async ($: EngineInterface) => {
  const id = await $.session.id()
  const kept = await $.store.get(savedKey(id))
  if (typeof kept !== 'object' || kept === null || (kept as Partial<Saved>).shape !== SAVED_SHAPE) return

  const saved = kept as Saved
  await update($, log, (): Entry[] =>
    saved.log.map(entry => (entry.status === 'working' ? { ...entry, status: 'stopped', gist: '중단됨' } : entry)),
  )
  await update($, summary, (): Summary => ({ ...saved.summary, isBusy: false }))
  await update($, stats, (): Stats => ({ ...saved.stats, base: '', untracked: [] }))
  await update($, folded, (): Folded => saved.folded)
}

// Empties the pane for another conversation in this process; the folds are
// the person's, not the conversation's.
const reset = async ($: EngineInterface) => {
  const now = await $.clock.now()
  epoch += 1
  lastAnswer = ''
  await update($, view, (): View => EMPTY_VIEW)
  await update($, log, (): Entry[] => NO_ENTRIES)
  await update($, summary, (): Summary => EMPTY_SUMMARY)
  await update($, stats, (): Stats => ({ ...EMPTY_STATS, startedAt: now }))
}

// What a turn leaves to run after it: the files git saw change, then the save.
const afterTurn = async ($: EngineInterface) => {
  await sweep($).catch(() => undefined)
  await save($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'sidecar',
      description: 'Open the pane with the options, summary and log of this conversation',
    })
    // A reload finds the pane still held; a fresh process finds it empty.
    if ((await read($, stats)).startedAt === 0) await restore($).catch(() => undefined)
    const now = await $.clock.now()
    await update($, stats, (s): Stats => (s.startedAt > 0 ? s : { ...s, startedAt: now }))
    await settle($)
    // A reload mid-refresh leaves nothing running.
    await update($, summary, (s): Summary => ({ ...s, isBusy: false }))
    if (e.isInteractive) void $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)

    return next(e)
  })

  // The last word on what the session leaves for a resume: gists that landed
  // after the last turn's save, folds changed since. Saved under the ending
  // session's own id, whatever the process goes on as. A /clear or a /resume
  // goes on in this process under another id with no session.start, so the
  // pane starts over here, lest the next save write this conversation under
  // that id; the next turn's sweep settles a fresh git base.
  on('session.end', async ($, e, next) => {
    await save($, e.sessionId).catch(() => undefined)
    if (e.reason === 'clear' || e.reason === 'resume') await reset($)

    return next(e)
  })

  on('command.run', { command: 'sidecar' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })

    return { text: 'Sidecar pane을 열었어요.' }
  })

  on('prompt.submit', async ($, e, next) => {
    const isOurs = e.origin?.kind === 'plugin' && e.origin.name === PLUGIN
    if (!isOurs) await update($, view, v => ({ ...v, sent: '' }))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const entry: Entry = {
        id: e.turnId,
        at: await $.clock.now(),
        prompt: promptLine(e.text),
        gist: '',
        detail: '',
        status: 'working',
      }
      await update($, view, (v): View => ({ ...v, phase: 'working' }))
      await update($, log, (entries): Entry[] => [...entries, entry].slice(-LOG_KEPT))
    }

    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await track($, [e.file_path])

    return ran
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await track($, [e.file_path])

    return ran
  })

  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) await track($, [e.notebook_path])

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)

    const items = e.isAborted ? null : (parseQuestions(e.answer) ?? parseNumbered(e.answer))
    const parsed = e.isAborted || items ? null : parseChoices(e.answer)
    const fresh = { answers: {}, editing: '', sent: '', draft: '', note: '' }
    await update($, view, (v): View => {
      if (items) return { ...v, ...fresh, phase: 'options', question: '', choices: [], items }
      if (parsed) return { ...v, ...fresh, phase: 'options', ...parsed, items: [] }

      return { ...v, phase: 'none', question: '', choices: [], items: [] }
    })
    if (items || parsed) void $.ui.open({ id: PANE, title: TITLE })

    const isStopped = e.isAborted || e.answer.trim() === ''
    const entries = await update($, log, (list): Entry[] =>
      list.map(entry =>
        entry.id === e.turnId
          ? { ...entry, status: isStopped ? 'stopped' : 'done', gist: isStopped ? '중단됨' : entry.gist }
          : entry,
      ),
    )
    const entry = entries.find(one => one.id === e.turnId)
    if (entry && !isStopped) {
      lastAnswer = e.answer
      void describe($, entry.id, entry.prompt, e.answer).catch(() => undefined)
    }

    const counted = await update($, stats, (s): Stats => ({ ...s, turns: s.turns + 1, sinceSummary: s.sinceSummary + 1 }))
    void afterTurn($).catch(() => undefined)
    if (counted.sinceSummary >= SUMMARY_EVERY) void refresh($).catch(() => undefined)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Button, Text } = table
    const Input = 'Input' in table ? table.Input : undefined
    const v = await read($, view)
    const f = await read($, folded)
    const s = await read($, summary)
    const st = await read($, stats)
    const entries = await read($, log)
    const now = await $.clock.now()
    // The cells the margin leaves; rules and the diagram span all of them.
    const body = (e.props.bodyColumns ?? 40) - MARGIN
    const columns = body + MARGIN - 8
    const rule = <Text dimColor>{'─'.repeat(Math.max(8, body))}</Text>
    // A section's fold button: its name in the accent, what follows it dim.
    const heading = (part: Section, name: string, meta = '') => {
      const title = `${f[part] ? '▶' : '▼'} ${name}`

      return (
        <Button key={`fold-${part}`} plain label={`${title}${meta}`} onPress={() => fold($, part)}>
          <Text bold color="claude">
            {title}
          </Text>
          {meta !== '' && <Text dimColor>{meta}</Text>}
        </Button>
      )
    }

    const hasChoices = v.phase === 'options' && (v.items.length > 0 || v.choices.length > 0)

    const questions = () => {
      // What a send would take: the open question's unsaved text counts.
      const now: View = { ...v, answers: kept(v) }
      const answered = v.items.filter(item => now.answers[item.id] !== undefined).length
      const canFill = v.items.every(item => now.answers[item.id] !== undefined || item.suggestion !== '')
      const isComplete = answered === v.items.length
      // What 보내기 and Enter in the bottom field send, drawn before they do.
      const preview = withNote(compose(now, false, columns), v.note)

      return (
        <Box flexDirection="column">
          {v.items.map(item => {
            const given = v.answers[item.id]
            const picks = item.choices.map(choice => fit(pickLabel(item, choice), columns))
            const hasOk = item.suggestion !== '' && item.pick === ''

            return (
              <Box flexDirection="column">
                <Text bold color="claude">
                  {fit(`${item.id} ${item.title}`, columns + 4)}
                </Text>
                {item.suggestion !== '' && <Text color="suggestion">  ➡ {fit(item.suggestion, columns - 4)}</Text>}
                {given !== undefined && <Text color="success">  → {fit(given, columns - 4)}</Text>}
                <Box key={`row-${item.id}`} flexDirection="column">
                  {item.choices.map((choice, index) => {
                    // A mark cut to fit would show only part of it: no chip then.
                    const hasChip = choice.key === item.pick && isWhole(pickLabel(item, choice), columns)

                    return (
                      <Button
                        key={`pick-${item.id}-${choice.key}`}
                        label={picks[index]}
                        onPress={() => answer($, item.id, picked(item, choice, columns))}
                      >
                        {hasChip && [said(choice), <Text color="success">{MARK}</Text>]}
                      </Button>
                    )
                  })}
                  {hasOk && (
                    <Button
                      key={`ok-${item.id}`}
                      label={`✓ ${RECOMMEND}`}
                      onPress={() => answer($, item.id, recommended(item, columns))}
                    />
                  )}
                  <Button
                    key={`edit-${item.id}`}
                    label="✎ 직접"
                    dimColor
                    onPress={async () => {
                      await update($, view, (cur): View => {
                        if (cur.editing === item.id) return cur
                        const answers = kept(cur, item.id)
                        const old = answers[item.id]
                        const draft = old === undefined || old.startsWith(RECOMMEND) ? '' : old

                        return { ...cur, answers, editing: item.id, draft }
                      })
                      await focusOn($, `answer-${item.id}`)
                    }}
                  />
                </Box>
                {Input && v.editing === item.id && (
                  <Input
                    key={`answer-${item.id}`}
                    placeholder={`${item.id} 답`}
                    submitLabel="저장"
                    value={v.draft}
                    onInput={value => update($, view, cur => ({ ...cur, draft: value }))}
                    onSubmit={value => answer($, item.id, value)}
                  />
                )}
              </Box>
            )
          })}
          <Text>
            {v.items.map((item, index) => {
              const isOpen = v.answers[item.id] === undefined

              return (
                <Text color={isOpen ? undefined : 'success'} dimColor={isOpen}>
                  {`${index > 0 ? '  ' : ''}${item.id} ${mark(item, v.answers[item.id])}`}
                </Text>
              )
            })}
          </Text>
          {Input && (
            <Input
              key="free"
              placeholder="덧붙일 말 (선택)"
              submitLabel="보내기"
              value={v.note}
              onInput={value => update($, view, cur => ({ ...cur, note: value }))}
              onSubmit={value => send($, withNote(compose(now, false, columns), value))}
            />
          )}
          {preview !== '' && (
            <Box key="preview" flexDirection="column">
              {preview.split('\n').map(line => (
                <Text dimColor>{line === '' ? '  │' : `  │ ${fit(line, columns)}`}</Text>
              ))}
            </Box>
          )}
          <Box flexDirection="row">
            {canFill && !isComplete && (
              <Button
                key="send-all"
                variant="primary"
                label={answered === 0 ? '모두 추천대로 보내기' : '나머지는 추천대로 보내기'}
                onPress={() => send($, withNote(compose(now, true, columns), v.note))}
              />
            )}
            {answered > 0 && (
              <Button
                key="send-picked"
                variant="primary"
                label={isComplete ? '보내기' : '고른 것만 보내기'}
                onPress={() => send($, withNote(compose(now, false, columns), v.note))}
              />
            )}
          </Box>
        </Box>
      )
    }

    // A choice shares its row with its ✎ button, each drawn "[ … ]" on the
    // terminal, four cells over its label.
    const choiceRoom = body - 4 - (cells('✎') + 4)

    // What a plain option sends: its words when they showed whole, else its key.
    const wordsOf = (choice: Choice) => (isWhole(said(choice), choiceRoom) ? said(choice) : choice.key)
    // A note still holding only an ✎'s "b, " adds nothing to a press.
    const added = v.choices.some(choice => v.note.trim() === `${wordsOf(choice)},`) ? '' : v.note

    const letters = () => (
      <Box flexDirection="column">
        {v.question !== '' && (
          <Text bold color="claude">
            {fit(`Q. ${v.question}`, columns + 4)}
          </Text>
        )}
        {v.choices.map(choice => {
          const words = wordsOf(choice)

          return (
            <Box flexDirection="row">
              <Button
                key={`choice-${choice.key}`}
                hotkey={choice.key}
                label={fit(said(choice), choiceRoom)}
                onPress={() => send($, withNote(words, added))}
              />
              <Button
                key={`edit-${choice.key}`}
                label="✎"
                dimColor
                onPress={async () => {
                  await update($, view, cur => ({ ...cur, note: `${words}, ` }))
                  await focusOn($, 'free')
                }}
              />
            </Box>
          )
        })}
        {Input && (
          <Input
            key="free"
            placeholder="직접 입력"
            submitLabel="보내기"
            value={v.note}
            onInput={value => update($, view, cur => ({ ...cur, note: value }))}
            onSubmit={value => send($, value)}
          />
        )}
        <Text dimColor>pane에 포커스가 있으면 {v.choices.map(c => c.key).join(' / ')} 키로 선택</Text>
      </Box>
    )

    // A name may hold a line break or a direction mark that would break the row.
    const files = [...new Set(st.files.map(path => baseName(path).replace(/[\p{Cc}\p{Cf}]/gu, '?')))]
    const shown = entries.slice(-LOG_SHOWN).reverse()

    return (
      <Box key="pane" flexDirection="column" paddingLeft={MARGIN}>
        {hasChoices && (
          <Box flexDirection="column">
            {heading('choices', '선택지')}
            {!f.choices && (v.items.length > 0 ? questions() : letters())}
            {rule}
          </Box>
        )}

        <Box key="summary-head" flexDirection="row" gap={2}>
          {heading('summary', '요약', s.at > 0 ? ` · ${clockTime(s.at)} 갱신` : '')}
          <Button
            key="refresh"
            label={s.isBusy ? '갱신 중…' : '↻ 갱신'}
            onPress={() => (s.isBusy ? undefined : refresh($))}
          />
        </Box>
        {!f.summary && (
          <Box flexDirection="column">
            {s.error !== '' && <Text color="error">{s.error}</Text>}
            {s.at === 0 && !s.isBusy && s.error === '' && (
              <Text dimColor>아직 요약이 없어요. {SUMMARY_EVERY}턴마다 만들거나 ↻ 갱신으로 바로 만들어요.</Text>
            )}
            {s.at > 0 && (
              <Text>
                <Text bold>목표</Text>  {fit(s.goal, columns - 2)}
              </Text>
            )}
            {s.at > 0 && s.decisions.length > 0 && <Text bold>결정</Text>}
            {s.at > 0 && s.decisions.map(item => <Text>  • {fit(item, columns - 4)}</Text>)}
            {files.length > 0 && (
              <Text>
                <Text bold>바뀐 파일</Text>  <Text dimColor>{fit(files.join(', '), columns - 6)}</Text>
              </Text>
            )}
            {s.at > 0 && s.open.length > 0 && <Text bold>남은 일</Text>}
            {s.at > 0 && s.open.map(item => <Text color="warning">  • {fit(item, columns - 4)}</Text>)}
          </Box>
        )}
        {rule}

        {heading('diagram', '작업 그림')}
        {!f.diagram && (
          <Box flexDirection="column">
            {s.nodes.length === 0 && (
              <Text dimColor>{s.at > 0 ? '그릴 코드 작업이 아직 없어요.' : '요약을 갱신하면 함께 그려요.'}</Text>
            )}
            {layout(s.nodes, s.edges, body).map(line => (
              <Text>
                {line.map(seg =>
                  seg.tone === undefined ? (
                    seg.text
                  ) : (
                    <Text color={seg.tone === 'new' ? 'success' : seg.tone === 'changed' ? 'warning' : undefined} dimColor={seg.tone === 'dim'}>
                      {seg.text}
                    </Text>
                  ),
                )}
              </Text>
            ))}
            {s.nodes.some(node => node.status !== 'other') && (
              <Text dimColor>
                <Text color="success">새로 만듦</Text> · <Text color="warning">고침</Text>
              </Text>
            )}
          </Box>
        )}
        {rule}

        {heading('log', '로그', ` · 턴 ${st.turns}${st.startedAt > 0 ? ` · ${span(now - st.startedAt)}` : ''}`)}
        {!f.log && (
          <Box flexDirection="column">
            {shown.length === 0 && <Text dimColor>아직 기록이 없어요.</Text>}
            {shown.map(entry => {
              const isWorking = entry.status === 'working'
              const gist = entry.gist !== '' ? entry.gist : isWorking ? '답변 중…' : '요약하는 중…'
              const dot = isWorking ? '● ' : ''
              const time = `${clockTime(entry.at)} `
              const asked = fit(`나  ${entry.prompt}`, columns + 4 - cells(dot + time))

              return (
                <Box flexDirection="column">
                  <Button
                    key={`entry-${entry.id}`}
                    plain
                    label={`${dot}${time}${asked}`}
                    onPress={() =>
                      update($, folded, (cur): Folded => ({ ...cur, open: cur.open === entry.id ? '' : entry.id }))
                    }
                  >
                    {dot !== '' && <Text color="warning">{dot}</Text>}
                    <Text dimColor>{time}</Text>
                    {asked}
                  </Button>
                  <Text>
                    <Text dimColor>      ↳ </Text>
                    <Text color={entry.status === 'stopped' ? 'warning' : undefined}>{fit(gist, columns - 4)}</Text>
                  </Text>
                  {f.open === entry.id &&
                    entry.detail
                      .split('\n')
                      .filter(line => line !== '')
                      .map(line => <Text dimColor>        {fit(line, columns - 6)}</Text>)}
                </Box>
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
