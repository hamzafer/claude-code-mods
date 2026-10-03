# 🤝 Contributing

Want to add a mod? Welcome.

## 🧪 Try a mod locally

```sh
claude --plugin-dir mods/<name>
```

## ✅ Check it

```sh
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

## 📦 Add a new mod

- 📁 Put it in `mods/<name>/`
- 🧾 Add an entry to `.claude-plugin/marketplace.json`
- 📋 Add a row to the README table and notes to `docs/mods.md`

Step by step: [Build your own](docs/mods.md#build-your-own).
