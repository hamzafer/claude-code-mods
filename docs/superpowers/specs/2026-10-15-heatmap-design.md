# heatmap: design

A GitHub-style activity grid of your Claude Code time, in a `/heatmap` pane.

## Goal

A new public mod people want to screenshot and share. It should be easy to recognize as Claude in a screenshot and not overlap any mod already in the gallery.

## Surface

- `/heatmap` opens a terminal pane (registered with `$.command.register`, opened with `$.ui.open`, like `replay-theater`).
- One toast at session start on streak milestones only: 7, 30 and 100 days (`🔥 30-day Claude streak · /heatmap`).
- No status line and no band.

## What a cell means

- One cell = one local calendar day (00:00 to 24:00, local time zone).
- Value = **active minutes**: the time between consecutive messages in a session, where a gap longer than 5 minutes adds nothing. A counted gap that crosses midnight is split between the two days.
- Levels: none `·`, then `< 15m`, `15-60m`, `1-3h` and `3h+`, drawn as `▪ ▪ ■ ■` in a ramp of Claude orange.
- Two square sizes carry the level along with the color, so no level depends on telling colors apart alone.
- The ramp follows the saved theme in `.claude.json`: a dark ramp (brighter is busier), a light ramp (darker is busier), and for Auto or an unreadable theme one ramp at a single lightness where only the saturation rises, so the order holds on any background. Block glyphs (`░▒▓█`) were tried and dropped: they fill the line height, so rows merge into stripes.

## Data

### Source

- Session logs: `<configDir>/projects/*/*.jsonl`, where `configDir` is `CLAUDE_CONFIG_DIR` or `~/.claude` (same lookup as `token-weather`).
- Each line's `timestamp` gives the activity times. The project folder gives the project name.

### Ledger

- Claude Code deletes logs after `cleanupPeriodDays` (default 30), so the mod keeps its own history.
- File: `<configDir>/heatmap/days.jsonl`, one row per day per project:
  `{"d":"2026-10-14","p":"claude-code-mods","min":192,"s":6}`
- **First run:** backfill every day found in the logs.
- **After that:** at session end, recompute today and yesterday from the logs and replace those rows. Rows for older days are never rewritten, so history survives the log cleanup.
- Opening the pane also refreshes today, so the grid is current mid-session.
- A malformed ledger line is skipped, not fatal. If the ledger is missing, the next open backfills again.

## Layout

```
Heatmap · all projects                       [p] this repo

      Jun        Jul        Aug        Sep        Oct
Mon ·░▒▓█░░▒▒▓░░░▒▓██▒░░▒▓▓█...
Wed ·▒▓█▓░▒░▒▓█▒░▒▓█▓▒░▒▓▓█...
Fri ·░▒▓░░░▒▓▓░░░▒▓█░▒░▒▓█...
        less · ░ ▒ ▓ █ more

🔥 12-day streak · best 31      412h active · 1,204 sessions
peak: Tue · 22:00

mods       ███████ 41%
oneform    ████    22%
notes      ██       9%

Tue 14 Oct · 3h 12m · 6 sessions · top: mods
←↑↓→ move · p scope · q close
```

- **Range:** as many recent weeks as fit the pane width, up to 52, ending in the current week.
- **Rows:** 7 weekdays, Monday first; labels on Mon, Wed, Fri.
- **Month labels:** fixed English short names (no `Intl`, so output is the same on every machine).

## Stats

All stats are for the current scope. Streaks count over every day in the ledger; the rest over the weeks shown.

- **Streak:** current and best, in days. Any active minute keeps a day alive. If today has no activity yet, the streak counts up to yesterday.
- **Totals:** active hours and session count.
- **Peak:** busiest weekday and busiest hour (24-hour time).
- **Top projects:** top 3 by minutes, with a proportional bar and a percentage. Real names are always shown (all-projects scope only).

## Keys

- `← ↑ ↓ →`: move the day cursor (starts on today). The detail line shows that day's minutes, sessions and top project. The grid is a `Client`, which gets keys once clicked (Esc gives them back), as in `snake`.
- `p`: switch between all projects and the current repo.
- `q`: close.

## Out of scope

- Browser export, sharing images, range keys, and a privacy toggle for names.

## Testing

- Unit tests for the pure parts: active-minute math (gap rule, midnight split), streaks (gaps, today with no activity), ledger merge (older days never rewritten), and week fitting per width.
- Fixture logs in `tests/`, with no real data.
- `claude plugin validate mods/heatmap` and `claude plugin test mods/heatmap`.

## Ship checklist

- `mods/heatmap/`, a marketplace entry, a README row, and notes in `docs/mods.md`.
- A site page in `site/mods/`, plus an index row, JSON-LD and a sitemap entry.
- A screenshot from **sample data** with generic project names, cropped to the pane.
- A Sonnet review plus one Codex pass. The owner approves the merge, then v0.6.0.
