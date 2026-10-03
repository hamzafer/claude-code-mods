// md-preview: the Markdown files Claude edits, rendered like GitHub, in a pane.
//   A toast says when one changes; /md opens the pane on the latest one.
//   GitHub renders it (gh api /markdown) when the file is in a GitHub repo and gh is
//   signed in; a small built-in renderer does otherwise. Headless Chrome draws the
//   page to PNG for the terminal; without Chrome or an image terminal, a text view.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MdFile, MdFrame } from '../types'
import { changedChunks, parse, toHtml, toLines, withMarks } from './md'
import { page } from './page'

const PANE = 'md-preview'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const MD_FILE = /\.(md|mdx|markdown)$/i
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const CELL_PX = 9 // page pixels per terminal column
const ROW_PX = 19 // page pixels per terminal row
const PART_ROWS = 250 // an Image is at most 255 rows: taller pages come in parts
const MAX_FILES = 30
const GH_TIMEOUT_MS = 10_000

// Draws page.html into part-N.png, PART_ROWS rows each; prints "<rows> <parts>".
// Headless Chrome writes its output but does not always exit: wait for the file, then
// close that Chrome (its own throwaway profile, never the person's browser).
// $1 chrome  $2 page  $3 out dir  $4 profile  $5 width (css px)  $6 scale
export const SCRIPT = `c="$1"; pg="$2"; out="$3"; prof="$4"; w="$5"; sc="$6"
mkdir -p "$out"; rm -f "$out"/part-*.png "$out"/dom.html
stop() { sleep 0.2; pkill -P "$1" 2>/dev/null; kill "$1" 2>/dev/null; }
"$c" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check --user-data-dir="$prof" --window-size="$w,800" --dump-dom "file://$pg" >"$out/dom.html" 2>/dev/null & pid=$!
i=0; while ! grep -q '</html>' "$out/dom.html" 2>/dev/null && [ $i -lt 150 ]; do sleep 0.1; i=$((i+1)); done; stop $pid
hgt=$(sed -n 's/.*data-height="\\([0-9]*\\)".*/\\1/p' "$out/dom.html" | head -1)
[ -n "$hgt" ] || exit 2
rows=$(( (hgt + ${ROW_PX - 1}) / ${ROW_PX} )); [ $rows -gt 1500 ] && rows=1500
n=0; at=0
while [ $at -lt $rows ]; do
  r=$((rows - at)); [ $r -gt ${PART_ROWS} ] && r=${PART_ROWS}
  f="$out/part-$n.png"
  "$c" --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check --user-data-dir="$prof" --force-device-scale-factor="$sc" --window-size="$w,$((r * ${ROW_PX}))" --screenshot="$f" "file://$pg#$((at * ${ROW_PX}))" >/dev/null 2>&1 & pid=$!
  i=0; while [ ! -s "$f" ] && [ $i -lt 150 ]; do sleep 0.1; i=$((i+1)); done; stop $pid
  [ -s "$f" ] || exit 3
  n=$((n+1)); at=$((at + r))
done
echo "$rows $n"`

// Held by the host, so a hot reload keeps them.
const files = atom({ plugin: 'md-preview', key: 'files' } as const, [] as MdFile[])
const shown = atom({ plugin: 'md-preview', key: 'shown' } as const, null as string | null)
const frame = atom({ plugin: 'md-preview', key: 'frame' } as const, null as MdFrame)
const view = atom({ plugin: 'md-preview', key: 'view' } as const, 'page' as 'page' | 'text')
const note = atom({ plugin: 'md-preview', key: 'note' } as const, '')

// The module's own bookkeeping; a reload starts it over.
const draw = { pending: false, dirty: false, n: 0, columns: 100, failed: '' }
const session = { cwd: '', home: '', command: 'md', canImage: false, noChrome: false, ghDownUntil: 0 }
const toasted = new Set<string>() // files toasted this turn

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folder = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

