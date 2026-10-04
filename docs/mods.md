# 📖 The mods in detail

- 🎥 Videos and screenshots: [demo.md](demo.md)
- 🏠 Overview: [README](../README.md)

## 🧭 How they behave

### 📏 Lines above the prompt

- token-weather, usage-meter, where-am-i, next-steps, agent-radar, browser-lanes, merge-gate, glance and session-saver each add one
- They stack
- Each hides when it has nothing to show

### 🙋 Guards ask before they block

- blast-radius, rulebook-guard and merge-gate stop a tool call and ask you
- **Saying no** (Cancel, Block it, Hold) refuses the call, and Claude gets the reason
- **Saying yes** (Proceed, Allow once, Merge anyway) runs it as written
- In auto mode the session waits for your answer, except blast-radius, which cancels on its own after a timeout (below)

## 🧩 Notes per mod

### 🛰️ mission-control

- Press `w` for Who, `c` for Code and `q` to close
- `/mission code` opens straight to the code map, `/mission who` to the agents
- Headless Chrome (`/Applications/Google Chrome.app`) draws the code map as an image, in a throwaway profile
- The Code view is macOS only and needs a terminal that shows images (Ghostty, kitty, iTerm2)
- A file glows blue while Claude reads it, orange while it edits it, and turns green with a check once changed
- One Haiku call after each turn writes the line under each changed file

### 🌦️ token-weather

- Levels go by percent of the window, so a 1M window stays Clear until 250k tokens
- `❄ cache 4:15` is about how long the prompt cache stays warm. It counts down from the end of the last model request, and every request restarts it, tool steps included
- Prompt before it runs out and the cached prefix gets reused, which is cheaper and faster
- The countdown is an estimate from timing, not read from the API. A model switch or /compact starts a fresh cache
- Shows after the first request, hides again after /clear, and is the first part dropped on a narrow terminal
- Plain while more than a minute is left, yellow under a minute, `cache cold` in dim red at zero (the cache has probably expired)
- Detects the cache lifetime from Claude's responses. After each turn it reads the last response's usage in the session transcript. 1-hour cache writes mean `1h`, 5-minute writes mean `5m`, and a pure cache hit keeps the last value. Until the first detection it uses the last session's value, or `5m`
- Set `cacheTtl` to `5m` or `1h` to override (default `auto`). Change it in `/config`, or in `settings.json` under `pluginConfigs["token-weather"].options`

### 📍 where-am-i

- Makes one Haiku call after each turn to write the summary
- `/where` gives a few bullets instead

### ➡️ next-steps

- After each turn, shows 2 or 3 short prompts you'd likely send next, like `next:  1 run the tests you just wrote  ·  2 open a draft PR  ·  0 dismiss`
- **Keys** (only while the prompt is empty): `1`, `2` or `3` puts that prompt in the box as a draft. Edit it or press Enter, nothing sends on its own. `0` hides the list
- Digits typed after other text, and pasted ones, go in as usual. To start a prompt with a digit while the list shows, press `0` first
- Hidden while Claude works or a survey is open
- The list clears when you send a prompt (slash commands too) or a new turn starts
- Makes one Haiku call after each turn. Skips it for short replies, and for a turn that ends while background agents still run
- While the list shows, where-am-i leaves out its own "next" part, so you don't see two. When there's no list, where-am-i's "next" is back

### 💰 usage-meter

- One line: your plan's 5-hour and 7-day usage as small bars, when the 5-hour window resets, and what the session has cost
- Reads the same figures as the status line and updates as your usage changes
- A window past its reset time hides until the next reading
- Green under 75%, yellow from 75%, red from 90%, plus one toast per window each time it passes 90%
- Without a subscription it shows only the cost
- Narrow terminals drop the 7d part first, then the cost

### 📡 agent-radar

- A finished agent shows a check for 30 seconds, then its line goes away
- A toast says when each one finishes
- `/radar` lists every agent this session
- In the pane, `1` to `9` open that agent's messages, `b` goes back, `c` clears finished agents and `q` closes

### 🌐 browser-lanes

- **Setup:** run the Playwright MCP server with `--isolated`
- Without it, every session shares one Chrome profile and the second one gets "Browser is already in use"

```sh
claude mcp add playwright --scope user -- npx @playwright/mcp@latest --isolated
```

- `/browser clean` lists the browsers other sessions left open and closes the ones you pick
- It closes Chrome only, never a Claude session
- When a browser call fails with "already in use", it offers to close the blocking browser and retries
- The session's own browser closes when the session ends
- Subagents in one session take turns. A second one's browser call waits until the first is done (closed it, finished, or idle 90 s), for up to 5 minutes
- Screenshots get the name of the agent that took them, like `login-test-03.png`

### 🚦 merge-gate

- **Needs** `gh` and the Codex CLI
- Holds `gh pr merge` until CI is green and Codex reviewed the PR once
- If either is missing, it asks you: **Hold** or **Merge anyway**
- With no one to answer, it holds
- Refuses a `codex review` that doesn't set `-c 'model="gpt-5.6-luna"'`. Reviews run on this one fixed model, so change it in `hooks/register.tsx` to yours
- Refuses a second review of the same PR
- The PR is the one checked out where the review runs. `cd <worktree> && codex review ...` counts for that worktree's PR, or its branch before it has a PR
- Refuses any `codex exec`
- The three checks read only commands the shell would run, including `bash -c '...'` and `eval`
- They ignore quoted arguments, heredocs, grep patterns and `#` comments that only mention a command
- Refuses any review while `~/.codex/config.toml` points at a local Ollama server
- A review counts when it starts, so a quota error doesn't buy a retry
- `/gate rerun` reruns the failed CI jobs

