# Install

Back to the [README](../README.md).

```sh
npx claude-code-mods@latest
```

Tick the mods you want in a checklist, see what each one adds, and press Enter to install. Untick a mod to disable it (its settings stay). Restart Claude Code after. `@latest` makes npx skip an old cached copy.

- `--project` installs for this project only
- `--dry-run` prints the `claude` commands instead of running them
- `--pick a,b` turns on exactly these mods, no checklist (`--pick ""` turns all off)
- `--yes-community` installs picked community mods without asking (outside a terminal they are skipped without it)
- `--help` shows usage

It edits the Claude profile that `claude` uses here, shown at the top. For another profile, set it first: `CLAUDE_CONFIG_DIR=~/.claude-other npx claude-code-mods@latest`.

## Order your bands

Press `o` in the checklist to order your bands (the lines above the prompt). Move the cursor with up/down or `j`/`k`, move a band with Shift+up/down or `K`/`J`, and press Enter to save. Esc goes back without saving. The order goes to `<config dir>/claude-code-mods/bands.json`, where the config dir is `CLAUDE_CONFIG_DIR` or `~/.claude`. Restart Claude Code to apply it. Bands not in the file sit on top.

## Other ways

By hand:

```sh
claude plugin marketplace add hamzafer/claude-code-mods
claude plugin install context-bar@claude-code-mods
```

To try one without installing:

```sh
git clone https://github.com/hamzafer/claude-code-mods && cd claude-code-mods
claude --plugin-dir mods/context-bar
```

> **Needs** Claude Code 2.1.287+. A few mods need more (Chrome, `gh`, a connector); [the mod list](mods.md#-all-mods) says which.
