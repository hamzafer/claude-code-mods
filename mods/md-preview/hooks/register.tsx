// md-preview: the Markdown files Claude edits, rendered like GitHub, in a pane.
//   A toast says when one changes; /md opens the pane on the latest one.
//   b shows the file before the last edit next to it now; /md compare <a> <b> shows
//   two files side by side; o opens the page in the browser.
//   GitHub renders it (gh api /markdown) when the file is in a GitHub repo and gh is
//   signed in; a small built-in renderer does otherwise. Headless Chrome draws the
//   page to PNG for the terminal; without Chrome or an image terminal, a text view.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { MdFile, MdFrame, MdPair } from '../types'
import { changedChunks, parse, toHtml, toLines, withMarks } from './md'
import type { Line } from './md'
import { page } from './page'
import type { Side } from './page'

const PANE = 'md-preview'
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
export const MD_FILE = /\.(md|mdx|markdown)$/i
const EDIT_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
const CELL_PX = 9 // page pixels per terminal column
const ROW_PX = 19 // page pixels per terminal row
const PART_ROWS = 250 // an Image is at most 255 rows: taller pages come in parts
const SIDE_BY_SIDE_COLUMNS = 120 // narrower panes stack a compare
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
const pair = atom({ plugin: 'md-preview', key: 'pair' } as const, null as MdPair)
const compare = atom({ plugin: 'md-preview', key: 'compare' } as const, false)
const frame = atom({ plugin: 'md-preview', key: 'frame' } as const, null as MdFrame)
const view = atom({ plugin: 'md-preview', key: 'view' } as const, 'page' as 'page' | 'text')
const note = atom({ plugin: 'md-preview', key: 'note' } as const, '')

// The module's own bookkeeping; a reload starts it over.
const draw = { pending: false, dirty: false, n: 0, columns: 100, failed: '' }
const session = { cwd: '', home: '', command: 'md', canImage: false, noChrome: false, ghDownUntil: 0 }
const toasted = new Set<string>() // files toasted this turn

const base = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const folder = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'

