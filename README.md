# 🛰️ Claude Code mods

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**See what your agent is reading and writing, live.**

mission-control draws every subagent, every tool call and every file they touch, in a pane next to the chat.

![mission-control at 4x: two subagents and a logout feature landing across four files](images/mission-control.gif)

## 🚀 Try mission-control

```sh
claude plugin marketplace add hamzafer/claude-code-mods
claude plugin install mission-control@claude-code-mods
```

Restart Claude Code and type `/mission`.

- 🤖 **`w` Who:** main agent, its subagents and every tool call, live
- 🗺️ **`c` Code:** a map of the files they touch, with import arrows
- 🔵 **Blue** while the agent reads a file
- 🟠 **Orange** while it writes
- 🟢 **Green** when done, with one line on what changed

> **Needs** Claude Code 2.1.287+, Google Chrome, and a terminal that shows images (Ghostty, kitty, iTerm2).

## 🧩 The mods

### 👀 See what's happening

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 🛰️ | **mission-control** | Live map of agents, tool calls and the code they touch | `/mission` |
| 🌦️ | **token-weather** | How full the context is, from Clear to Compact soon | |
| 📍 | **where-am-i** | Goal, doing now, waiting on you, next step | `/where` |
| 📡 | **agent-radar** | One live line per running subagent | `/radar` |
| 🌐 | **browser-lanes** | Is this session attached to a browser, and who holds it | `/browser` |
| 🏋️ | **oneform-line** | Your OneForm day: sleep, protein, calories, training | `/oneform` |

### 🛡️ Guard your repo

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 💥 | **blast-radius** | Holds `rm -r`, force pushes and migrations, shows what they'd delete | |
| 📏 | **rulebook-guard** | Fixes em dashes, asks before `--amend`, unformatted pushes, personal info | |
| 🚦 | **merge-gate** | Holds `gh pr merge` until CI is green and Codex reviewed once | `/gate` |

### 🧠 Pick up where you left off

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 💾 | **session-saver** | Saves where you left off, shows it on resume | `/park` |
| 🎬 | **replay-theater** | Steps through the last turn's edits, one diff at a time | `/replay` |

### 🎮 For fun (opt-in)

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 📱 | **reels** | YouTube Shorts while Claude works, pauses when it's done | `/reels` |
| 🐍 | **snake** | Snake while Claude works | `/snake` |

## 📦 Install any mod

Same two commands, with the mod's name in place of `mission-control`. Or try one without installing:

```sh
claude --plugin-dir mods/token-weather
```

## 📚 More

- 📖 [**docs/mods.md**](docs/mods.md): how they behave, setup notes, build your own
- 🎥 [**docs/demo.md**](docs/demo.md): videos and screenshots
- ⭐ Prev: [**cursor-commands**](https://github.com/hamzafer/cursor-commands) [![stars](https://img.shields.io/github/stars/hamzafer/cursor-commands?style=social)](https://github.com/hamzafer/cursor-commands), 600+ stars for Cursor slash commands
- 🤝 [**CONTRIBUTING.md**](CONTRIBUTING.md): add your own mod