### 📏 rulebook-guard

- Rewrites em dashes in `.md`, `.mdx`, `.markdown` and `.txt` writes, commit messages, PR text and Slack posts (code files are left alone)
- Asks before `git commit --amend`
- Asks before a `git push` with files that `ruff format` or Prettier would change
- Asks before an email address or phone number goes into `~/notes`, memory files, `CLAUDE.md` files or a commit
- The rules are plain code in `hooks/register.ts`, so change them to match yours

### 💥 blast-radius

- Holds `rm -r`, `git push --force` and migrations (prisma, supabase, drizzle-kit, rails, alembic)
- Lists the files and size an `rm` would delete. `~` and `$HOME` are expanded; a path with any other shell variable shows "can't preview" instead of a guess
- Lists the remote commits a force push would drop
- No answer in 60 s cancels the command
- Claude gets the reason, so an auto-mode or unattended session keeps going
- The pane counts down (`auto-cancels in 42 s`). It never runs the command on its own
- Set `timeoutSeconds` to change the wait (`0` waits forever). Change it in `/config`, or in `settings.json` under `pluginConfigs["blast-radius"].options`
- In a session with no screen attached (a plain `claude -p` run, or an SDK host that draws nothing) it cancels at once, since nobody can answer
- One command is held at a time. A second one waits its turn, then gets its own full countdown

### 💾 session-saver

- **Needs** [unpause](https://github.com/hamzafer/unpause)
- Run `/park` before you close, then `unpause open <name>`
- `/park <note>` adds your own note, shown under the summary on resume
- The note shows until you type
- Untitled sessions get a name after their second turn

### 👀 glance

- **Needs** `gh`, plus the claude.ai Google Calendar, Linear and Slack connectors. A source that's missing just stays off the line
- One item per source, the most urgent one, with "+2" for the rest:
  - 📅 the meeting on now, or the next one (skips all-day events, ones you declined, and blocks over 3 hours already running)
  - 🔀 a review asked of you, then your PR with failing CI, then one with changes requested
  - 📋 your Linear issues In Progress or In Review, last touched first
  - 💬 DMs and channel @mentions from people (no bots) in the last 2 hours. Slack's connector can't see what you've read
- Slack has no "mentions me" filter, so glance looks up your Slack user id once and searches for it. The id stays in memory, nothing else from your profile is read
- On a narrow terminal it shrinks Slack first, then Linear and PRs, and the meeting last
- Fetches at start, then every 5 minutes. Connector calls cost no model tokens
- The meeting countdown moves each minute without a fetch
- A source that stops answering keeps its last answer, dimmed
- `/glance` refreshes and lists everything behind the line

### 🎬 replay-theater

- Run `/replay` after a turn that edited files
- `n` and `p` step, `q` closes

### 📝 md-preview

- When Claude edits a `.md`, `.mdx` or `.markdown` file, a toast says so (once per file per turn). This includes files written by shell commands. In a turn where Claude runs one, md-preview compares the repo's Markdown files before the first command and at the end of the turn
- `/md` opens a pane on the latest one, `/md <path>` on any file
- `/md compare <a> <b>` shows two files side by side under their names, for picking between option A and option B
- `/md open` (or `o` in the pane) opens the rendered page full size in your browser, from a temp file with working links
- Keys: `n`/`p` next and previous file, `b` before and after side by side (stacked when the pane is narrow), `o` browser, `r` render again, `t` page or text view, `q` close. The arrow keys scroll
- It draws again when the file you're looking at changes
- A green bar marks the blocks the last edit changed
- **Renderer, best first:**
  1. GitHub's own renderer through `gh api /markdown`, when the file is in a repo with a GitHub remote and `gh` is signed in
  2. A small built-in renderer, when `gh` is missing, signed out or offline
  3. A text view, without Chrome or a terminal that shows images
- `/mdview` does the same, in case a built-in ever takes `/md`
- The rendered view needs Google Chrome or Chromium and a terminal that shows images (Ghostty, kitty, iTerm2, WezTerm), not through tmux. Built and tested on macOS. Headless Chrome draws it in a throwaway profile
- Scripts in the Markdown never run. The page allows only its own script, and the built-in renderer drops script tags, event handlers and `javascript:` links
- **Privacy:** with the GitHub renderer, the file's text goes to GitHub's API under your own `gh` login. Nothing else is sent anywhere. Images the file links to on the web load in that Chrome, the same as on GitHub

### 📱🐍 reels and snake

- Installing them changes nothing until you type `/reels` or `/snake`
- `stop` turns them off again
- Reels needs Playwright once, and `/reels` prints the install command
- `/reels login` opens a YouTube window to accept cookies or sign in. Close it, then run `/reels`
- In the reels pane, `j` is next, `k` previous, `m` mute and `x` stop

## 🛠️ Build your own

Start from [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/). The validate and test commands and the new-mod checklist are in [CONTRIBUTING.md](../CONTRIBUTING.md).

### 🪤 Gotchas

- JSX compiles to `h(...)`, so a variable named `h` breaks every element after it
- Claude Code refuses a command name it already has, like `/agents` or `/recap`. Catch the error from `$.command.register`, or the rest of `session.start` never runs
- Add `.catch()` to background work you don't await, or the tests fail at teardown
- Check what the shell runs, not quoted text. A heredoc that mentions `git commit --amend` is not an amend
