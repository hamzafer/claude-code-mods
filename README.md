# Claude Code mods

See what your agent is reading and writing, live. mission-control draws every subagent, every tool call and every file they touch, in a pane next to the chat.

![mission-control at 4x: two subagents and a logout feature landing across four files](docs/mission-control.gif)

## Try mission-control

You need Claude Code 2.1.287 or later, Google Chrome, and a terminal that shows images, like Ghostty, kitty or iTerm2.

```sh
claude plugin marketplace add hamzafer/claude-code-mods
claude plugin install mission-control@claude-code-mods
```

Restart Claude Code and type `/mission`. It opens on the agents. Press `c` for the code map and `w` to go back.

A file glows blue while the agent reads it and orange while it writes, then turns green. After each turn, one line under it says what changed.

## Install the others

Same two commands, with the mod's name in place of `mission-control`. To try one without installing:

```sh
claude --plugin-dir mods/token-weather
```

Prev: [**cursor-commands**](https://github.com/hamzafer/cursor-commands) [![stars](https://img.shields.io/github/stars/hamzafer/cursor-commands?style=social)](https://github.com/hamzafer/cursor-commands), 600+ ⭐ for Cursor slash commands.

## The mods

| Mod | What it does | Command |
| --- | --- | --- |
| **mission-control** | A live map of the turn: main, its subagents and every tool call (Who), and a rendered diagram of the files they touch, with import arrows and a line on each change (Code). | `/mission`, `/mission code` |
| **token-weather** | Shows how full the context window is, from Clear to Compact soon, with tokens used and the last turn's growth. | |
| **where-am-i** | Shows the goal, what Claude is doing now, what it waits on from you, and the next step. | `/where` |
| **agent-radar** | One live line per running subagent with its time, tool count and current action. | `/radar` |
| **browser-lanes** | Says whether this session has a Playwright browser, and who holds it if not. | `/browser`, `/browser clean` |
| **merge-gate** | Holds `gh pr merge` until CI is green and Codex reviewed the PR once. Shows the PR's status above the prompt. Opinionated: built around one Codex review on `gpt-5.6-luna`. | `/gate`, `/gate rerun` |
| **oneform-line** | Your OneForm day above the prompt: sleep, protein and calories left, today's training and the next planned session. | `/oneform` |
| **rulebook-guard** | Swaps em dashes for commas in prose, and asks before `--amend`, an unformatted push, or personal info in notes. | |
| **blast-radius** | Holds `rm -r`, force pushes and migrations, and shows what they would delete or overwrite. | |
| **session-saver** | Saves where you left off and shows it when you resume. Names untitled sessions. | `/park [note]` |
| **replay-theater** | Steps through the last turn's file edits, one diff at a time. | `/replay` |
| **reels** | YouTube Shorts in a pane. Plays while Claude works, pauses when it's done. Nothing starts until `/reels`. | `/reels`, `/reels stop` |
| **snake** | Snake in a pane while Claude works. Pauses when Claude is done. Nothing opens until `/snake`. | `/snake`, `/snake stop` |

How they behave, setup notes and how to build your own: [docs/mods.md](docs/mods.md). Videos and screenshots: [docs/demo.md](docs/demo.md).
