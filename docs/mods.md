# The mods in detail

How the mods behave, setup notes for each one, screenshots, and how to build your own. The overview is in the [README](../README.md).

## How they behave

**Lines above the prompt.** token-weather, where-am-i, agent-radar, browser-lanes, merge-gate, oneform-line and session-saver each add a line there. They stack, and each one hides when it has nothing to show.

**Guards ask before they block.** blast-radius, rulebook-guard and merge-gate stop a tool call and ask you. Saying no refuses the call, and Claude gets the reason. Saying yes runs it as written. In auto mode the session waits for your answer.

## Notes per mod


**mission-control.** Press `w` for Who and `c` for Code. The code map is a picture drawn by headless Chrome (`/Applications/Google Chrome.app`) in a throwaway profile of its own, so it needs Chrome and a terminal that shows images, like Ghostty, kitty or iTerm2. A file glows blue while Claude reads it and orange while it edits it, and turns green with a check once changed. One Haiku call after each turn writes the line under each changed file.

**token-weather.** The levels go by percent of the window. On a 1M window it stays Clear until 250k tokens.

**where-am-i.** Makes one Haiku call after each turn to write the summary. `/where` gives a few bullets instead.

**agent-radar.** A finished agent shows a check for 30 seconds, then its line goes away. A toast says when each one finishes. `/radar` lists every agent this session, and its number opens that agent's messages.

**browser-lanes.** Run the Playwright MCP server with `--isolated`, or every session shares one Chrome profile and the second one gets "Browser is already in use":

```sh
claude mcp add playwright --scope user -- npx @playwright/mcp@latest --isolated
```

`/browser clean` lists the browsers other sessions left open and closes the ones you pick. It closes Chrome only, never a Claude session. When a browser call fails with "already in use", it offers to close the blocking browser and retries. The session's own browser closes when the session ends. Screenshots get the name of the agent that took them, like `login-test-03.png`.

**merge-gate.** Needs `gh`. It refuses a `codex review` that doesn't set `-c 'model="gpt-5.6-luna"'`, a second review of the same PR, any `codex exec`, and any review while `~/.codex/config.toml` points at a local Ollama server. A review counts when it starts, so a quota error doesn't buy a retry. `/gate rerun` reruns the failed CI jobs.

**rulebook-guard.** Rewrites em dashes in `.md` and `.txt` writes, commit messages, PR text and Slack posts. Code files are left alone. It asks before `git commit --amend`, before a `git push` with files that `ruff format` or Prettier would change, and before an email address or phone number goes into `~/notes`, memory files or a commit. The rules are plain code in `hooks/register.ts`, so change them to match yours.

**blast-radius.** Holds `rm -r`, `git push --force` and migrations (prisma, supabase, drizzle-kit, rails, alembic). It lists the files and size an `rm` would delete, or the remote commits a force push would drop.

**session-saver.** Needs [unpause](https://github.com/hamzafer/unpause). Run `/park` before you close, then `unpause open <name>`, and the note shows until you type. Untitled sessions get a name after their second turn.

**oneform-line.** For OneForm, my own fitness coach app, so it's only useful if you run OneForm. Set `url` and `key` in `/config` (the key goes to secure storage). It calls `get_today` and `get_plan` when the session starts, then after a turn at most every 10 minutes (1 minute after a failure), so it doesn't fill OneForm's tool-call log. The URL has to be `https://`. It hides what isn't logged yet, shows targets you passed as "over", and keeps the last answer with an "as of" time when OneForm can't be reached. `/oneform` refreshes and prints the day: meals, training, check-in and the next 7 days.

**replay-theater.** Run `/replay` after a turn that edited files. `n` and `p` step, `q` closes.

**reels and snake.** Both are opt-in. Installing them changes nothing until you type `/reels` or `/snake`, and `stop` turns them off again. Reels needs Playwright once, and `/reels` prints the install command.

## Screenshots

**reels** plays Shorts while Claude works and pauses when it's done

![reels](reels-demo.gif)

**browser-lanes, token-weather and where-am-i** stacked above the prompt

![bands above the prompt](bands.png)

**blast-radius** holds an `rm -rf` and shows what it would delete

![blast-radius](blast-radius.png)

**rulebook-guard** catches a `git commit --amend`

![rulebook-guard](rulebook-guard.png)

**replay-theater** steps through the last turn's edits

![replay-theater](replay-theater.png)

**where-am-i** with token-weather above it

![where-am-i](where-am-i.png)

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
