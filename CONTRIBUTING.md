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

💡 `claude plugin test` may refuse to run inside a Claude Code session. If it does, run it with `CLAUDE_CONFIG_DIR` set to another config dir.

```sh
CLAUDE_CONFIG_DIR=$(mktemp -d) claude plugin test mods/<name>
```

Then run the repo tests from the repo root:

```sh
node --test test/*.test.mjs
cd cli && node --test
```

## 📦 Add a mod

- 📁 Put it in `mods/<name>/`
- 🧾 Add an entry to `.claude-plugin/marketplace.json`
- 📋 Add a row to the README table and notes to `docs/mods.md`
- 🌐 Add a site page at `site/mods/<name>/index.html`, with the version in its chip and its JSON-LD
- 🗂️ Add a row and a JSON-LD entry to `site/index.html`, and bump the "All N mods" and "See all N mods" counts across the site pages
- 🗺️ Add the page to `site/sitemap.xml`
- 📸 Add a screenshot to `images/` (and `site/images/` for the site page)
- 📏 A band mod (tagged `band`) copies `shared/bands.ts` to `mods/<name>/hooks/bands.ts`. The repo tests check this

## 🔢 Change a mod

Bump its version in its `plugin.json`, in `.claude-plugin/marketplace.json` and on its site page (chip and JSON-LD).

Gotchas: [docs/mods.md](docs/mods.md#-gotchas).

## 🏷️ Keep it in your own repo

Rather maintain your mod yourself? Publish it in your own marketplace and open a PR that adds both a row to [Community mods](README.md#-community-mods) and an entry to `community.json`. `test/community.test.mjs` checks the fields and that the two lists match.

## 🚀 Releasing the CLI

Bump `cli/package.json`'s version in a PR. When it merges to main, CI publishes it to npm. A version npm already has is skipped.
