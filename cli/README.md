# claude-code-mods

Pick the Claude Code mods you want from one checklist.

```sh
npx claude-code-mods
```

Tick the mods you want, see what each one adds, and press Enter to install. Untick a mod to disable it (its settings stay). Restart Claude Code after.

## Flags

- `--pick a,b` turns on exactly these mods (`--pick ""` turns all off)
- `--project` installs and toggles for this project only
- `--dry-run` prints the `claude` commands instead of running them
- `--help` shows usage

## Notes

- It shells out to the `claude` CLI (`claude plugin ...`), so Claude Code must be installed.
- Needs Node 18+.
- Mods and docs: https://github.com/hamzafer/claude-code-mods
