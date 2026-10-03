# 📖 The mods in detail

- 🎥 Videos and screenshots: [demo.md](demo.md)
- 🏠 Overview: [README](../README.md)

## 🧭 How they behave

### 📏 Lines above the prompt

- token-weather, where-am-i, agent-radar, browser-lanes, merge-gate, oneform-line and session-saver each add one
- They stack
- Each hides when it has nothing to show (oneform-line stays once it's set up)

### 🙋 Guards ask before they block

- blast-radius, rulebook-guard and merge-gate stop a tool call and ask you
- **Saying no** (Cancel, Block it, Hold) refuses the call, and Claude gets the reason
- **Saying yes** (Proceed, Allow once, Merge anyway) runs it as written
- In auto mode the session waits for your answer

## 🧩 Notes per mod

### 🛰️ mission-control

- Press `w` for Who and `c` for Code
- Headless Chrome (`/Applications/Google Chrome.app`) draws the code map as an image, in a throwaway profile
- The Code view is macOS only
- A file glows blue while Claude reads it, orange while it edits it, and turns green with a check once changed
- One Haiku call after each turn writes the line under each changed file

### 🌦️ token-weather

- Levels go by percent of the window, so a 1M window stays Clear until 250k tokens

### 📍 where-am-i

- Makes one Haiku call after each turn to write the summary
- `/where` gives a few bullets instead

### 📡 agent-radar

- A finished agent shows a check for 30 seconds, then its line goes away
- A toast says when each one finishes
- `/radar` lists every agent this session, and its number opens that agent's messages

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
- Screenshots get the name of the agent that took them, like `login-test-03.png`

### 🚦 merge-gate

- **Needs** `gh` and the Codex CLI
- Holds `gh pr merge` until CI is green and Codex reviewed the PR once, then asks you: **Hold** or **Merge anyway**
- With no one to answer, it holds
- Refuses a `codex review` that doesn't set `-c 'model="gpt-5.6-luna"'`
- Refuses a second review of the same PR
- Refuses any `codex exec`
- All three checks look only at commands the shell would run (including `bash -c '...'` and `eval`); text that only mentions one (a quoted argument, a heredoc, a grep pattern, a `#` comment) passes
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
- Lists the files and size an `rm` would delete
- Lists the remote commits a force push would drop

### 💾 session-saver

- **Needs** [unpause](https://github.com/hamzafer/unpause)
- Run `/park` before you close, then `unpause open <name>`
- The note shows until you type
- Untitled sessions get a name after their second turn

### 🏋️ oneform-line

- Needs a OneForm account
- **Marketplace install:** Claude Code asks for `url` and `key` and keeps the key in secure storage
- **Loaded from a folder:** set them in `settings.json` under `pluginConfigs["oneform-line"].options`
- The URL has to be `https://`
- Calls `get_today` and `get_plan` when the session starts, then after a turn at most every 10 minutes
- After a failure it retries in 1 minute, and the slow pace keeps OneForm's tool-call log short
- Once set up the line is always there: what isn't logged yet says so, targets you passed show as "over"
- When OneForm can't be reached, it keeps the last answer with an "as of" time
- `/oneform` refreshes and prints the day: meals, training, check-in and the next 7 days

### 🎬 replay-theater

- Run `/replay` after a turn that edited files
- `n` and `p` step, `q` closes

### 📝 md-preview

- When Claude edits a `.md`, `.mdx` or `.markdown` file, a toast says so (once per file per turn)
- `/md` opens a pane on the latest one, `/md <path>` on any file
- Keys: `n`/`p` next and previous file, `r` render again, `t` page or text view, `q` close. The arrow keys scroll
- It draws again when the file you're looking at changes
- A green bar marks the blocks the last edit changed
- **Renderer, best first:**
  1. GitHub's own renderer through `gh api /markdown`, when the file is in a repo with a GitHub remote and `gh` is signed in
  2. A small built-in renderer, when `gh` is missing, signed out or offline
  3. A text view, without Chrome or a terminal that shows images
- The rendered view needs macOS, Google Chrome and a terminal that shows images (Ghostty, kitty, iTerm2, WezTerm; not through tmux). Headless Chrome draws it in a throwaway profile
- **Privacy:** with the GitHub renderer, the file's text goes to GitHub's API under your own `gh` login. Nothing else is sent anywhere. Images the file links to on the web load in that Chrome, the same as on GitHub

### 📱🐍 reels and snake

- Installing them changes nothing until you type `/reels` or `/snake`
- `stop` turns them off again
- Reels needs Playwright once, and `/reels` prints the install command

## 🛠️ Build your own

Start from [Getting started with Claude Code mods](https://claude.dev/blog/getting-started-with-claude-code-mods/). The validate and test commands and the new-mod checklist are in [CONTRIBUTING.md](../CONTRIBUTING.md).

### 🪤 Gotchas

- JSX compiles to `h(...)`, so a variable named `h` breaks every element after it.
- Claude Code refuses a command name it already has, like `/agents` or `/recap`. Catch the error from `$.command.register`, or the rest of `session.start` never runs.
- Add `.catch()` to background work you don't await, or the tests fail at teardown.
- Check what the shell runs, not quoted text. A heredoc that mentions `git commit --amend` is not an amend.
