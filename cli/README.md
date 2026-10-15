# claude-code-mods

Pick the Claude Code mods you want from one checklist.

```sh
npx claude-code-mods@latest
```

Tick the mods you want, see what each one adds, and press Enter to install. Untick a mod to disable it (its settings stay). Restart Claude Code after.

## Flags

- `--pick a,b` turns on exactly these mods (`--pick ""` turns all off)
- `--project` installs and toggles for this project only
- `--dry-run` prints the `claude` commands instead of running them
- `--help` shows usage

It edits the Claude profile that `claude` uses here, shown at the top. For another profile, set it first: `CLAUDE_CONFIG_DIR=~/.claude-other npx claude-code-mods@latest`.

## Order your bands

Press `o` in the checklist to order your bands (the lines above the prompt). Move the cursor with up/down or `j`/`k`, move a band with Shift+up/down or `K`/`J`, and press Enter to save. Esc goes back without saving. The order goes to `<config dir>/claude-code-mods/bands.json`, where the config dir is `CLAUDE_CONFIG_DIR` or `~/.claude`. Restart Claude Code to apply it. Bands not in the file sit on top.

## Notes

- It shells out to the `claude` CLI (`claude plugin ...`), so Claude Code must be installed.
- Needs Node 18+.
- Mods and docs: https://github.com/hamzafer/claude-code-mods
