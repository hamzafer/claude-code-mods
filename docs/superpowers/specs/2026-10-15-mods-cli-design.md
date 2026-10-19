# mods-cli: design

`npx claude-code-mods`: a terminal checklist, run outside Claude Code, that installs, enables, disables and configures the mods in this repo.

## Goal

Installing mods today means one `claude plugin install` per mod, or a loop that installs 12 at once. That loop is too much: people end up disabling everything. The checklist lets you pick only the mods you want, see what each one adds before you pick it, and change your mind later without remembering commands.

## Surface

```
$ npx claude-code-mods

  claude-code-mods · everywhere (user scope)

  See what's happening
  ◉ context-bar     Your context window as one stacked bar
▸ ◯ where-am-i      Goal, doing now, waiting on you, next step
  ◯ heatmap         A GitHub-style grid of your Claude Code time
  ...
  My setup (fork and adapt)
  ◯ merge-gate      Holds gh pr merge until CI and Codex  needs gh, codex

  ── where-am-i ─────────────────────────────────────────
  Adds: a line above the prompt, a command
  Goal, doing now, waiting on you, next step.
  ↑↓ move · space pick · p preview · enter apply · q quit
```

- A plain Node script. No dependencies, no build step, Node 18 or newer (built-in `fetch`, `node:test`).
- Published to npm as `claude-code-mods` with one `bin` of the same name. Lives in `cli/`.
- Publishing to npm is a separate, manual step. This work does not publish.

## Flags

| Flag | Meaning |
| --- | --- |
| (none) | Interactive checklist, user scope (every project). |
| `--project` | Same, but installs and toggles in project scope for the current directory. |
| `--dry-run` | Print the `claude` commands Apply would run instead of running them. |
| `--pick a,b` | Skip the checklist: treat exactly these mods as ticked. For scripts and tests. |
| `--help` | Usage. |

Unknown flags print usage and exit 1. Unknown names in `--pick` exit 1 and name them.

## The mod list

- Read live from `https://raw.githubusercontent.com/hamzafer/claude-code-mods/main/.claude-plugin/marketplace.json`, with a 3 s timeout.
- Fallback when offline or the fetch fails: a copy bundled into the npm package at pack time (`prepack` copies the repo's marketplace.json into `cli/`; the copy is git-ignored). Run from a clone, the fallback is the repo's own `.claude-plugin/marketplace.json`.
- New mods appear without a new npm release.

### New marketplace fields

| Field | Type | Meaning |
| --- | --- | --- |
| `category` | string | The README group: `See what's happening`, `Guard your repo`, `Spend less`, `My setup (fork and adapt)`, `For fun`. Known to Claude Code's schema. |
| `tags` | string[] | What it adds to your screen, from: `band` (a line above the prompt), `pane`, `statusline`, `guard` (holds or rewrites tool calls), `toast`, `command`. Known to the schema. |
| `needs` | string[] | Tools or accounts it needs, e.g. `gh`, `codex`, `node`, `unpause`, `macOS`, `Chrome`, `Spotify`, `OpenAI Admin key`. Unknown to the schema: `claude plugin validate` warns and passes. |

Groups show in the README's order. A mod with no `category` lands in a last group, `Other`.

## Current state

- `claude plugin list --json` gives every installed plugin: `id` (`name@marketplace`), `scope`, `enabled`.
- Only ids ending in `@claude-code-mods` count.
- A mod opens ticked when it is installed **and** enabled in the chosen scope (user, or project/local for `--project`). First run: nothing installed, nothing ticked.
- If the `claude` command is missing, exit 1 with "Install Claude Code first".

## Apply

On Enter (or straight away with `--pick`), compare ticked against current state and run, in order:

1. Only when something will be installed or enabled: `claude plugin marketplace add hamzafer/claude-code-mods` if `claude plugin marketplace list --json` has no `claude-code-mods`, otherwise `claude plugin marketplace update claude-code-mods`. A stale clone would install old versions.
2. Ticked and not installed: `claude plugin install <name>@claude-code-mods --scope <scope>`.
3. Ticked, installed, disabled: `claude plugin enable <name>@claude-code-mods --scope <scope>`.
4. Unticked, installed, enabled: `claude plugin disable <name>@claude-code-mods --scope <scope>`. Never uninstall: saved options and keys stay. Only mods in the current catalog are disabled; an installed mod that left the catalog is left alone.
5. Options (below), for each newly installed mod that has any.
6. Print a summary (`✓ installed context-bar`, `✓ disabled token-weather`, `✗ ... (error)`) and "Restart Claude Code to load your mods."

Nothing changed: print "Nothing to change." and exit 0. A failed command is reported and the rest still run; exit 1 at the end if any failed.

`--dry-run` prints each command as one shell line (`claude plugin install where-am-i@claude-code-mods --scope user`) and runs none. Options are listed one line per new mod as `would ask <name>: opt1, opt2`.

## Options

- A mod's options come from `userConfig` in its `plugin.json`: read from the raw GitHub URL first (it matches the live list), falling back to the marketplace clone (`installLocation` from `claude plugin marketplace list --json`, plus the plugin's `source` path) when offline.
- For each option, one prompt line: title, description dimmed, default pre-filled. Enter keeps the default (or leaves it unset). `sensitive: true` options echo `*`.
- Type checks before saving: `number` within `min`/`max`, `boolean` as y/n, `options` must be one of the list. A bad value asks again.
- Saved with `claude plugin configure <id> --values-stdin`, given a JSON object of single-line strings. Only answered options are sent.
- Skipped when not a TTY.

