# 🤝 Contributing

## 🧪 Try a mod locally

```sh
claude --plugin-dir mods/<name>
```

## ✅ Check it

```sh
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

💡 `claude plugin test` can refuse inside a running Claude Code session. If it does, run it with `CLAUDE_CONFIG_DIR` set to another config dir.

```sh
CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin test mods/<name>
```

## 📦 Add or change a mod

- 📁 Put it in `mods/<name>/`
- 🧾 Add an entry to `.claude-plugin/marketplace.json`
- 📋 Add a row to the README table and notes to `docs/mods.md`
- 🔢 Changed a mod? Bump its version in its `plugin.json` and in `.claude-plugin/marketplace.json`

Gotchas: [Build your own](docs/mods.md#build-your-own).
