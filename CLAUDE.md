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

`claude plugin test` takes only a folder and has no option to pick one test by name. All tests are in `tests/sidecar.test.tsx`. `tsconfig.json` extends `.claude-plugin/types/tsconfig.json`, which the host generates and which is not checked in.

## Architecture

- `hooks/hooks.json` names a single module, `hooks/register.tsx`, which exports `register: Register`. Everything is wired there with `on(event, [filter], handler)`. Handlers are middleware: they call `next(e)` and return its result.
- **State** is held in five `atom`s (`view`, `log`, `summary`, `stats`, `folded`) and read/written with `read($, atom)` and `update($, atom, fn)`. Their types live in `types/index.d.ts`, which also adds them to `PluginState` in the `claude-code` module. Each atom has a `shape` tag such as `'view-3'`. **Bump the tag whenever you change that type's fields.** Stored state survives a reload, and the tag is what makes the mod decline a value an older version stored.
- **Event flow**:
  - `turn.start`: adds a log entry, but only for the main loop (`e.agentId === undefined`).
  - `turn.complete`: parses the answer with `parseQuestions` first and falls back to `parseChoices`. It sets `view.phase`, opens the pane when options were found, starts `describe` (Haiku gist via `$.model.complete`) without waiting for it, and every `SUMMARY_EVERY` turns starts `refresh` (`$.model.fork` with a JSON summary prompt) the same way.
  - `tool.call` for Edit, Write and NotebookEdit: records the changed paths in `stats.files`.
  - `prompt.submit`: separates the plugin's own submissions (`origin.kind === 'plugin'`) from the user's typing.
  - `ui.render` (`component: 'Pane'`): draws the whole pane from atom state every time. Components come from `$.ui.resolve(e)`, and `Input` is optional because some surfaces don't have it.
- **Pure modules**: these hold no state and can be tested without the engine.
  - `hooks/parse.ts`: finds the options and Q-blocks in markdown. Lists inside code fences are skipped. A numbered list only counts when there's a `?` nearby. When there are several lists, the last one wins.
  - `hooks/digest.ts`: the gist and summary prompts, and lenient parsing of what the model returns (it slices JSON out of surrounding prose).
  - `hooks/diagram.ts`: ranks the graph by longest path and draws box rows joined by a junction bus. If a rank is wider than the pane, it switches to a tree view.
  - `hooks/width.ts`: `cells`/`fit`. Hangul, CJK and emoji count as two terminal cells.
- **Terminal width matters everywhere.** Truncate with `fit()`, not `.slice()`. Keep `cells()` widths in mind. Frame diagrams with box-drawing characters only, because glyphs like ● or ▼ take one cell in some terminals and two in others (see the header of `diagram.ts`).

## Tests

Tests use `test`, `expect` and `mock` from `claude-code/testing`. An engine test gets `($, on)`. It stubs host events with `on('turn.complete' | 'model.complete' | 'model.fork' | 'ui.open' | …, handler)`, drives turns through `$.turn.start` and `$.turn.complete`, and mounts the pane with `$.ui.mount({ ...PANE, surface })`. Buttons are found and pressed by their React `key` (`choice-b`, `pick-Q3-a`, `send-all`, `refresh`, …), so a key rename breaks tests. UI tests run once per surface (`terminal`, `desktop`).

## Agent skills

### Issue tracker

Issues live in this repo's GitHub Issues, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `docs/GLOSSARY.md` and `docs/adr/`. See `docs/agents/domain.md`.