// owner/repo from `git remote -v`, the first GitHub remote.
export function githubRepo(remotes: string): string | null {
  const m = remotes.match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\s|$)/)
  return m ? `${m[1]}/${m[2]}` : null
}

// Terminals that draw pictures, and not through tmux (it passes none).
async function imageTerminal($: EngineInterface) {
  const low = (v: string | undefined) => (v ?? '').toLowerCase()
  if (low(await $.env.get('TMUX').catch(() => undefined))) return false
  const program = low(await $.env.get('TERM_PROGRAM').catch(() => undefined))
  const term = low(await $.env.get('TERM').catch(() => undefined))
  return /ghostty|iterm|wezterm|kitty/.test(program) || /kitty|ghostty|foot|wezterm/.test(term)
}

async function paneUp($: EngineInterface) {
  return (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)
}

function absolute(arg: string) {
  let p = arg.replace(/^["']|["']$/g, '')
  if (p.startsWith('~/') && session.home) p = session.home + p.slice(1)
  else if (!p.startsWith('/')) p = `${session.cwd.replace(/\/$/, '')}/${p}`
  const parts: string[] = []
  for (const s of p.split('/')) {
    if (s === '..') parts.pop()
    else if (s && s !== '.') parts.push(s)
  }
  return `/${parts.join('/')}`
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    session.cwd = e.cwd
    session.home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
    session.canImage = await imageTerminal($)
    // /md, or /mdview if a built-in ever takes /md.
    for (const name of ['md', 'mdview']) {
      const ok = await $.command
        .register({ name, description: 'Preview the Markdown files Claude edited, rendered like GitHub', argumentHint: '[path]' })
        .then(() => true)
        .catch(() => false)
      if (ok) {
        session.command = name
        break
      }
    }
    return r
  })

  on('turn.start', async (_$, e, next) => {
    toasted.clear()
    return next(e)
  })

  // Reads what the main agent wrote; never blocks or changes the call.
  on('tool.call', async ($, e, next) => {
    if (!EDIT_TOOLS.has(e.tool) || e.agentId) return next(e)
    const path = (e as unknown as { file_path?: unknown }).file_path
    if (typeof path !== 'string' || !MD_FILE.test(path)) return next(e)
    const before = await $.fs.read(path).catch(() => null)
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) return r
    await changed($, path, typeof before === 'string' ? before : null).catch(() => {}) // quick: a read and a toast
    return r
  })

  on('command.run', { command: 'md' }, async ($, e) => openPreview($, e.args))
  on('command.run', { command: 'mdview' }, async ($, e) => openPreview($, e.args))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const path = await read($, shown)
    const v = await read($, view)
    const msg = await read($, note)
    const columns = Math.max(20, e.props.bodyColumns)
    const file = list.find(f => f.path === path)
    const i = list.findIndex(f => f.path === path)
    const isPage = e.surface === 'terminal' && v === 'page' && session.canImage && !session.noChrome
    const f = await read($, frame)
    const head = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="Prev" hotkey="p" onPress={() => step($, -1)} />
          <Button key="next" label="Next" hotkey="n" onPress={() => step($, 1)} />
          <Button key="again" label="Render" hotkey="r" onPress={() => again($)} />
          <Button key="view" label={v === 'page' ? 'Text' : 'Page'} hotkey="t" onPress={() => toggle($)} />
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {path && (
          <Text wrap="truncate-end">
            <Text bold>{base(path)}</Text>
            <Text dimColor>{`  ${i + 1}/${list.length}${isPage && f?.path === path ? ` · ${f.via}` : ''}${file?.marks.length ? ' · green bar: changed in the last edit' : ''}`}</Text>
          </Text>
        )}
      </Box>
    )
    if (!path) {
      return (
        <Box flexDirection="column">
          {head}
          <Text dimColor>{`No Markdown edits yet. /${session.command} <path> opens a file.`}</Text>
        </Box>
      )
    }

    if (isPage) {
      draw.columns = columns
      const key = `${path}:${file?.at ?? 0}:${columns}`
      const isCurrent = f !== null && f.path === path && f.columns === columns && f.at === (file?.at ?? 0)
      if (!isCurrent && !draw.pending && draw.failed !== key) void renderSoon($).catch(() => {})
      if (f && f.path === path && f.columns === columns) {
        const { Image } = $.ui.resolve(e)
        return (
          <Box flexDirection="column">
            {head}
            {f.parts.map((p, k) => (
              <Image key={`part-${k}`} source={{ file: p.file, format: 'png', generation: f.n }} columns={columns} rows={p.rows} alt={k === 0 ? `${base(path)}, rendered` : ' '} />
            ))}
          </Box>
        )
      }
    }

    // The text view: while the page draws, and where it cannot.
    const text = await $.fs.read(path).catch(() => null)
    const lines = typeof text === 'string' ? toLines(parse(withMarks(text, file?.marks ?? [])), columns - 2).slice(0, 3000) : []
    const status = isPage ? msg || 'Rendering…' : msg
    return (
      <Box flexDirection="column">
        {head}
        {status && <Text dimColor>{status}</Text>}
        {typeof text !== 'string' && <Text color="red">{`Cannot read ${path}`}</Text>}
        {lines.map((l, k) => (
          <Text key={`l${k}`} wrap="wrap">
            <Text color="green">{l.mark ? '▌' : ' '}</Text>
            <Text dimColor>{l.prefix}</Text>
            {l.segs.length === 0 ? <Text> </Text> : l.segs.map((s, j) => (
              <Text key={`s${j}`} bold={s.bold} italic={s.italic} dimColor={s.dim} color={s.color} underline={s.underline} strikethrough={s.strike}>
                {s.text}
              </Text>
            ))}
          </Text>
        ))}
      </Box>
    )
  })
}

