# 📖 The mods in detail

- 🎥 Videos and screenshots: [demo.md](demo.md)
- 🏠 Overview: [README](../README.md)

## 🧭 How they behave

### 📏 Lines above the prompt

Most mods add a live line above the Claude Code prompt, like extra status lines.

![Several Claude Code mods stacked as live lines above the prompt](../images/bands.png)

- context-bar, token-weather, usage-meter, where-am-i, next-steps, agent-radar, review-watch, prayer-times, browser-lanes, merge-gate, glance, session-saver and now-playing each add one
- They stack
- Each hides when it has nothing to show

### 🙋 Guards ask before they block

- blast-radius, rulebook-guard and merge-gate stop a tool call and ask you
- **Saying no** (Cancel, Block it, Hold) refuses the call, and Claude gets the reason
- **Saying yes** (Proceed, Allow once, Merge anyway) runs it as written
- In auto mode the session waits for your answer, except blast-radius, which cancels on its own after a timeout (below)

## 🧩 Notes per mod

### 🛰️ mission-control

Shows every Claude Code subagent, tool call and touched file in a live pane.

![mission-control: Claude Code subagents and a code map of the files they edit](../images/mission-control.gif)

- Press `w` for Who, `c` for Code and `q` to close
- `/mission code` opens straight to the code map, `/mission who` to the agents
- Headless Chrome (`/Applications/Google Chrome.app`) draws the code map as an image, in a throwaway profile
- The Code view is macOS only and needs a terminal that shows images (Ghostty, kitty, iTerm2)
- A file glows blue while Claude reads it, orange while it edits it, and turns green with a check once changed
- One Haiku call after each turn writes the line under each changed file

### 📊 context-bar

Shows what fills the Claude Code context window, as one stacked bar.

![context-bar: Claude Code context window usage as a stacked bar with a legend](../images/context-bar.png)

- One bar the width of the band, split by what fills the window: system prompt, tools, MCP tools, memory files, skills, messages, then free space and the compaction buffer. Each used category gets its own color, messages in orange. Free space is a thin grey line (`─`), and the compaction buffer is hatched (`░`)
- The header shows the tokens in use, the window, where auto-compaction runs, and the percent. The percent turns yellow at 70% of the compaction point and red at 90%
- The legend lists each category's tokens and share of the window. Tool schemas loaded on demand are left out, as `/context` leaves them out of its grid
- It refreshes after each of the main agent's turns and after a compaction, from the same breakdown `/context` draws, estimated locally (no extra API calls)
- `/context-bar` hides or shows it. The choice is kept across sessions
- Pairs with token-weather: that one tracks the trend and the cache, this one shows what the tokens are

### 🌦️ token-weather

Shows how full the Claude Code context window is, and how long the prompt cache stays warm.

- Levels go by percent of the window, so a 1M window stays Clear until 250k tokens
- `❄ cache 4:15` estimates how long the prompt cache stays warm. It counts down from the end of the last model request. Every request restarts it, including tool steps
- Send a prompt before it hits zero and the cached prefix is reused, billed at the cache-read rate
- The countdown is an estimate from timing, not read from the API. A model switch or /compact starts a fresh cache
- Shows after the first request, hides again after /clear, and is the first part dropped on a narrow terminal
- Plain while more than a minute is left, yellow under a minute, `cache cold` in dim red at zero (the cache has probably expired)
- Reads the cache lifetime from the last response's usage in the session transcript, after each turn. 1-hour cache writes mean `1h`. 5-minute writes mean `5m`. A pure cache hit keeps the last value. Before the first reading it uses the last session's value, or `5m`
- Set `cacheTtl` to `5m` or `1h` to override (default `auto`). Change it in `/config`, or in `settings.json` under `pluginConfigs["token-weather"].options`

### 📍 where-am-i

Shows the session goal, what Claude Code is doing now and what waits on you.

![where-am-i: goal, current step and next step above the Claude Code prompt](../images/where-am-i.png)

- Makes one Haiku call after each turn to write the summary
- `/where` gives a few bullets instead

### ➡️ next-steps

Suggests the prompts you'd likely send Claude Code next.

- After each turn, shows 2 or 3 short prompts you'd likely send next, like `next:  1 run the tests you just wrote  ·  2 open a draft PR  ·  0 dismiss`
- **Keys** (only while the prompt is empty): `1`, `2` or `3` puts that prompt in the box as a draft. Edit it or press Enter, nothing sends on its own. `0` hides the list
- Digits typed after other text, and pasted ones, go in as usual. To start a prompt with a digit while the list shows, press `0` first
- Hidden while Claude works or a survey is open
- The list clears when you send a prompt (slash commands too) or a new turn starts
- Makes one Haiku call after each turn. Skips it for short replies, and for a turn that ends while background agents still run
- where-am-i drops its own "next" part while the list shows, and restores it when the list clears

