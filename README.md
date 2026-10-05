# 🛰️ Claude Code mods

[![MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/hamzafer/claude-code-mods/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hamzafer/claude-code-mods/actions/workflows/ci.yml)

**A collection of mods that make Claude Code show what it's doing: live lines above the prompt, guards, panes and games.**

Mods add live UI to Claude Code. Install only the ones you want. [What are mods?](https://claude.dev/blog/getting-started-with-claude-code-mods/)

| | | |
| :---: | :---: | :---: |
| [<img src="images/context-bar.png" alt="context-bar" width="280">](docs/mods.md#-context-bar)<br>📊 **context-bar**<br>what fills your context | [<img src="images/review-watch.png" alt="review-watch" width="280">](docs/mods.md#-review-watch)<br>🔍 **review-watch**<br>running code reviews, live | [<img src="images/md-preview.png" alt="md-preview" width="280">](docs/mods.md#-md-preview)<br>📝 **md-preview**<br>Markdown rendered like GitHub |
| [<img src="images/blast-radius.png" alt="blast-radius" width="280">](docs/mods.md#-blast-radius)<br>💥 **blast-radius**<br>see what `rm -rf` would delete | [<img src="images/replay-theater.png" alt="replay-theater" width="280">](docs/mods.md#-replay-theater)<br>🎬 **replay-theater**<br>step through the last turn's edits | [<img src="images/reels-demo.gif" alt="reels" width="280">](docs/mods.md#-reels-and-snake)<br>📱 **reels**<br>Shorts while Claude works |
| [<img src="images/where-am-i.png" alt="where-am-i" width="280">](docs/mods.md#-where-am-i)<br>📍 **where-am-i**<br>goal, now, waiting on you | [<img src="images/bands.png" alt="lines above the prompt" width="280">](docs/mods.md#-lines-above-the-prompt)<br>🌦️ **token-weather** and friends<br>lines above the prompt | [<img src="images/mission-control.gif" alt="mission-control" width="280">](#mission-control)<br>🛰️ **mission-control**<br>agents and the code they touch |
| [<img src="images/prayer-times.png" alt="prayer-times" width="280">](docs/mods.md#-prayer-times)<br>🕌 **prayer-times**<br>the current prayer and time left | | |

## 🚀 Install any mod

```sh
claude plugin marketplace add hamzafer/claude-code-mods
claude plugin install context-bar@claude-code-mods
```

Swap `context-bar` for any mod below, then restart Claude Code. Or try one without installing:

```sh
git clone https://github.com/hamzafer/claude-code-mods && cd claude-code-mods
claude --plugin-dir mods/context-bar
```

> **Needs** Claude Code 2.1.287+. A few mods need more (Chrome, `gh`, a connector); the tables say which.

## 🧩 The mods

### 👀 See what's happening

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 🛰️ | **mission-control** | Live map of agents, tool calls and the code they touch | `/mission` |
| 📊 | **context-bar** | Your context window as one stacked bar, a color per category, with token counts and where it compacts | `/context-bar` |
| 🌦️ | **token-weather** | Context fill from Clear to Compact soon, plus a prompt-cache countdown | |
| 📍 | **where-am-i** | Goal, doing now, waiting on you, next step | `/where` |
| ➡️ | **next-steps** | 2 or 3 likely next prompts after each turn, one key to draft one | `1` `2` `3`, `0` hides |
| 💰 | **usage-meter** | 5-hour and 7-day plan usage, the reset countdown and the session's cost | |
| 📡 | **agent-radar** | One live line per running subagent | `/radar` |
| 🔍 | **review-watch** | One live line per running code review (Codex or a review subagent) with the model, target, elapsed time and Codex's latest output. A toast lists the findings when it ends | |
| 🌐 | **browser-lanes** | Whether this session has a browser, and who holds it | `/browser` |
| 🕌 | **prayer-times** | The current prayer and how long is left, the next one, and zawal. Computed on your computer, Hanafi or standard Asr | `/prayers` |
| 🎬 | **replay-theater** | Steps through the last turn's edits, one diff at a time | `/replay` |
| 📝 | **md-preview** | Renders the Markdown files Claude edits like GitHub does, with before and after side by side. Needs Chrome and a terminal that shows images | `/md` |

### 🛡️ Guard your repo

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 💥 | **blast-radius** | Holds `rm -r`, force pushes and migrations, shows what they'd delete, cancels after 60 s with no answer | |

### 🔧 My setup (fork and adapt)

These are built around my own tools and rules. Fork them and change the rules to yours.

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 👀 | **glance** | One line with what needs you: next meeting, PRs, Linear issues, Slack DMs. Needs `gh` and the Google Calendar, Linear and Slack connectors | `/glance` |
| 🚦 | **merge-gate** | Holds `gh pr merge` until CI is green and Codex reviewed once. Needs `gh` and the Codex CLI. Reviews run on one fixed model; change it to yours | `/gate` |
| 📏 | **rulebook-guard** | Enforces my writing and git rules: rewrites em dashes, asks before `--amend`, unformatted pushes, emails and phone numbers in notes | |
| 💾 | **session-saver** | Saves where you left off, shows it on resume. Needs [unpause](https://github.com/hamzafer/unpause) | `/park [note]` |

### 🎮 For fun (opt-in)

| | Mod | What it does | Command |
| --- | --- | --- | --- |
| 📱 | **reels** | YouTube Shorts while Claude works, pauses when it's done | `/reels` |
| 🐍 | **snake** | Snake while Claude works | `/snake` |

<a id="mission-control"></a>

## 🛰️ Flagship: mission-control

Every subagent, every tool call and every file they touch, in a pane next to the chat. Shown at 4x: two subagents building a logout feature across four files.

![mission-control at 4x: two subagents and a logout feature landing across four files](images/mission-control.gif)

Install it like any mod, restart, and type `/mission` (or `/mission code` to open the code map). `q` closes it.

- 🤖 `w` shows the agents and every tool call, live
- 🗺️ `c` shows the code map, with import arrows
- 🔵 **Blue** while the agent reads a file
- 🟠 **Orange** while it writes
- 🟢 **Green** when done, with one line on what changed

> The Code view also needs macOS, Google Chrome and a terminal that shows images (Ghostty, kitty, iTerm2). The Who view works everywhere.

## 📚 More

- 📖 [**docs/mods.md**](docs/mods.md): how they behave, setup notes and build your own
- 🎥 [**docs/demo.md**](docs/demo.md): videos and screenshots
- ⭐ Earlier project: [**cursor-commands**](https://github.com/hamzafer/cursor-commands) [![stars](https://img.shields.io/github/stars/hamzafer/cursor-commands?style=social)](https://github.com/hamzafer/cursor-commands), 600+ stars for Cursor slash commands
- 🤝 [**CONTRIBUTING.md**](CONTRIBUTING.md): add your own mod
