// A small Markdown reader: blocks, HTML for the page, styled lines for the text view,
// and which top-level blocks the last edit changed.

// A paragraph made of this word alone marks the block after it as changed.
export const MARK = 'MDPREVIEWCHANGEDBLOCK'

type Item = { task?: boolean; blocks: Block[] }
export type Block =
  | { t: 'h'; level: number; text: string }
  | { t: 'p'; text: string }
  | { t: 'code'; lang: string; text: string }
  | { t: 'quote'; blocks: Block[] }
  | { t: 'list'; ordered: boolean; start: number; items: Item[] }
  | { t: 'table'; align: string[]; head: string[]; rows: string[][] }
  | { t: 'hr' }
  | { t: 'html'; text: string }
  | { t: 'mark' }

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)/
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/
const BLOCK_TAGS = 'address|article|aside|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|nav|ol|optgroup|option|p|picture|pre|script|section|source|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|ul|video|audio|img|a'
const HTML_START = new RegExp(`^ {0,3}(?:<!--|<\\/?(?:${BLOCK_TAGS})(?:[\\s/>]|$))`, 'i')
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const isBlank = (l: string) => l.trim() === ''
const indentOf = (l: string) => (l.match(/^ */)?.[0].length ?? 0)

function startsBlock(l: string) {
  return FENCE.test(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l) || ITEM.test(l) || HTML_START.test(l)
}

function cells(row: string) {
  let r = row.trim()
  if (r.startsWith('|')) r = r.slice(1)
  if (r.endsWith('|') && !r.endsWith('\\|')) r = r.slice(0, -1)
  return r.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'))
}

// Reference definitions ([id]: url), used by [text][id] and [id][] links.
let refs = new Map<string, string>()
const DEF = /^ {0,3}\[([^\]]+)\]:[ \t]*<?([^\s>]+)>?(?:[ \t]+["'(].*["')])?[ \t]*$/

export function parse(md: string): Block[] {
  const lines = md
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/^\t+/, t => '    '.repeat(t.length)))
  refs = new Map()
  let fence = ''
  const kept = lines.filter(l => {
    const f = l.match(FENCE)
    if (fence) {
      if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(l)) fence = ''
      return true
    }
    if (f) fence = f[1] as string
    const d = !fence && l.match(DEF)
    if (d) refs.set((d[1] as string).toLowerCase(), d[2] as string)
    return !d
  })
  return blocks(kept)
}

