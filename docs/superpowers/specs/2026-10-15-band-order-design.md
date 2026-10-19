# Band order: choose which band sits where above the prompt

Status: approved, 2026-10-15

## Problem

Band mods (the lines and boxes above the prompt) stack in whatever order Claude Code loads the plugins. There is no priority API, and some mods draw the bands of others above their own while some draw them below. With a few bands on, the one you look at most can end up far from the prompt, and there is no way to move it.

## Goal

Pick the order of your bands once, in the `claude-code-mods` checklist, and every band mod follows it from the next session on.

Out of scope: live reload without a restart, a `/bands` command inside Claude Code.

## The order file

`<configDir>/claude-code-mods/bands.json`, where `configDir` is `CLAUDE_CONFIG_DIR` (trailing slashes removed) or `$HOME/.claude`, the same lookup heatmap and token-weather use.

```json
{ "order": ["where-am-i", "context-bar", "token-weather"] }
```

- Names are mod names, top to bottom (the last one sits right above the prompt).
- Unknown names are ignored. A missing file, unreadable JSON, or an `order` that is not an array of strings means "no order": today's behavior.
- One file per profile, shared by user and project scope.

## Mod side: the shared helper

Every mod tagged `band` in `.claude-plugin/marketplace.json` (18 today) ships the same small file, `hooks/bands.ts`. Plugins cannot share code at runtime, so it is copied. The canonical copy lives at `shared/bands.ts`; a repo test fails if any band mod's copy differs, or if a band-tagged mod has no copy.

What it does, in the mod's `ui.render` hook for `AbovePrompt`:

1. The mod draws its own band as before.
2. The helper wraps it in a Box keyed `band:<mod name>`.
3. It takes what `next(e)` returned (`rest`). If `rest` is the column another band mod's helper returned (a Box keyed `bands`), its children are unpacked; anything else is one item.
4. It adds its own keyed band where the mod drew it before (above or below `rest`), so with no order file the screen looks the same as today.
5. It sorts and returns one column, a Box keyed `bands`, flex direction column:
   - untagged items (other people's mods, the engine's own content) first, in their order;
   - then bands not in the order file, in their current relative order (on top, farthest from the prompt);
   - then bands in the order file, in file order.
6. When the mod has nothing to draw, it returns `rest` unchanged, as today.

Attribution: the engine stamps each hook's returned root with `part: { plugin }`. When the helper unpacks a `bands` column whose `part` names a plugin, and that plugin's band item has no `part` of its own, the stamp moves onto that band item, so each band keeps its owner (buttons, hover) after re-parenting.

Reading the file: once per session, on the first render, cached in the mod (restart to apply). Any error reading or parsing means no order. Claude Code (2.1.288, the minimum CI pins) only follows `$` into functions declared in the same file, so the helper is pure: each mod has a small same-file `readBandOrder($)` that calls `$.env.get`, `$.fs.exists` and `$.fs.read` and hands the text to the helper. No new permissions.

Shape:

```ts
export function bandsFile(configDir?: string, home?: string): string | undefined
export function parseOrder(text: string): string[]           // [] on any error
export function stackBands(rest, name, mine, at: 'above' | 'below', order: string[]): RenderElement
```

blast-radius is a special case: while it holds a command it takes the whole band (it returns its own prompt and drops `rest`) until answered. That stays, wrapped by the helper so the key is there; when idle it returns `rest` as today.

Each changed mod gets a patch version bump in its `plugin.json` and the matching `.claude-plugin/marketplace.json` entry.

Known limit: a third-party mod that wraps `rest` inside its own Box hides the bands inside it from the sort; they stay together as one untagged item.

## CLI side: the Band order screen

In the checklist, `o` opens **Band order**:

```
  Band order · ~/.claude-work
  top
  ▸ where-am-i
    context-bar
    token-weather
  ── your prompt ──
  ↑↓ move · ⇧↑ ⇧↓ or K J reorder · enter save · esc back
```

- Lists the ticked mods tagged `band`, top to bottom, pre-filled from the existing order file the way the mods read it: bands not in the file on top (in catalog order), then the listed ones in file order.
- `↑`/`↓` (and `k`/`j`) move the cursor; `Shift+↑`/`Shift+↓` (and `K`/`J`) move the band under the cursor.
- `Enter` saves `bands.json` in the profile the header shows (creating the folder), returns to the checklist, and shows "Saved. Restart Claude Code to apply." in the detail box.
- `Esc` (or `q`) returns without saving.
- No ticked bands: `o` shows "Tick a band mod first." and stays on the checklist.
- `--dry-run`: Enter writes nothing; it shows the path and JSON it would write in the detail box, and prints them again after the checklist exits.
- Saving keeps names in the existing file that are not ticked now (appended after, so unticking and ticking a band later keeps its place).

CLI version goes to 0.2.0. The new release is published by the owner, not by this work.

## Docs

A short "Order your bands" note in the README, `docs/mods.md`, and `cli/README.md`. No screenshots.

## Testing

- Helper: unit tests for unpacking, keeping untagged items first, unlisted bands on top, file order, `part` carry, unknown names, broken files (in one mod's `tests/`, run by `claude plugin test`).
- Every band mod: its existing tests pass; one render test checks its band carries the `band:<name>` key.
- Repo test: copies identical to `shared/bands.ts`, run in CI.
- CLI: reducer, render and save tests with `node --test`; a pty run of the order screen with `--dry-run`.
- Manual: two band mods in a real Claude Code session in a pty show in the saved order.