## Checklist keys

| Key | Action |
| --- | --- |
| ↑ ↓, k j | Move. Group headers are skipped. |
| space | Tick or untick. |
| p | Open the screenshot. |
| enter | Apply. |
| q, esc, ctrl-c | Quit without changes. |

- The list scrolls to keep the cursor visible when it is taller than the terminal.
- The detail box under the list shows the highlighted mod's `tags` in words ("a line above the prompt, a pane") and its full description.
- Ticked count in the header: `3 picked`.
- Not a TTY and no `--pick`: print the grouped list and exit 1 with "Run in a terminal, or pass --pick".

## Needs

- Mods with `needs` show them dimmed after the description: `needs gh, codex`.
- Checked on tick: `gh`, `codex`, `node`, `unpause` are looked up on `PATH`; `macOS` checks the platform. Others are shown only.
- A missing one shows a warning in the detail box (`gh not found: merge-gate won't work until you install it`). It does not block the tick.

## Preview

- `p` looks for `images/<name>.png`, then `.gif`, in the repo on GitHub (HEAD request).
- Found: open the URL with `open` (macOS), `xdg-open` (Linux) or `start` (Windows).
- Not found: the detail box says "No image yet".

## Code layout

| Module | Job |
| --- | --- |
| `bin.js` | Parse flags, wire the rest, exit codes. |
| `catalog.js` | Load and normalize the mod list, group by category. |
| `claude.js` | The only place that runs `claude`. One `run(args, {input})` function, swappable in tests. |
| `plan.js` | Pure: catalog + state + ticks + scope → actions → shell lines. |
| `checklist.js` | Pure state and keys → new state; render state → string. A thin raw-mode loop drives it. |
| `options.js` | Read `userConfig`, prompt, validate, save. |
| `needs.js`, `preview.js` | Tool checks; screenshot lookup and open. |

Tests use `node --test` with a fake `claude` runner and fixture JSON. CI gets a `cli` job running them.

## README

The Install section leads with `npx claude-code-mods` and keeps the manual `claude plugin install` lines as the fallback. The bulk-install loop goes.

## Out of scope

- Reordering the bands above the prompt. Mods have no shared order today; this needs its own design.
- Images inside the terminal.
- Uninstalling from the checklist.
- Publishing to npm.