// /md [path]: the pane on that file, or on the latest one changed.
async function openPreview($: EngineInterface, args: string) {
  let target: string | null = null
  const arg = args.trim()
  if (arg) {
    const abs = absolute(arg)
    if (!MD_FILE.test(abs)) return { text: 'md-preview: give a .md, .mdx or .markdown file.' }
    if (!(await $.fs.exists(abs).catch(() => false))) return { text: `md-preview: no file at ${abs}` }
    await update($, files, list => (list.some(f => f.path === abs) ? list : [{ path: abs, at: Date.now(), marks: [] }, ...list].slice(0, MAX_FILES)))
    target = abs
  } else {
    target = (await read($, files))[0]?.path ?? null
  }
  if (!target) return { text: `md-preview: no Markdown edits yet this session. /${session.command} <path> opens a file.` }
  await update($, shown, () => target)
  await $.ui.open({ id: PANE, title: 'Markdown', focus: true })
  void renderSoon($).catch(() => {})
  return { text: `md-preview: ${base(target)}. n/p: next/previous file · r: render again · t: page/text · q: close` }
}

// A Markdown file changed: remember which blocks, redraw it or say so.
async function changed($: EngineInterface, path: string, before: string | null) {
  const after = await $.fs.read(path).catch(() => null)
  if (typeof after !== 'string') return
  const marks = changedChunks(before, after)
  await update($, files, list => [{ path, at: Date.now(), marks }, ...list.filter(f => f.path !== path)].slice(0, MAX_FILES))
  const isShown = (await read($, shown)) === path && (await paneUp($))
  if (isShown) {
    await renderSoon($)
    return
  }
  if (toasted.has(path)) return
  toasted.add(path)
  $.ui.toast(`${base(path)} changed · /${session.command} to preview`)
}

async function step($: EngineInterface, by: number) {
  const list = await read($, files)
  if (list.length === 0) return
  const now = await read($, shown)
  const i = list.findIndex(f => f.path === now)
  const next = list[(((i + by) % list.length) + list.length) % list.length]
  if (next) await update($, shown, () => next.path)
  await renderSoon($)
}

async function again($: EngineInterface) {
  draw.failed = ''
  session.noChrome = false
  session.ghDownUntil = 0
  await update($, frame, () => null)
  await renderSoon($)
}