function blocks(lines: string[]): Block[] {
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const l = lines[i] as string
    if (isBlank(l)) {
      i++
      continue
    }
    if (indentOf(l) >= 4) {
      const body: string[] = []
      while (i < lines.length && (indentOf(lines[i] as string) >= 4 || isBlank(lines[i] as string))) {
        body.push((lines[i] as string).slice(4))
        i++
      }
      while (body.length && isBlank(body[body.length - 1] as string)) body.pop()
      out.push({ t: 'code', lang: '', text: body.join('\n') })
      continue
    }
    const fence = l.match(FENCE)
    if (fence) {
      const mark = fence[1] as string
      const body: string[] = []
      const pad = indentOf(l)
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`).test(lines[i] as string)) {
        body.push((lines[i] as string).replace(new RegExp(`^ {0,${pad}}`), ''))
        i++
      }
      i++
      out.push({ t: 'code', lang: fence[2] ?? '', text: body.join('\n') })
      continue
    }
    const heading = l.match(HEADING)
    if (heading) {
      out.push({ t: 'h', level: (heading[1] as string).length, text: heading[2] ?? '' })
      i++
      continue
    }
    if (HR.test(l)) {
      out.push({ t: 'hr' })
      i++
      continue
    }
    if (QUOTE.test(l)) {
      const body: string[] = []
      while (i < lines.length && !isBlank(lines[i] as string) && (QUOTE.test(lines[i] as string) || !startsBlock(lines[i] as string))) {
        body.push((lines[i] as string).replace(QUOTE, ''))
        i++
      }
      out.push({ t: 'quote', blocks: blocks(body) })
      continue
    }
    const item = l.match(ITEM)
    if (item) {
      const r = list(lines, i)
      out.push(r.block)
      i = r.next
      continue
    }
    if (l.includes('|') && i + 1 < lines.length && DELIM.test(lines[i + 1] as string) && (lines[i + 1] as string).includes('-') && cells(lines[i + 1] as string).length === cells(l).length) {
      const head = cells(l)
      const align = cells(lines[i + 1] as string).map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''))
      const rows: string[][] = []
      i += 2
      while (i < lines.length && !isBlank(lines[i] as string) && (lines[i] as string).includes('|')) {
        rows.push(cells(lines[i] as string))
        i++
      }
      out.push({ t: 'table', align, head, rows })
      continue
    }
    if (HTML_START.test(l)) {
      const body: string[] = []
      if (/^ {0,3}<!--/.test(l)) {
        while (i < lines.length) {
          body.push(lines[i] as string)
          i++
          if ((body[body.length - 1] as string).includes('-->')) break
        }
        out.push({ t: 'html', text: body.join('\n') })
        continue
      }
      while (i < lines.length && !isBlank(lines[i] as string)) {
        body.push(lines[i] as string)
        i++
      }
      out.push({ t: 'html', text: body.join('\n') })
      continue
    }
    // A paragraph, or a setext heading when a line of = or - closes it.
    const body: string[] = [l]
    i++
    let level = 0
    while (i < lines.length && !isBlank(lines[i] as string)) {
      const n = lines[i] as string
      if (/^ {0,3}=+\s*$/.test(n)) level = 1
      else if (/^ {0,3}-+\s*$/.test(n)) level = 2
      if (level) {
        i++
        break
      }
      if (startsBlock(n)) break
      body.push(n)
      i++
    }
    const text = body.map(b => b.replace(/^ {0,3}/, '')).join('\n')
    if (level) out.push({ t: 'h', level, text: text.trim() })
    else if (text.trim() === MARK) out.push({ t: 'mark' })
    else out.push({ t: 'p', text })
  }
  return out
}

function list(lines: string[], from: number): { block: Block; next: number } {
  const first = (lines[from] as string).match(ITEM) as RegExpMatchArray
  const ordered = /\d/.test(first[2] as string)
  const start = ordered ? parseInt(first[2] as string, 10) : 1
  const base = (first[1] as string).length
  const items: Item[] = []
  let i = from
  while (i < lines.length) {
    const m = (lines[i] as string).match(ITEM)
    if (!m || (m[1] as string).length > base + 1 || /\d/.test(m[2] as string) !== ordered) break
    const content = (m[1] as string).length + (m[2] as string).length + Math.min(4, Math.max(1, (m[3] as string).length))
    const body: string[] = [m[4] ?? '']
    i++
    while (i < lines.length) {
      const n = lines[i] as string
      if (isBlank(n)) {
        // A blank line ends the item unless what follows is indented into it.
        let j = i + 1
        while (j < lines.length && isBlank(lines[j] as string)) j++
        if (j < lines.length && indentOf(lines[j] as string) >= content) {
          for (; i < j; i++) body.push('')
          continue
        }
        break
      }
      if (indentOf(n) >= content) {
        body.push(n.slice(content))
        i++
        continue
      }
      if (ITEM.test(n) || startsBlock(n)) break
      body.push(n.trim()) // a lazy continuation of the paragraph
      i++
    }
    let task: boolean | undefined
    const t = (body[0] ?? '').match(/^\[([ xX])\][ \t]+/)
    if (t) {
      task = t[1] !== ' '
      body[0] = (body[0] ?? '').slice(t[0].length)
    }
    items.push({ task, blocks: blocks(body) })
    // A blank line between items keeps the list going.
    let j = i
    while (j < lines.length && isBlank(lines[j] as string)) j++
    const nm = j < lines.length ? (lines[j] as string).match(ITEM) : null
    if (j > i && nm && (nm[1] as string).length <= base + 1 && /\d/.test(nm[2] as string) === ordered) i = j
  }
  return { block: { t: 'list', ordered, start, items }, next: i }
}

// --- HTML ---

export function esc(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-')

export function inline(text: string): string {
  const keep: string[] = []
  const hold = (html: string) => `\u0000${keep.push(html) - 1}\u0000`
  let s = text
  s = s.replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => hold(`<code>${esc(code.replace(/\n/g, ' ').trim())}</code>`))
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, (_m, c: string) => hold(esc(c)))
  s = s.replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, m => hold(m)) // an entity stays one
  s = s.replace(/<(https?:\/\/[^\s>]+)>/g, (_m, url: string) => hold(`<a href="${esc(url)}">${esc(url)}</a>`))
  s = s.replace(/<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->/g, tag => hold(tag)) // inline HTML passes through
  s = esc(s)
  const URL_ = '((?:[^()\\s]|\\([^()\\s]*\\))*)' // one level of balanced parentheses
  const TITLE = '(?:\\s+&quot;([^&]*)&quot;)?'
  const ref = (label: string, id: string) => refs.get((id || label).replace(/\u0000\d+\u0000/g, '').toLowerCase())
  s = s.replace(new RegExp(`!\\[([^\\]]*)\\]\\(\\s*${URL_}${TITLE}\\s*\\)`, 'g'), (_m, alt: string, src: string, title?: string) => hold(`<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ''}>`))
  s = s.replace(new RegExp(`\\[((?:[^\\]\\\\]|\\\\.)*)\\]\\(\\s*${URL_}${TITLE}\\s*\\)`, 'g'), (_m, label: string, href: string, title?: string) => hold(`<a href="${safeUrl(href)}"${title ? ` title="${title}"` : ''}>${emphasis(label)}</a>`))
  s = s.replace(/!\[([^\]]*)\]\[([^\]]*)\]/g, (m, alt: string, id: string) => {
    const url = ref(alt, id)
    return url ? hold(`<img src="${safeUrl(esc(url))}" alt="${alt}">`) : m
  })
  s = s.replace(/\[((?:[^\]\\]|\\.)*)\]\[([^\]]*)\]/g, (m, label: string, id: string) => {
    const url = ref(label, id)
    return url ? hold(`<a href="${safeUrl(esc(url))}">${emphasis(label)}</a>`) : m
  })
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<]*[^\s<.,;:!?)'"\u0000])/g, (_m, pre: string, url: string) => `${pre}${hold(`<a href="${url}">${url}</a>`)}`)
  s = emphasis(s)
  s = s.replace(/(?: {2,}|\\)\n/g, '<br>\n')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, n: string) => keep[Number(n)] ?? '').replace(/\u0000(\d+)\u0000/g, (_m, n: string) => keep[Number(n)] ?? '')
}

// Only web, mail, relative and in-page links; never javascript: and the like.
function safeUrl(url: string) {
  return /^\s*(?:javascript|vbscript|data|file):/i.test(url.replace(/&#?\w+;|[\u0000-\u001f]/g, '')) ? '#' : url
}

/** Drops what can run: script-like elements and on* handlers, javascript: URLs. */
export function sanitize(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|frame|frameset|applet|base|meta|link|form)\b[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<\/?(script|style|iframe|object|embed|frame|frameset|applet|base|meta|link|form)\b[^>]*>/gi, '')
    .replace(/<[a-z][^>]*>/gi, tag =>
      tag
        .replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
        .replace(/\b(href|src|action|formaction|srcset)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, (m, attr: string, v: string) => (safeUrl(v.replace(/^["']|["']$/g, '')) === '#' ? `${attr}="#"` : m)),
    )
}

function emphasis(s: string) {
  return s
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>')
    .replace(/\*(?=\S)([\s\S]*?\S)\*/g, '<em>$1</em>')
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>')
}

// The built-in renderer's HTML: the Markdown's own HTML passes through, made safe.
export function toHtml(list: Block[]): string {
  return sanitize(list.map(blockHtml).join('\n'))
}

function blockHtml(b: Block): string {
  switch (b.t) {
    case 'h': {
      const body = inline(b.text)
      return `<h${b.level} id="${slug(b.text)}">${body}</h${b.level}>`
    }
    case 'p':
      return `<p>${inline(b.text)}</p>`
    case 'code':
      return `<pre><code${b.lang ? ` class="language-${esc(b.lang)}"` : ''}>${esc(b.text)}</code></pre>`
    case 'quote':
      return `<blockquote>\n${toHtml(b.blocks)}\n</blockquote>`
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul'
      const hasTask = b.items.some(it => it.task !== undefined)
      const items = b.items.map(it => {
        // A one-paragraph item is drawn tight, as GitHub does.
        const inner = it.blocks.length >= 1 && it.blocks[0]?.t === 'p' ? [inline(it.blocks[0].text), ...it.blocks.slice(1).map(blockHtml)].join('\n') : toHtml(it.blocks)
        const box = it.task === undefined ? '' : `<input type="checkbox" class="task-list-item-checkbox" disabled${it.task ? ' checked' : ''}> `
        return `<li${it.task !== undefined ? ' class="task-list-item"' : ''}>${box}${inner}</li>`
      })
      const start = b.ordered && b.start !== 1 ? ` start="${b.start}"` : ''
      return `<${tag}${start}${hasTask ? ' class="contains-task-list"' : ''}>\n${items.join('\n')}\n</${tag}>`
    }
    case 'table': {
      const al = (i: number) => (b.align[i] ? ` align="${b.align[i]}"` : '')
      const head = b.head.map((c, i) => `<th${al(i)}>${inline(c)}</th>`).join('')
      const rows = b.rows.map(r => `<tr>${b.head.map((_c, i) => `<td${al(i)}>${inline(r[i] ?? '')}</td>`).join('')}</tr>`).join('\n')
      return `<table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody>\n</table>`
    }
    case 'hr':
      return '<hr>'
    case 'html':
      return b.text
    case 'mark':
      return '<div class="md-mark"></div>'
  }
}

// --- What changed ---

// Top-level chunks: runs of lines split by blank lines outside code fences.
export function chunks(md: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let fence = ''
  for (const l of md.replace(/\r\n?/g, '\n').split('\n')) {
    const f = l.match(FENCE)
    if (fence) {
      cur.push(l)
      if (new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`).test(l)) fence = ''
      continue
    }
    if (f) fence = f[1] as string
    if (isBlank(l) && !fence) {
      if (cur.length) out.push(cur.join('\n'))
      cur = []
      continue
    }
    cur.push(l)
  }
  if (cur.length) out.push(cur.join('\n'))
  return out
}

