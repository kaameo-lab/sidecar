# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`sidecar` is a Claude Code **mod** (a plugin with a TypeScript hooks module, not a skill/MCP plugin). It adds a side pane, opened with `/sidecar` or automatically when an answer contains options, that shows:

1. **선택지**: buttons for the a/b/c options or `Q1 - …` questions in Claude's last answer. Pressing one submits the answer as the user's own prompt.
2. **요약**: session goal, decisions and open items, plus the files changed this session.
3. **작업 그림**: a box-drawing diagram of the files/modules the session touched.
4. **로그**: one row per main-loop turn with a Haiku-written gist.

The UI text and model prompts are Korean. There is no package.json and no build step. The host binary provides the `claude-code` and `claude-code/testing` modules.

## Commands

```sh
claude plugin test          # runs every *.test.ts(x) under the folder; exits 1 on failure
claude plugin validate .    # checks .claude-plugin/plugin.json and hooks/hooks.json
```

The repo is also its own marketplace (`kaameo-lab`, `.claude-plugin/marketplace.json`, `"source": "./"`), so users install with `claude plugin install sidecar@kaameo-lab`. To release, bump `version` in both `plugin.json` and `marketplace.json`, commit, then `claude plugin tag .` and push the tag.

`claude plugin test` takes only a folder and has no option to pick one test by name. All tests are in `tests/sidecar.test.tsx`. `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the host generates and which is not checked in.

## Architecture

- `hooks/hooks.json` names a single module, `hooks/register.tsx`, which exports `register: Register`. Everything is wired there with `on(event, [filter], handler)`. Handlers are middleware: they call `next(e)` and return its result.
- **State** is held in five `atom`s (`view`, `log`, `summary`, `stats`, `folded`) and read/written with `read($, atom)` and `update($, atom, fn)`. Their types live in `types/index.d.ts`, which also adds them to `PluginState` in the `claude-code` module. Each atom has a `shape` tag such as `'view-3'`. **Bump the tag whenever you change that type's fields.** Stored state survives a reload, and the tag is what makes the mod decline a value an older version stored. It does not survive the process, so `save` also writes every atom but `view` to `$.store` under `session:<id>` (the latest `SESSIONS_KEPT` sessions, listed newest first under `sessions`), and `restore` reads it back at `session.start` in a fresh process, as after `claude --resume` (a reload finds the atoms still held and keeps them). A restored session keeps its `files` but settles a new git base. A `/resume` inside the process raises no `session.start` and is not restored: its pane starts empty. `SAVED_SHAPE` repeats the four atoms' tags: change it with them.
- **Event flow**:
  - `session.start`: restores the session's saved snapshot when there is one, then records where git's work tree stood (`git stash create`, else HEAD) as `stats.base`, and the files git didn't track then as `stats.untracked`. An interactive session also opens the pane.
  - `turn.start`: adds a log entry, but only for the main loop (`e.agentId === undefined`).
  - `turn.complete`: parses the answer with `parseQuestions` first, then `parseNumbered`, and falls back to `parseChoices`. It sets `view.phase`, opens the pane when options were found, starts `sweep` without waiting for it (adds what git sees changed since `stats.base` to `stats.files`, settling a base first when there was none; `refresh` awaits it before summarising), starts `describe` (Haiku gist via `$.model.complete`) without waiting for it, and every `SUMMARY_EVERY` turns starts `refresh` (`$.model.fork` with a JSON summary prompt) the same way.
  - `session.end`: saves the snapshot once more, under `e.sessionId`. A turn's end (after its `sweep`) and a finished `refresh` save it too. On a `/clear` or a `/resume` (`reason` `'clear'` or `'resume'`), which go on in the same process under another id with no `session.start`, it then empties every atom but `folded`, so the next save cannot write this conversation under that id, and bumps `epoch`, so a `refresh` or `sweep` begun before drops its result.
  - `tool.call` for Edit, Write and NotebookEdit: records the changed paths in `stats.files`.
  - `prompt.submit`: separates the plugin's own submissions (`origin.kind === 'plugin'`) from the user's typing.
  - `ui.render` (`component: 'Pane'`): draws the whole pane from atom state every time. Components come from `$.ui.resolve(e)`, and `Input` is optional because some surfaces don't have it.
- **Pure modules**: these hold no state and can be tested without the engine.
  - `hooks/parse.ts`: finds the options and Q-blocks in markdown. Lists inside code fences are skipped. A numbered list only counts when there's a `?` nearby, or the line right before it offers it ("중에서", "골라", "방법은 두 가지", …) and is not a steps heading. When there are several lists, the last one wins. With no list, lettered headings (`**A. …**`, `### B. …`) each over a paragraph count when the answer's last lines ask to pick; numbered headings do not, since reports number their sections. `parseNumbered` takes a closing numbered list whose every item asks (`?`) as items `1번`, `2번`, answered as `1번: …`.
  - `hooks/digest.ts`: the gist and summary prompts, and lenient parsing of what the model returns (it slices JSON out of surrounding prose).
  - `hooks/diagram.ts`: ranks the graph by longest path and draws box rows joined by a junction bus. If a rank is wider than the pane, it switches to a tree view.
  - `hooks/width.ts`: `cells`/`fit`. Hangul, CJK and emoji count as two terminal cells.
- **Terminal width matters everywhere.** Truncate with `fit()`, not `.slice()`. Keep `cells()` widths in mind. Frame diagrams with box-drawing characters only, because glyphs like ● or ▼ take one cell in some terminals and two in others (see the header of `diagram.ts`).

## Tests

Tests use `test`, `expect` and `mock` from `claude-code/testing`. An engine test gets `($, on)`. It stubs host events with `on('turn.complete' | 'model.complete' | 'model.fork' | 'ui.open' | …, handler)`. A stub for a call on `$` (`process.run`, `command.register`, `model.fork`, …) answers `{ value: … }`; one that answers otherwise makes the plugin's hook skip silently. Tests drive turns through `$.turn.start` and `$.turn.complete`, and mount the pane with `$.ui.mount({ ...PANE, surface })`. Buttons are found and pressed by their React `key` (`choice-b`, `pick-Q3-a`, `edit-Q2` and the field it opens, `answer-Q2`, `send-all`, `refresh`, …), so a key rename breaks tests. UI tests run once per surface (`terminal`, `desktop`).

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `docs/GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
