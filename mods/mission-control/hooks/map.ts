// The "code" view: files Claude touched, the imports between them, drawn as an SVG.
import type { MapFile } from '../types'

const stripExt = (p: string) => p.replace(/\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|vue|svelte)$/, '').replace(/\/index$/, '')

function join(dir: string, rel: string) {
  const parts = dir.split('/')
  for (const seg of rel.split('/')) {
    if (seg === '..') parts.pop()
    else if (seg !== '.') parts.push(seg)
  }
  return parts.join('/')
}

// Relative imports in a source file, resolved against its folder, extension stripped.
export function importsOf(path: string, text: string): string[] {
  const dir = path.slice(0, path.lastIndexOf('/'))
  const found = new Set<string>()
  const js = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g
  for (const m of text.matchAll(js)) found.add(stripExt(join(dir, m[1] as string)))
  const py = /^\s*from\s+(\.+)([\w.]*)\s+import/gm
  for (const m of text.matchAll(py)) {
    const ups = (m[1] as string).length - 1
    let base = dir
    for (let i = 0; i < ups; i++) base = base.slice(0, base.lastIndexOf('/'))
    if (m[2]) found.add(`${base}/${(m[2] as string).replace(/\./g, '/')}`)
  }
  return [...found]
}

export type Edge = { from: string; to: string }

export function edges(files: MapFile[]): Edge[] {
  const byBase = new Map(files.map(f => [stripExt(f.path), f.path]))
  const out: Edge[] = []
  for (const f of files) for (const target of f.imports) {
    const to = byBase.get(target)
    if (to && to !== f.path) out.push({ from: f.path, to })
  }
  return out
}

// Columns by import depth: a file goes one column right of the files that import it.
export function layout(files: MapFile[], es: Edge[]) {
  const depth = new Map(files.map(f => [f.path, 0]))
  for (let pass = 0; pass < files.length; pass++) {
    let moved = false
    for (const e of es) {
      const want = (depth.get(e.from) ?? 0) + 1
      if (want > (depth.get(e.to) ?? 0) && want < 5) {
        depth.set(e.to, want)
        moved = true
      }
    }
    if (!moved) break
  }
  const columns: string[][] = []
  for (const f of files) {
    const d = depth.get(f.path) ?? 0
    ;(columns[d] ??= []).push(f.path)
  }
  return columns.filter(Boolean)
}

// Cut to `max` characters at a word, with an ellipsis.
export function fit(text: string, max: number) {
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}…`
}

// The first line that fits at a word, then the rest.
export function wrap(text: string, per: number): [string, string] {
  if (text.length <= per) return [text, '']
  const cut = text.lastIndexOf(' ', per)
  const at = cut > per * 0.5 ? cut : per
  return [text.slice(0, at), text.slice(at).trim()]
}

// Escapes markup, and drops control characters, one of which turns the picture into an XML error.
const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export type Look = { width: number; height: number; at: number; turn: number }

// The whole picture: boxes per file, arrows per import, a glow on what is being touched now.
const SANS = `-apple-system, 'SF Pro Text', 'Helvetica Neue', sans-serif`
const MONO = `'SF Mono', Menlo, monospace`
const C = {
  bg: '#0d1015', grid: '#1a1f28', card: '#151922', cardLive: '#1b2130', line: '#2a3140', text: '#e8ebf2',
  dim: '#7d8698', faint: '#4b5263', edge: '#3a4252', edgeHot: '#6b7a96',
  read: '#5aa9ff', edit: '#ffa24c', changed: '#3ddc84',
}

type Card = { f: MapFile; x: number; y: number; w: number; h: number; title: string; sub: string; why: [string, string] }

// The whole picture: the files that changed or link to others as cards with arrows, the
// rest as small chips; a glow on what is being touched right now.
export function svg(files: MapFile[], look: Look): string {
  const { width: W, height: H, at, turn } = look
  const isChanged = (f: MapFile) => f.changedTurn === turn && turn > 0
  const isLive = (f: MapFile) => at - f.at < 5000
  const es = edges(files)
  const linked = new Set(es.flatMap(e => [e.from, e.to]))
  const main = files.filter(f => linked.has(f.path) || isChanged(f) || isLive(f) || f.act !== 'read')
  const extra = files.filter(f => !main.includes(f))
  const mainEs = es.filter(e => main.some(f => f.path === e.from) && main.some(f => f.path === e.to))

  const title = (f: MapFile) => titleOf(f.path, files.map(x => x.path))

  // Cards sized to their text, laid out in import-depth columns, centered as a whole.
  const cols = layout(main, mainEs)
  const colOf = new Map(cols.flatMap((col, ci) => col.map(p => [p, ci] as const)))
  const gapX = 64
  const gapY = 18
  const cards = new Map<string, Card>()
  const colW: number[] = []
  const colH: number[] = []
  cols.forEach((col, ci) => {
    let w = 170
    for (const p of col) {
      const f = main.find(m => m.path === p) as MapFile
      w = Math.max(w, Math.min(280, title(f).length * 8.6 + 64))
    }
    colW[ci] = w
    let y = 0
    for (const p of col) {
      const f = main.find(m => m.path === p) as MapFile
      const why = f.why ? wrap(f.why, Math.floor((w - 32) / 7.1)) : (['', ''] as [string, string])
      const h = 52 + (why[0] ? 20 : 0) + (why[1] ? 17 : 0)
      cards.set(p, { f, x: 0, y, w, h, title: title(f), sub: folder(f.path, 2), why: [why[0], fit(why[1], Math.floor((w - 32) / 7.1))] })
      y += h + gapY
    }
    colH[ci] = y - gapY
  })
  const top = 76
  const bottom = extra.length ? 64 : 24
  const totalW = colW.reduce((a, b) => a + b, 0) + gapX * Math.max(0, cols.length - 1)
  // Laid out at 1x, then the whole graph scales as one group, text and all: up to 1.5x to
  // fill a roomy pane, down to fit a small one.
  const maxH = Math.max(1, ...colH)
  const scale = Math.min(1.5, (W - 48) / Math.max(1, totalW), (H - top - bottom - 40) / maxH)
  let x0 = 0
  cols.forEach((col, ci) => {
    const y0 = (maxH - (colH[ci] ?? 0)) / 2
    for (const p of col) {
      const c = cards.get(p) as Card
      c.x = x0
      c.y = y0 + c.y
    }
    x0 += (colW[ci] ?? 0) + gapX
  })
  const tx = (W - totalW * scale) / 2
  const ty = top + (H - top - bottom - maxH * scale) / 2

  const live = files.filter(isLive).sort((a, b) => b.at - a.at)[0]
  const changed = files.filter(isChanged).length
  const o: string[] = []
  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  o.push(`<defs>
<pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="${C.grid}"/></pattern>
<marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,1L9,5L0,9z" fill="${C.edgeHot}"/></marker>
<filter id="glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="9"/></filter>
<filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-color="#000" flood-opacity="0.45"/></filter>
</defs>`)
  o.push(`<rect width="${W}" height="${H}" fill="${C.bg}"/><rect width="${W}" height="${H}" fill="url(#dots)"/>`)

  // Header: title, counts as pills, and what is happening right now.
  o.push(`<text x="24" y="40" font-family="${SANS}" font-size="20" font-weight="700" fill="${C.text}">Code map</text>`)
  let px = 132
  for (const [label, color] of [[`${files.length} files`, C.dim], [`${changed} changed`, changed ? C.changed : C.dim]] as const) {
    const w = label.length * 7.4 + 22
    o.push(`<rect x="${px}" y="23" width="${w}" height="24" rx="12" fill="#161b24" stroke="${C.line}"/><text x="${px + w / 2}" y="39.5" text-anchor="middle" font-family="${SANS}" font-size="12.5" fill="${color}">${label}</text>`)
    px += w + 8
  }
  if (live) {
    const verb = live.act === 'read' ? 'reading' : live.act === 'search' ? 'searching' : 'editing'
    const color = live.act === 'read' || live.act === 'search' ? C.read : C.edit
    o.push(`<circle cx="${px + 10}" cy="35" r="4.5" fill="${color}"/><text x="${px + 21}" y="39.5" font-family="${SANS}" font-size="13" fill="${color}">${verb} ${esc(title(live))}</text>`)
  }

  if (files.length === 0) {
    o.push(`<text x="${W / 2}" y="${H / 2}" text-anchor="middle" font-family="${SANS}" font-size="16" fill="${C.dim}">Files Claude reads or edits show up here</text>`)
  }

  // Arrows first, so cards sit on top of them; all of it in the scaled group.
  o.push(`<g transform="translate(${tx.toFixed(1)},${ty.toFixed(1)}) scale(${scale.toFixed(3)})">`)
  for (const e of mainEs) {
    const a = cards.get(e.from)
    const b = cards.get(e.to)
    if (!a || !b) continue
    const hot = isChanged(a.f) || isChanged(b.f) || isLive(a.f) || isLive(b.f)
    const x1 = a.x + a.w
    const y1 = a.y + Math.min(a.h / 2, 26)
    const x2 = b.x - 4
    const y2 = b.y + Math.min(b.h / 2, 26)
    const from = colOf.get(e.from) ?? 0
    const to = colOf.get(e.to) ?? 0
    let d: string
    if (to - from > 1) {
      // Skips a column: arc over the cards between, so the arrow is never hidden behind one.
      const between = [...cards.values()].filter(c => (colOf.get(c.f.path) ?? 0) > from && (colOf.get(c.f.path) ?? 0) < to)
      const peak = Math.min(a.y, b.y, ...between.map(c => c.y)) - 34
      const ax = a.x + a.w * 0.7
      const bx = b.x + b.w * 0.3
      d = `M${ax},${a.y} C${ax},${peak} ${bx},${peak} ${bx},${b.y - 4}`
    } else if (x2 > x1 + 8) {
      d = `M${x1},${y1} C${x1 + (x2 - x1) / 2},${y1} ${x1 + (x2 - x1) / 2},${y2} ${x2},${y2}`
    } else {
      d = `M${a.x + a.w / 2},${a.y + a.h} C${a.x + a.w / 2},${a.y + a.h + 30} ${b.x + b.w / 2},${b.y - 30} ${b.x + b.w / 2},${b.y - 4}`
    }
    o.push(`<path d="${d}" fill="none" stroke="${hot ? C.edgeHot : C.edge}" stroke-width="${hot ? 2 : 1.5}" marker-end="url(#a)"/>`)
  }

  for (const c of cards.values()) {
    const { f } = c
    const liveNow = isLive(f)
    const accent = liveNow ? (f.act === 'read' || f.act === 'search' ? C.read : C.edit) : isChanged(f) ? C.changed : null
    if (liveNow && accent) o.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" fill="${accent}" opacity="0.35" filter="url(#glow)"/>`)
    o.push(`<g filter="url(#shadow)"><rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" rx="12" fill="${liveNow ? C.cardLive : C.card}" stroke="${liveNow && accent ? accent : C.line}" stroke-width="${liveNow ? 1.5 : 1}"/></g>`)
    if (accent) o.push(`<rect x="${c.x}" y="${c.y + 10}" width="3.5" height="${c.h - 20}" rx="1.75" fill="${accent}"/>`)
    o.push(`<text x="${c.x + 18}" y="${c.y + 24}" font-family="${SANS}" font-size="14.5" font-weight="650" fill="${C.text}">${esc(c.title)}</text>`)
    o.push(`<text x="${c.x + 18}" y="${c.y + 41}" font-family="${MONO}" font-size="11" fill="${C.faint}">${esc(c.sub)}</text>`)
    const badge = liveNow ? (f.act === 'read' ? '●' : f.act === 'search' ? '●' : '✎') : isChanged(f) ? '✓' : ''
    if (badge && accent) o.push(`<text x="${c.x + c.w - 14}" y="${c.y + 24}" text-anchor="end" font-family="${SANS}" font-size="13" fill="${accent}">${badge}</text>`)
    if (c.why[0]) o.push(`<text x="${c.x + 18}" y="${c.y + 63}" font-family="${SANS}" font-size="12.5" fill="#aeb6c6">${esc(c.why[0])}</text>`)
    if (c.why[1]) o.push(`<text x="${c.x + 18}" y="${c.y + 80}" font-family="${SANS}" font-size="12.5" fill="#aeb6c6">${esc(c.why[1])}</text>`)
  }

  o.push('</g>')

  // Files only read and linked to nothing: small chips along the bottom.
  if (extra.length) {
    o.push(`<text x="24" y="${H - 36}" font-family="${SANS}" font-size="11.5" fill="${C.faint}">ALSO READ</text>`)
    let cx = 100
    for (const f of extra) {
      const label = title(f)
      const w = label.length * 7 + 22
      if (cx + w > W - 24) break
      o.push(`<rect x="${cx}" y="${H - 52}" width="${w}" height="24" rx="12" fill="#141820" stroke="${C.line}"/><text x="${cx + w / 2}" y="${H - 35.5}" text-anchor="middle" font-family="${SANS}" font-size="12" fill="${C.dim}">${esc(label)}</text>`)
      cx += w + 8
    }
  }
  o.push('</svg>')
  return o.join('\n')
}

// A file's name, or with several of that name the nearest folder that tells them apart:
// three `hooks/register.tsx` read as `merge-gate › register.tsx`, `snake › register.tsx`.
export function titleOf(path: string, all: string[]) {
  const name = base(path)
  const same = all.filter(p => base(p) === name && p !== path)
  if (same.length === 0) return name
  const parts = path.split('/')
  for (let k = 2; k <= parts.length; k++) {
    const seg = parts[parts.length - k]
    if (same.every(p => p.split('/').at(-k) !== seg)) return `${seg} › ${name}`
  }
  return `${folder(path)}/${name}`
}

function base(path: string) {
  return path.split('/').pop() ?? path
}

// The last `n` folders of a path (`n` 1: the parent).
function folder(path: string, n = 1) {
  return path.split('/').slice(-1 - n, -1).join('/')
}