// The chunks of `after` that `before` did not have; none for a new file.
export function changedChunks(before: string | null, after: string): number[] {
  if (before === null || before.trim() === '') return []
  const old = new Map<string, number>()
  for (const c of chunks(before)) old.set(c.trim(), (old.get(c.trim()) ?? 0) + 1)
  const out: number[] = []
  chunks(after).forEach((c, i) => {
    const k = c.trim()
    const n = old.get(k) ?? 0
    if (n > 0) old.set(k, n - 1)
    else out.push(i)
  })
  return out
}

// The Markdown again, a MARK paragraph before each changed chunk that starts a block.
export function withMarks(md: string, marks: readonly number[]): string {
  if (marks.length === 0) return md
  const list = chunks(md)
  const at = new Set<number>()
  let start = -1 // the first chunk of the list run this chunk belongs to
  list.forEach((c, i) => {
    const isListish = ITEM.test(c) || indentOf(c) > 0
    start = isListish && i > 0 && start >= 0 && (ITEM.test(list[i - 1] as string) || indentOf(list[i - 1] as string) > 0) ? start : i
    if (marks.includes(i)) at.add(isListish ? start : i)
  })
  return list.map((c, i) => (at.has(i) && indentOf(c) < 4 ? `${MARK}\n\n${c}` : c)).join('\n\n')
}