// What the pane shows: one file, a file before and after its last edit, or two files.
type Part = { label?: string; path: string; isBefore?: boolean }
type Plan = { key: string; title: string; parts: Part[] }
type Loaded = { label?: string; path: string; text: string; marks: number[] }

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
        .register({ name, description: 'Preview the Markdown files Claude edited, rendered like GitHub', argumentHint: '[path | compare <a> <b> | open]' })
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
    const before = await $.fs.read(path).catch(() => null) // before the write lands
    const r = await next(e)
    if (r.deny !== undefined || r.isError === true) return r
    await changed($, path, typeof before === 'string' ? before : null).catch(() => {}) // quick: a read and a toast
    return r
  })

  on('command.run', { command: 'md' }, async ($, e) => command($, e.args))
  on('command.run', { command: 'mdview' }, async ($, e) => command($, e.args))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, files)
    const path = await read($, shown)
    const two = await read($, pair)
    const isCompare = await read($, compare)
    const v = await read($, view)
    const msg = await read($, note)
    const columns = Math.max(20, e.props.bodyColumns)
    draw.columns = columns
    const p = await plan($)
    const i = list.findIndex(f => f.path === path)
    const isPage = e.surface === 'terminal' && v === 'page' && session.canImage && !session.noChrome
    const f = await read($, frame)
    const file = list.find(x => x.path === path)
    const where = two ? `${base(two.a)} | ${base(two.b)}` : path ? base(path) : ''
    const info = two
      ? '  side by side'
      : `  ${i + 1}/${list.length}${isCompare ? (file?.before !== undefined ? ' · before | after' : ' · new file, no earlier version') : ''}${file?.marks.length ? ' · green bar: changed in the last edit' : ''}`
    const head = (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="Prev" hotkey="p" onPress={() => step($, -1)} />
          <Button key="next" label="Next" hotkey="n" onPress={() => step($, 1)} />
          <Button key="before" label={isCompare ? 'Single' : 'Before'} hotkey="b" onPress={() => toggleCompare($)} />
          <Button key="again" label="Render" hotkey="r" onPress={() => again($)} />
          <Button key="view" label={v === 'page' ? 'Text' : 'Page'} hotkey="t" onPress={() => toggleView($)} />
          <Button key="open" label="Browser" hotkey="o" onPress={() => void openInBrowser($).then(t => $.ui.toast(t)).catch(() => {})} />
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        {p && (
          <Text wrap="truncate-end">
            <Text bold>{where}</Text>
            <Text dimColor>{`${info}${isPage && f?.key === p.key ? ` · ${f.via}` : ''}`}</Text>
          </Text>
        )}
      </Box>
    )
    if (!p) {
      return (
        <Box flexDirection="column">
          {head}
          <Text dimColor>{`No Markdown edits yet. /${session.command} <path> opens a file.`}</Text>
        </Box>
      )
    }

    if (isPage) {
      const key = `${p.key}@${columns}`
      const isCurrent = f !== null && f.key === p.key && f.columns === columns
      if (!isCurrent && !draw.pending && draw.failed !== key) void renderSoon($).catch(() => {})
      // The last drawing of the same view stays up while a newer one draws.
      const same = f !== null && f.columns === columns && sameView(f.key, p.key)
      if (f && same) {
        const { Image } = $.ui.resolve(e)
        return (
          <Box flexDirection="column">
            {head}
            {f.parts.map((part, k) => (
              <Image key={`part-${k}`} source={{ file: part.file, format: 'png', generation: f.n }} columns={columns} rows={part.rows} alt={k === 0 ? `${where}, rendered` : ' '} />
            ))}
          </Box>
        )
      }
    }

    // The text view: while the page draws, and where it cannot.
    const sides = await load($, p)
    const many = sides.length > 1
    const lines: Line[] = []
    for (const s of sides) {
      if (many) lines.push({ prefix: '', segs: [{ text: `── ${s.label ?? base(s.path)} ──`, bold: true, color: 'yellow' }] }, { prefix: '', segs: [] })
      lines.push(...toLines(parse(withMarks(s.text, s.marks)), columns - 2))
      if (many) lines.push({ prefix: '', segs: [] })
    }
    const status = isPage ? msg || 'Rendering…' : msg
    return (
      <Box flexDirection="column">
        {head}
        {status && <Text dimColor>{status}</Text>}
        {sides.length === 0 && <Text color="red">{`Cannot read ${where}`}</Text>}
        {lines.slice(0, 3000).map((l, k) => (
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

// Two keys name the same view when only the versions differ.
function sameView(a: string, b: string) {
  return a.replace(/#\d+/g, '') === b.replace(/#\d+/g, '')
}

// What to show now, without reading any file.
async function plan($: EngineInterface): Promise<Plan | null> {
  const list = await read($, files)
  const at = (p: string) => list.find(f => f.path === p)?.at ?? 0
  const two = await read($, pair)
  if (two) return { key: `pair:${two.a}#${at(two.a)}|${two.b}#${at(two.b)}`, title: `${base(two.a)} | ${base(two.b)}`, parts: [{ label: base(two.a), path: two.a }, { label: base(two.b), path: two.b }] }
  const path = await read($, shown)
  if (!path) return null
  const file = list.find(f => f.path === path)
  if ((await read($, compare)) && file?.before !== undefined) {
    return { key: `cmp:${path}#${at(path)}`, title: `${base(path)}: before | after`, parts: [{ label: 'Before', path, isBefore: true }, { label: 'After', path }] }
  }
  return { key: `one:${path}#${at(path)}`, title: base(path), parts: [{ path }] }
}

// The texts a plan shows, with the blocks to mark green.
async function load($: EngineInterface, p: Plan): Promise<Loaded[]> {
  const list = await read($, files)
  const out: Loaded[] = []
  for (const part of p.parts) {
    const file = list.find(f => f.path === part.path)
    const text = part.isBefore ? file?.before : await $.fs.read(part.path).catch(() => null)
    if (typeof text !== 'string') return []
    out.push({ label: part.label, path: part.path, text, marks: part.isBefore ? [] : (file?.marks ?? []) })
  }
  // Two files: mark what the second has that the first does not.
  if (p.key.startsWith('pair:') && out.length === 2) {
    const [a, b] = out as [Loaded, Loaded]
    b.marks = changedChunks(a.text, b.text)
    a.marks = []
  }
  return out
}

// /md, /md <path>, /md compare <a> <b>, /md open.
async function command($: EngineInterface, args: string) {
  const words = args.trim().split(/\s+/).filter(Boolean)
  if (words[0] === 'open') return { text: await openInBrowser($) }
  if (words[0] === 'compare') {
    if (words.length !== 3) return { text: `md-preview: /${session.command} compare <fileA> <fileB>` }
    const [a, b] = [absolute(words[1] as string), absolute(words[2] as string)]
    for (const f of [a, b]) {
      if (!MD_FILE.test(f)) return { text: `md-preview: ${base(f)} is not a .md, .mdx or .markdown file.` }
      if (!(await $.fs.exists(f).catch(() => false))) return { text: `md-preview: no file at ${f}` }
    }
    await update($, pair, () => ({ a, b }))
    await $.ui.open({ id: PANE, title: 'Markdown', focus: true })
    void renderSoon($).catch(() => {})
    return { text: `md-preview: ${base(a)} | ${base(b)} side by side. o: open in the browser · q: close` }
  }
  let target: string | null = null
  if (words.length) {
    const abs = absolute(args.trim())
    if (!MD_FILE.test(abs)) return { text: 'md-preview: give a .md, .mdx or .markdown file.' }
    if (!(await $.fs.exists(abs).catch(() => false))) return { text: `md-preview: no file at ${abs}` }
    await update($, files, list => (list.some(f => f.path === abs) ? list : [{ path: abs, at: Date.now(), marks: [] }, ...list].slice(0, MAX_FILES)))
    target = abs
  } else {
    target = (await read($, files))[0]?.path ?? null
  }
  if (!target) return { text: `md-preview: no Markdown edits yet this session. /${session.command} <path> opens a file.` }
  await update($, shown, () => target)
  await update($, pair, () => null)
  await $.ui.open({ id: PANE, title: 'Markdown', focus: true })
  void renderSoon($).catch(() => {})
  return { text: `md-preview: ${base(target)}. n/p: next/previous · b: before | after · o: browser · r: render again · t: page/text · q: close` }
}

// A Markdown file changed: remember its text before and which blocks, redraw or say so.
async function changed($: EngineInterface, path: string, before: string | null) {
  const after = await $.fs.read(path).catch(() => null)
  if (typeof after !== 'string') return
  const marks = changedChunks(before, after)
  const entry: MdFile = before === null ? { path, at: Date.now(), marks } : { path, at: Date.now(), marks, before }
  await update($, files, list => [entry, ...list.filter(f => f.path !== path)].slice(0, MAX_FILES))
  const two = await read($, pair)
  const isShown = ((await read($, shown)) === path || two?.a === path || two?.b === path) && (await paneUp($))
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
  await update($, pair, () => null)
  await renderSoon($)
}

async function again($: EngineInterface) {
  draw.failed = ''
  session.noChrome = false
  session.ghDownUntil = 0
  await update($, frame, () => null)
  await renderSoon($)
}

async function toggleView($: EngineInterface) {
  await update($, view, v => (v === 'page' ? 'text' : 'page'))
  await renderSoon($)
}

async function toggleCompare($: EngineInterface) {
  await update($, pair, () => null)
  await update($, compare, c => !c)
  await renderSoon($)
}

// One drawing at a time; a change while drawing draws once more after.
async function renderSoon($: EngineInterface) {
  if (draw.pending) {
    draw.dirty = true
    return
  }
  if (!(await plan($)) || (await read($, view)) !== 'page' || !session.canImage || session.noChrome) return
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

// Each side's HTML, from GitHub where it can.
async function html($: EngineInterface, sides: Loaded[]): Promise<{ sides: Side[]; via: 'GitHub' | 'built-in' }> {
  let isGithub = true
  const out: Side[] = []
  for (const s of sides) {
    const md = withMarks(s.text, s.marks)
    const fromGithub = await github($, md, folder(s.path))
    if (fromGithub === null) isGithub = false
    out.push({ label: s.label, dir: folder(s.path), html: fromGithub ?? toHtml(parse(md)) })
  }
  return { sides: out, via: isGithub ? 'GitHub' : 'built-in' }
}

async function tmpRoot($: EngineInterface) {
  const tmp = ((await $.env.get('TMPDIR').catch(() => undefined)) ?? '/tmp').replace(/\/$/, '')
  return `${tmp}/md-preview`
}

async function renderFile($: EngineInterface) {
  const p = await plan($)
  if (!p) return
  const columns = draw.columns
  const key = `${p.key}@${columns}`
  if (!(await $.fs.exists(CHROME).catch(() => false))) {
    session.noChrome = true
    await update($, note, () => `The rendered view needs Google Chrome at ${CHROME}. Showing text.`)
    return
  }
  const loaded = await load($, p)
  if (loaded.length === 0) return
  const { sides, via } = await html($, loaded)
  const root = await tmpRoot($)
  const n = ++draw.n
  const pagePath = `${root}/page-${n % 2}.html`
  const out = `${root}/frame-${n % 2}` // two in turn, so the shown one is never half written
  const width = columns * CELL_PX
  await $.fs.write(pagePath, page(sides, { title: p.title, width, stacked: columns < SIDE_BY_SIDE_COLUMNS }))
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
  await update($, frame, () => ({ key: p.key, columns, parts, n, via }))
}

// The same page, full size in the person's own browser: self-contained HTML in a temp file.
async function openInBrowser($: EngineInterface): Promise<string> {
  if (!(await read($, shown)) && !(await read($, pair))) {
    const latest = (await read($, files))[0]?.path
    if (latest) await update($, shown, () => latest)
  }
  const p = await plan($)
  if (!p) return `md-preview: nothing to open yet. /${session.command} <path> picks a file.`
  const loaded = await load($, p)
  if (loaded.length === 0) return `md-preview: cannot read ${p.title}`
  const { sides } = await html($, loaded)
  const file = `${await tmpRoot($)}/open-${Date.now()}.html`
  await $.fs.write(file, page(sides, { title: p.title, width: 0 }))
  const opener = (await $.fs.exists('/usr/bin/open').catch(() => false)) ? 'open' : 'xdg-open'
  const r = await $.process.run([opener, file], { timeoutMs: 10_000 }).catch(() => null)
  return r && r.exitCode === 0 ? `md-preview: opened ${p.title} in the browser` : `md-preview: could not open the browser. The page is at ${file}`
}