async function toggle($: EngineInterface) {
  await update($, view, v => (v === 'page' ? 'text' : 'page'))
  await renderSoon($)
}

// One drawing at a time; a change while drawing draws once more after.
async function renderSoon($: EngineInterface) {
  if (draw.pending) {
    draw.dirty = true
    return
  }
  if (!(await read($, shown)) || (await read($, view)) !== 'page' || !session.canImage || session.noChrome) return
  if (!(await paneUp($))) return
  draw.pending = true
  draw.dirty = false
  $.clock.after(300, () => {
    void renderFile($)
      .catch(async () => {
        await update($, note, () => 'Could not draw the page. Showing text; r tries again.')
      })
      .finally(() => {
        draw.pending = false // only now: two Chromes must never share the profile
        if (draw.dirty) void renderSoon($).catch(() => {})
      })
  })
}

// GitHub's own renderer, through the person's gh; null when it cannot be used.
async function github($: EngineInterface, md: string, dir: string): Promise<string | null> {
  if (Date.now() < session.ghDownUntil) return null
  const remotes = await $.process.run(['git', '-C', dir, 'remote', '-v'], { timeoutMs: 5000 }).catch(() => null)
  const repo = remotes && remotes.exitCode === 0 ? githubRepo(remotes.stdout) : null
  if (!repo) return null // not in a GitHub repo: the Markdown stays on this machine
  const r = await $.process
    .run(['gh', 'api', '-X', 'POST', '/markdown', '--input', '-'], { stdin: JSON.stringify({ text: md, mode: 'markdown', context: repo }), timeoutMs: GH_TIMEOUT_MS })
    .catch(() => null)
  if (!r || r.exitCode !== 0 || !r.stdout.trim()) {
    session.ghDownUntil = Date.now() + 60_000 // offline or signed out: built-in for a minute
    return null
  }
  return r.stdout
}

async function renderFile($: EngineInterface) {
  const path = await read($, shown)
  if (!path) return
  const file = (await read($, files)).find(f => f.path === path)
  const at = file?.at ?? 0
  const columns = draw.columns
  const key = `${path}:${at}:${columns}`
  if (!(await $.fs.exists(CHROME).catch(() => false))) {
    session.noChrome = true
    await update($, note, () => `The rendered view needs Google Chrome at ${CHROME}. Showing text.`)
    return
  }
  const text = await $.fs.read(path)
  if (typeof text !== 'string') return
  const md = withMarks(text, file?.marks ?? [])
  const dir = folder(path)
  const fromGithub = await github($, md, dir)
  const html = fromGithub ?? toHtml(parse(md))
  const tmp = ((await $.env.get('TMPDIR').catch(() => undefined)) ?? '/tmp').replace(/\/$/, '')
  const root = `${tmp}/md-preview`
  const n = ++draw.n
  const pagePath = `${root}/page-${n % 2}.html`
  const out = `${root}/frame-${n % 2}` // two in turn, so the shown one is never half written
  const width = columns * CELL_PX
  await $.fs.write(pagePath, page(html, { dir, title: base(path), width }))
  const r = await $.process.run(['sh', '-c', SCRIPT, 'md-preview', CHROME, pagePath, out, `${root}/chrome`, String(width), '2'], { timeoutMs: 60_000 })
  const m = r.stdout.match(/(\d+) (\d+)/)
  if (r.exitCode !== 0 || !m) {
    draw.failed = key
    await update($, note, () => 'Chrome could not draw the page. Showing text; r tries again.')
    return
  }
  const rows = Number(m[1])
  const parts = Array.from({ length: Number(m[2]) }, (_, k) => ({ file: `${out}/part-${k}.png`, rows: Math.min(PART_ROWS, rows - k * PART_ROWS) }))
  await update($, note, () => '')
  await update($, frame, () => ({ path, at, columns, parts, n, via: fromGithub === null ? 'built-in' : 'GitHub' }))
}