### 💰 usage-meter

Shows your Claude Code plan usage and session cost.

- One line: your plan's 5-hour and 7-day usage as small bars, when the 5-hour window resets, and what the session has cost
- Reads the same figures as the status line and updates as your usage changes
- A window past its reset time hides until the next reading
- Green under 75%, yellow from 75%, red from 90%, plus one toast per window each time it passes 90%
- Without a subscription it shows only the cost
- Narrow terminals drop the 7d part first, then the cost

### 📡 agent-radar

Shows one live line per running Claude Code subagent.

- A finished agent shows a check for 30 seconds, then its line goes away
- A toast says when each one finishes
- `/radar` lists every agent this session
- In the pane, `1` to `9` open that agent's messages, `b` goes back, `c` clears finished agents and `q` closes

### 🔀 switchboard

Runs each Claude Code subagent on the cheapest model that can do its job.

- Before a subagent starts, it picks Haiku, Sonnet or Opus for the task. A line above the prompt shows the switch: `⇄ find auth middleware  opus → haiku  jev 82%`
- **With a Jev key** it asks [Jev](https://docs.typesafe.ai), TypeSafe's routing model (about $0.00003 a pick). Set the key in `/config` (switchboard), or as `TYPESAFE_API_KEY`. If Jev doesn't answer within 2.5 s, the rules decide
- **Without a key** simple rules decide: Explore agents get Haiku, Plan agents get Opus, lookup tasks Haiku, hard tasks (security, architecture, root cause) Opus, everything else Sonnet
- If Jev is less than 50% sure, it shows the pick but keeps the model Claude asked for
- **Mode** in `/config`: `auto` (default) switches the model, `suggest` only shows the pick
- Forks always run on their parent's model, so it leaves them alone
- `/route` lists every pick with its reason, the model it ran on and what it cost. The total compares that with what the same tokens would have cost on the model Claude asked for, and shows what Jev cost
- Costs are estimates at API prices (as of 2026-09-25), not what your plan charges. `?` means not known yet
- **Privacy:** with a key, each spawn sends the task's description and its first 6,000 characters to api.typesafe.ai. Without one, nothing leaves your machine

### 🔍 review-watch

Shows the code reviews running in Claude Code, Codex or a review subagent, live.

![review-watch: a Codex review and a Claude Code review subagent running](../images/review-watch.png)

- Tracks every `codex review` shell command, in the foreground or background, and every subagent whose description says "review"
- Each line shows the model (from `-c model=...` or `--model`, else your `~/.codex/config.toml`), the `--title` or what's under review, and the elapsed time. Codex reviews also show the last line Codex printed
- When a review ends, a toast says so. For Codex it also counts the `[P1]`/`[P2]` findings. That works when the output goes to a file (`> review.txt`) or the review runs in the background
- A finished review shows a ✅ line for 30 s, then goes away
- If it can't read a Codex review's output (an error, a killed run, a `$VAR` path), the toast has no findings count. It never guesses "no findings"
- With agent-radar on too, a review subagent gets a toast from each mod
- Needs `ps` and `tail` (macOS and Linux have both)

### 🌐 browser-lanes

Gives each Claude Code session its own Playwright browser and shows who holds it.

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

A Claude Code hook that holds `gh pr merge` until CI and a Codex review pass.

- **Needs** `gh` and the Codex CLI
- Holds `gh pr merge` until CI is green and Codex reviewed the PR once
- If either is missing, it asks you: **Hold** or **Merge anyway**
- With no one to answer, it holds
- Refuses a `codex review` that doesn't set `-c 'model="gpt-5.6-luna"'`. Reviews run on this one fixed model, so change it in `hooks/register.tsx` to yours
- Refuses a second review of the same PR
- The PR is the one checked out where the review runs. `cd <worktree> && codex review ...` counts for that worktree's PR, or its branch before it has a PR
- Refuses any `codex exec`
- The model, second-review and `codex exec` checks look only at commands the shell would run, including `bash -c '...'` and `eval`
- They ignore quoted arguments, heredocs, grep patterns and `#` comments that only mention a command
- Refuses any review while `~/.codex/config.toml` points at a local Ollama server
- A review counts when it starts, so a quota error doesn't buy a retry
- `/gate rerun` reruns the failed CI jobs

### 📏 rulebook-guard

Claude Code hooks that enforce writing and git rules.

![rulebook-guard: a Claude Code hook asks before a rule is broken](../images/rulebook-guard.png)

- Rewrites em dashes in `.md`, `.mdx`, `.markdown` and `.txt` writes, commit messages, PR text and Slack posts (code files are left alone)
- Asks before `git commit --amend`
- Asks before a `git push` with files that `ruff format` or Prettier would change
- Asks before an email address or phone number goes into `~/notes`, memory files, `CLAUDE.md` files or a commit
- The rules are plain code in `hooks/register.ts`, so change them to match yours

### 💥 blast-radius

A Claude Code hook that holds risky commands and shows what they would delete.

![blast-radius: Claude Code holds rm -rf and lists the files and size it would delete](../images/blast-radius.png)

- Holds `rm -r`, `git push --force` and migrations (prisma, supabase, drizzle-kit, rails, alembic)
- Lists the files and size an `rm` would delete. It expands `~` and `$HOME`. A path with any other shell variable shows "can't preview" instead of a guess
- Lists the remote commits a force push would drop
- No answer in 60 s cancels the command
- Claude gets the reason, so an auto-mode or unattended session keeps going
- The pane counts down (`auto-cancels in 42 s`). It never runs the command on its own
- Set `timeoutSeconds` to change the wait (`0` waits forever). Change it in `/config`, or in `settings.json` under `pluginConfigs["blast-radius"].options`
- With no screen attached (a plain `claude -p` run, or an SDK host that draws nothing), it cancels at once. Nobody can answer
- One command is held at a time. A second one waits its turn, then gets its own full countdown

### 💾 session-saver

Saves where you left off in a Claude Code session and shows it on resume.

- **Needs** [unpause](https://github.com/hamzafer/unpause)
- Run `/park` before you close, then `unpause open <name>`
- `/park <note>` adds your own note, shown under the summary on resume
- The note shows until you type
- Untitled sessions get a name after their second turn

### 👀 glance

Shows what needs you in one line above the Claude Code prompt: meetings, PRs, issues and DMs.

- **Needs** `gh`, plus the claude.ai Google Calendar, Linear and Slack connectors. A source that's missing just stays off the line
- One item per source, the most urgent one, with "+2" for the rest:
  - 📅 the meeting on now, or the next one (skips all-day events, ones you declined, and blocks over 3 hours already running)
  - 🔀 a review asked of you, then your PR with failing CI, then one with changes requested
  - 📋 your Linear issues In Progress or In Review, last touched first
  - 💬 DMs and channel @mentions from people (no bots) in the last 2 hours. Slack's connector can't see what you've read
- Slack has no "mentions me" filter, so glance looks up your Slack user id once and searches for it. glance keeps the id in memory and reads nothing else from your profile
- On a narrow terminal it shrinks Slack first, then Linear and PRs, and the meeting last
- Fetches at start, then every 5 minutes. Connector calls cost no model tokens
- The meeting countdown moves each minute without a fetch
- A source that stops answering keeps its last answer, dimmed
- `/glance` refreshes and lists everything behind the line

### 🕌 prayer-times

Shows the current prayer, the time left and the next one in Claude Code.

![prayer-times: the current prayer and time left above the Claude Code prompt](../images/prayer-times.png)

- **Set it up:** your latitude and longitude in `/config` (prayer-times). They stay in your local settings. The times are computed on your computer from the sun's position, so nothing is sent anywhere
- In a prayer's time it shows that prayer and the time left to pray it, then the next prayer: `🕌 Asr · 1h 12m left · next Maghrib 19:08`. Under 20 minutes left turns yellow, and under 5 minutes it turns red
- Ends (Hanafi): Fajr at sunrise, Dhuhr when Asr begins, Asr at sunset, Maghrib when Isha begins, Isha at Fajr
- Red when not to pray: zawal before Dhuhr (`⛔ Zawal · no prayer for 4m`), the minutes after sunrise, and the last minutes before sunset. Before Dhuhr the line also says when zawal starts
- Settings:
  - Asr: `hanafi` (shadow twice an object's length) or `standard`
  - Fajr and Isha convention: `karachi`, `mwl`, `isna`, `egypt` or `makkah`
  - A rule for far north or south, where in summer the sun never gets low enough for Fajr or Isha
  - `adjust` to match your mosque or app to the minute, e.g. `asr+2 isha-5 fajr 1.5`. Adjusting Dhuhr moves its start, not zawal
- With no sunrise or sunset at all (polar day or night), it uses latitude 65° and marks the line as an estimate
- Daylight-saving days are handled: every time is computed as an exact moment, then shown on your clock
- Times are within a minute or two of online tables. Those often add a few minutes to Asr, which `adjust` can match
- A toast when each prayer begins (turn it off in `/config`). `/prayers` lists today's times
- A toast when a prayer's time is nearly over: `⏳ Dhuhr ends in 15 min (16:32)`. It comes once per prayer, also if you start a session in those last minutes. Set how many minutes before in `/config` (15 by default, 0 turns it off). For Asr it warns before the makruh minutes start: `⏳ Asr: makruh in 15 min (18:23), sunset 18:38`

### 🎬 replay-theater

Steps through the edits Claude Code made in the last turn, one diff at a time.

![replay-theater: one diff from the last Claude Code turn in a pane](../images/replay-theater.png)

- Run `/replay` after a turn that edited files
- The first turn with edits shows a toast. After that, the status line shows the last turn's count instead (`▶ /replay: 3 edits`)
- `n` and `p` step, `q` closes

### 📝 md-preview

Renders the Markdown files Claude Code edits, like GitHub does.

![md-preview: a Markdown diff on the left, the GitHub-style rendered page on the right](../images/md-preview.png)

- When Claude edits a `.md`, `.mdx` or `.markdown` file, a toast says so (once per file per turn). Files written by shell commands count too. If Claude runs a shell command, md-preview compares the repo's Markdown files before the first command and at the end of the turn
- `/md` opens a pane on the latest one, `/md <path>` on any file
- `/md compare <a> <b>` shows two files side by side under their names, for picking between option A and option B
- `/md open` (or `o` in the pane) opens the rendered page full size in your browser, from a temp file with working links
- Keys: `n`/`p` next and previous file, `b` before and after side by side (stacked when the pane is narrow), `o` browser, `r` render again, `t` page or text view, `q` close. The arrow keys scroll
- It draws again when the file you're looking at changes
- It renders the files Claude edits ahead, in the background when the turn ends, so `/md` opens fast. Pages it already drew are kept, so `n`/`p` back to a file is instant
- A green bar marks the blocks the last edit changed
- **Renderer, best first:**
  1. GitHub's own renderer through `gh api /markdown`, when the file is in a repo with a GitHub remote and `gh` is signed in
  2. A small built-in renderer, when `gh` is missing, signed out or offline
  3. A text view, without Chrome or a terminal that shows images
- `/mdview` does the same, in case a built-in ever takes `/md`
- The rendered view needs Google Chrome or Chromium and a terminal that shows images (Ghostty, kitty, iTerm2, WezTerm). It does not work through tmux. Built and tested on macOS. Headless Chrome draws the page in a throwaway profile
- Scripts in the Markdown never run. The page allows only its own script, and the built-in renderer drops script tags, event handlers and `javascript:` links
- **Privacy:** with the GitHub renderer, the file's text goes to GitHub's API under your own `gh` login. In a GitHub repo, that happens for every Markdown file Claude edits, in the background at the end of the turn, even if you never open `/md`. Nothing else is sent anywhere. Images the file links to on the web load in that Chrome, the same as on GitHub

### 🎵 now-playing

Shows Spotify's current track and lyrics in Claude Code.

![now-playing: the Spotify track, progress, buttons and the lyric line in Claude Code](../images/now-playing.png)

- **Needs** macOS and the Spotify desktop app. It reads Spotify through AppleScript, so there is nothing to log in to
- One line: `🎵 Track · Artist  ━━━━━━────── 1:51/3:14 · ♪ the lyric being sung`
- Paused, the line dims to the track and artist. Spotify closed, the line goes away. The mod never opens Spotify
- **Controls:** click ⏮ ⏸ ⏭ at the end of the line (Claude Code in fullscreen). Or press ctrl+x then Tab to reach the line, then `b` previous, `p` play or pause, `n` next, and Esc to go back. `/music`, `/music next` and `/music prev` work from the prompt anywhere
- The lyric gets its own line under the track, so the buttons never cut it. It shows a moment early and moves 4 times a second, so it keeps up with the singing
- On a narrow window the time is cut first, then the progress bar. The buttons stay
- Terminals can't draw right-to-left scripts (Urdu, Arabic, Persian, Hebrew) properly, so for those songs it looks for romanized lyrics instead. If there are none, the lyric line stays hidden
- **Without the keys**: `/music` plays or pauses, `/music next` and `/music prev` skip
- The first time, macOS asks once to let your terminal control Spotify (Automation). Allow it, or the line stays empty. To change it later: System Settings, Privacy & Security, Automation
- On Linux and Windows it does nothing: no line, no command, nothing runs
- It checks Spotify every 3 s while playing and every 5 s otherwise. The bar moves each second in between. When Spotify is closed it only runs a quick `pgrep`
- **Privacy:** for lyrics it sends the track, artist and album names to [LRCLIB](https://lrclib.net), once per track. Turn lyrics off in `/config` (now-playing) and nothing is sent. Songs without synced lyrics show no lyric

### 📱🐍 reels and snake

YouTube Shorts or a game of Snake in a Claude Code pane while it works.

- Installing them changes nothing until you type `/reels` or `/snake`
- `stop` turns them off again. For snake, typing `/snake` again does it too
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