// --- Text view ---

export type Seg = { text: string; bold?: boolean; italic?: boolean; dim?: boolean; color?: string; underline?: boolean; strike?: boolean }
export type Line = { prefix: string; segs: Seg[]; mark?: boolean }

const INLINE = /(`+)([\s\S]*?[^`])\1(?!`)|!\[([^\]]*)\]\([^)]*\)|\[((?:[^\]\\]|\\.)*)\]\(\s*([^)\s]*)[^)]*\)|<(https?:\/\/[^>\s]+)>|(\*\*|__)(?=\S)([\s\S]*?\S)\7|\*(?=\S)([^*]*?\S)\*|(?<![\w])_(?=\S)([^_]*?\S)_(?!\w)|~~([\s\S]*?)~~|<\/?[a-zA-Z][^<>]*>|<!--[\s\S]*?-->/g

export function segments(text: string): Seg[] {
  const out: Seg[] = []
  const plain = (t: string) => t && out.push({ text: t.replace(/\\([\\`*_{}[\]()#+\-.!|~<>])/g, '$1').replace(/\s*\n\s*/g, ' ') })
  let at = 0
  for (const m of text.matchAll(INLINE)) {
    plain(text.slice(at, m.index))
    at = (m.index ?? 0) + m[0].length
    if (m[2] !== undefined) out.push({ text: m[2].trim(), color: 'cyan' })
    else if (m[3] !== undefined) out.push({ text: `[image: ${m[3] || 'untitled'}]`, dim: true })
    else if (m[4] !== undefined) {
      out.push({ text: m[4].replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`]/g, ''), color: 'blue', underline: true })
      if (m[5] && !m[5].startsWith('#')) out.push({ text: ` (${m[5]})`, dim: true })
    } else if (m[6] !== undefined) out.push({ text: m[6], color: 'blue', underline: true })
    else if (m[8] !== undefined) out.push({ text: m[8], bold: true })
    else if (m[9] !== undefined) out.push({ text: m[9], italic: true })
    else if (m[10] !== undefined) out.push({ text: m[10], italic: true })
    else if (m[11] !== undefined) out.push({ text: m[11], strike: true })
    // an HTML tag or comment: dropped, its text stays
  }
  plain(text.slice(at))
  return out
}

const plainText = (segs: Seg[]) => segs.map(s => s.text).join('')

export function toLines(list: Block[], width = 80): Line[] {
  const out: Line[] = []
  let marked = false
  const push = (ls: Line[]) => {
    for (const l of ls) out.push(marked ? { ...l, mark: true } : l)
    marked = false
  }
  for (const b of list) {
    if (b.t === 'mark') {
      marked = true
      continue
    }
    if (out.length) out.push({ prefix: '', segs: [] })
    push(blockLines(b, width))
  }
  return out
}

function blockLines(b: Block, width: number): Line[] {
  switch (b.t) {
    case 'h': {
      const segs = segments(b.text).map(s => ({ ...s, bold: true, color: b.level <= 2 ? 'magenta' : 'cyan' }))
      const ls: Line[] = [{ prefix: '', segs }]
      if (b.level <= 2) ls.push({ prefix: '', segs: [{ text: '─'.repeat(Math.min(width, Math.max(8, plainText(segs).length))), dim: true }] })
      return ls
    }
    case 'p':
      return [{ prefix: '', segs: segments(b.text) }]
    case 'code':
      return b.text.split('\n').map(l => ({ prefix: '  │ ', segs: [{ text: l, dim: true }] }))
    case 'quote':
      return toLines(b.blocks, width - 2).map(l => ({ ...l, prefix: `▎ ${l.prefix}`, segs: l.segs.map(s => ({ ...s, dim: true })) }))
    case 'list': {
      const ls: Line[] = []
      b.items.forEach((it, n) => {
        const bullet = it.task === true ? '☑ ' : it.task === false ? '☐ ' : b.ordered ? `${b.start + n}. ` : '• '
        const pad = ' '.repeat(bullet.length)
        toLines(it.blocks, width - bullet.length)
          .filter(l => l.segs.length > 0)
          .forEach((l, k) => ls.push({ ...l, prefix: `${k === 0 ? bullet : pad}${l.prefix}` }))
      })
      return ls
    }
    case 'table': {
      const rows = [b.head, ...b.rows].map(r => b.head.map((_c, i) => plainText(segments(r[i] ?? ''))))
      const widths = b.head.map((_c, i) => Math.max(...rows.map(r => (r[i] ?? '').length)))
      const fmt = (r: string[]) => r.map((c, i) => c.padEnd(widths[i] ?? 0)).join(' │ ')
      const ls: Line[] = [{ prefix: '', segs: [{ text: fmt(rows[0] ?? []), bold: true }] }]
      ls.push({ prefix: '', segs: [{ text: widths.map(w => '─'.repeat(w)).join('─┼─'), dim: true }] })
      for (const r of rows.slice(1)) ls.push({ prefix: '', segs: [{ text: fmt(r) }] })
      return ls
    }
    case 'hr':
      return [{ prefix: '', segs: [{ text: '─'.repeat(Math.min(width, 40)), dim: true }] }]
    case 'html': {
      const alts = [...b.text.matchAll(/<img[^>]*\balt="([^"]*)"/gi)].map(m => `[image: ${m[1] || 'untitled'}]`)
      const text = b.text
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const all = [text, ...alts].filter(Boolean).join(' ')
      return all ? [{ prefix: '', segs: [{ text: all, dim: true }] }] : []
    }
    case 'mark':
      return []
  }
}
