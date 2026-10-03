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

Setup and details for each mod are in [docs/mods.md](docs/mods.md).

## How they behave

**Lines above the prompt.** token-weather, where-am-i, agent-radar, browser-lanes, merge-gate, oneform-line and session-saver each add a line there. They stack, and each one hides when it has nothing to show.

**Guards ask before they block.** blast-radius, rulebook-guard and merge-gate stop a tool call and ask you. Saying no refuses the call, and Claude gets the reason. Saying yes runs it as written. In auto mode the session waits for your answer.

## Screenshots

**reels** plays Shorts while Claude works and pauses when it's done

![reels](docs/reels-demo.gif)

**browser-lanes, token-weather and where-am-i** stacked above the prompt

![bands above the prompt](docs/bands.png)

**blast-radius** holds an `rm -rf` and shows what it would delete

![blast-radius](docs/blast-radius.png)

**rulebook-guard** catches a `git commit --amend`

![rulebook-guard](docs/rulebook-guard.png)

**replay-theater** steps through the last turn's edits

![replay-theater](docs/replay-theater.png)

**where-am-i** with token-weather above it

![where-am-i](docs/where-am-i.png)

## Build your own

Start from [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/). Check a mod with:

```sh
claude plugin validate mods/<name>
claude plugin test mods/<name>
```

Things that bit us while building these:

- `claude plugin test` can refuse inside a running session. Run it with `CLAUDE_CONFIG_DIR` set to another config.
- JSX compiles to `h(...)`, so a variable named `h` breaks every element after it.
- Claude Code refuses a command name it already has, like `/agents` or `/recap`. Catch the error from `$.command.register`, or the rest of `session.start` never runs.
- Add `.catch()` to background work you don't await, or the tests fail at teardown.
- Check what the shell runs, not quoted text. A heredoc that mentions `git commit --amend` is not an amend.
