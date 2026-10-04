import { describe, expect, mock, test } from 'claude-code/testing'

import { changedChunks, chunks, inline, parse, sanitize, toHtml, toLines, withMarks, MARK } from '../hooks/md'
import { absolute, fileUrl, markers, page } from '../hooks/page'
import { githubRepo, MD_FILE } from '../hooks/register'

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const PANE = { component: 'Pane', requestId: 'md-preview', props: { title: 'Markdown', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} } }

type Opts = { chrome?: boolean; gh?: 'ok' | 'fail' | 'missing'; term?: string; remote?: string; shFails?: boolean }

// Stands for the engine beneath the mod: a small disk, gh, git and Chrome.
function engine(on: any, opts: Opts = {}) {
  const disk: Record<string, string> = {
    '/repo/README.md': '# Title\n\nOld paragraph.\n\n- one\n- two\n',
    '/repo/docs/guide.md': '# Guide\n\nRead me.\n',
    '/repo/src/app.ts': 'export {}\n',
    '/repo/opt/a.md': '# Plan\n\nOption A text.\n',
    '/repo/opt/b.md': '# Plan\n\nOption B text.\n',
  }
  const runs: { argv: string[]; stdin?: string }[] = []
  const toasts: string[] = []
  const writes: Record<string, string> = {}
  let isOpen = false
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  const clock = mock.clock(on)
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: 'ok' }))
  on('tool.call', (_$: any, e: any) => {
    if (e.tool === 'Write') disk[e.file_path] = e.content
    if (e.tool === 'Edit') disk[e.file_path] = (disk[e.file_path] ?? '').replace(e.old_string, e.new_string)
    return { result: {}, text: 'ok' }
  })
  on('fs.read', (_$: any, e: any) => {
    if (disk[e.path] === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: disk[e.path] }
  })
  on('fs.write', (_$: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('fs.exists', (_$: any, e: any) => ({ value: e.path === CHROME ? opts.chrome !== false : e.path === '/usr/bin/open' ? true : disk[e.path] !== undefined }))
  on('env.get', (_$: any, e: any) => ({ value: ({ TERM_PROGRAM: opts.term ?? 'ghostty', TMPDIR: '/tmp/', HOME: '/home/me' } as Record<string, string>)[e.name] }))
  on('process.run', (_$: any, e: any) => {
    runs.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const cmd = e.argv[0]
    if (cmd === 'git' && e.argv[1] === 'ls-files') {
      const md = Object.keys(disk).filter(f => f.startsWith('/repo/') && /\.(md|mdx|markdown)$/.test(f)).map(f => f.slice('/repo/'.length))
      const sep = e.argv.includes('-z') ? '\0' : '\n'
      return { value: { exitCode: 0, stdout: md.join(sep) + sep, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd === 'git') return { value: { exitCode: 0, stdout: opts.remote ?? 'origin\tgit@github.com:someone/docs-repo.git (fetch)\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    if (cmd === 'gh') {
      if (opts.gh === 'missing') throw new Error('gh: not found')
      const ok = (opts.gh ?? 'ok') === 'ok'
      return { value: { exitCode: ok ? 0 : 1, stdout: ok ? '<h1 dir="auto">From GitHub</h1>' : '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (cmd === 'sh' && opts.shFails) throw new Error('timed out')
    return { value: { exitCode: 0, stdout: '300 2\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.open', () => ((isOpen = true), { value: { isPlaced: true } }))
  on('ui.close', () => ((isOpen = false), { value: undefined }))
  on('ui.panes', () => ({ value: isOpen ? [{ id: 'md-preview', title: 'Markdown', isShown: true, isFocused: true, isPlaced: true }] : [] }))
  return { disk, runs, toasts, writes, clock }
}

const settle = async () => {}
async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
  await $.turn.start({ text: 'update the docs', turnId: 't1' } as any)
}
const mount = ($: any, surface = 'terminal') => $.ui.mount({ plugin: 'md-preview', surface, ...PANE } as any)

describe('md-preview', () => {
  test('catches Markdown a shell command writes, and new files', async ($, on) => {
    const { disk, toasts } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'cat > README.md <<EOF ...' } as any) // snapshot before the first shell command
    disk['/repo/README.md'] = '# Title\n\nWritten by a shell.\n'
    disk['/repo/NOTES.md'] = '# Notes\n'
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await settle()
    expect(toasts).toContain('README.md changed · /md to preview')
    expect(toasts).toContain('NOTES.md changed · /md to preview')
    expect(toasts).toHaveLength(2) // untouched docs/guide.md and opt/*.md stay quiet
    const r = await $.command.run({ command: 'md', args: 'README.md' } as any)
    expect(JSON.stringify(r)).not.toContain('no Markdown edits')
  })

  test('a new file is caught even when the repo had no Markdown yet', async ($, on) => {
    const { disk, toasts } = engine(on)
    for (const f of Object.keys(disk)) if (/\.md$/.test(f)) delete disk[f]
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'echo hi > README.md' } as any)
    disk['/repo/README.md'] = '# Hi\n'
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await settle()
    expect(toasts).toEqual(['README.md changed · /md to preview'])
  })

  test('no shell command, no snapshot: outside edits during the turn are not reported', async ($, on) => {
    const { disk, toasts, runs } = engine(on)
    await start($)
    disk['/repo/README.md'] = '# Edited in your editor\n'
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await settle()
    expect(toasts).toEqual([])
    expect(runs.some(r => r.argv.includes('ls-files'))).toBe(false)
  })

  test('a Write/Edit change is not reported twice at turn end', async ($, on) => {
    const { toasts } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New paragraph.' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await settle()
    expect(toasts).toEqual(['README.md changed · /md to preview'])
  })

  test('a subagent starting mid-turn keeps the main turn tracking', async ($, on) => {
    const { toasts } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New paragraph.' } as any)
    await $.turn.start({ text: 'sub', turnId: 't1-sub', agentId: 'a1' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await settle()
    expect(toasts).toEqual(['README.md changed · /md to preview'])
  })

  test('tracks Markdown edits, ignores code files, toasts once per file per turn', async ($, on) => {
    const { toasts } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New paragraph.' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'one', new_string: 'uno' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/repo/src/app.ts', content: 'export const a = 1\n' } as any)
    await settle()
    expect(toasts).toEqual(['README.md changed · /md to preview'])
    await $.tool.call({ tool: 'Write', file_path: '/repo/docs/guide.md', content: '# Guide\n\nNew.\n' } as any)
    await settle()
    expect(toasts).toHaveLength(2)
    await $.turn.start({ text: 'again', turnId: 't2' } as any) // a new turn toasts again
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'two', new_string: 'dos' } as any)
    await settle()
    expect(toasts).toHaveLength(3)
    // A subagent's edit is not the main agent's.
    await $.tool.call({ tool: 'Edit', file_path: '/repo/docs/guide.md', old_string: 'New', new_string: 'Newer', agentId: 'ag1' } as any)
    await settle()
    expect(toasts).toHaveLength(3)
  })

  test('/md opens on the latest file; GitHub renders it; n/p switch files', async ($, on) => {
    const { runs, writes, clock } = engine(on)
    await start($)
    const empty = await $.command.run({ command: 'md', args: '' } as any)
    expect(empty.text).toMatch(/no Markdown edits yet/)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New paragraph.' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/repo/docs/guide.md', content: '# Guide\n\nNew.\n' } as any)
    await settle()
    const r = await $.command.run({ command: 'md', args: '' } as any)
    expect(r.text).toMatch(/guide\.md/) // the most recent
    const pane = await mount($)
    expect(await pane.find({ type: 'Text', text: /Rendering/ })).toBeDefined() // the text view while Chrome draws
    expect(await pane.find({ type: 'Text', text: /Read me|New\./ })).toBeDefined()
    await clock.advance(400)
    const gh = runs.find(x => x.argv[0] === 'gh')
    expect(gh?.argv).toEqual(['gh', 'api', '-X', 'POST', '/markdown', '--input', '-'])
    expect(JSON.parse(gh?.stdin ?? '{}')).toMatchObject({ mode: 'markdown', context: 'someone/docs-repo' })
    expect(runs.some(x => x.argv[0] === 'sh' && x.argv.includes(CHROME))).toBe(true)
    const html = Object.entries(writes).find(([p]) => p.endsWith('.html'))?.[1] ?? ''
    expect(html).toContain('From GitHub')
    expect(html).toContain('Content-Security-Policy')
    await pane.unmount()
    const drawn = await mount($)
    const images = await drawn.findAll({ type: 'Image' })
    expect(images).toHaveLength(2) // 300 rows: one part of 250, one of 50
    expect(await drawn.find({ type: 'Text', text: /GitHub/ })).toBeDefined()
    await drawn.press({ key: 'next' })
    expect(await drawn.find({ type: 'Text', text: /README\.md/ })).toBeDefined()
    await drawn.press({ key: 'prev' })
    expect(await drawn.find({ type: 'Text', text: /guide\.md/ })).toBeDefined()
    await drawn.unmount()
  })

  test('falls back to the built-in renderer when gh fails, and outside GitHub repos', async ($, on) => {
    const { runs, writes, clock } = engine(on, { gh: 'fail' })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New **bold** paragraph.' } as any)
    await settle()
    await $.command.run({ command: 'md', args: '' } as any)
    const pane = await mount($)
    await clock.advance(400)
    const html = Object.entries(writes).find(([p]) => p.endsWith('.html'))?.[1] ?? ''
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<div class="md-mark"></div>') // the changed paragraph is marked
    expect(runs.filter(x => x.argv[0] === 'gh')).toHaveLength(1)
    await pane.unmount()
    const drawn = await mount($)
    expect(await drawn.find({ type: 'Text', text: /built-in/ })).toBeDefined()
    await drawn.unmount()
  })

  test('no GitHub remote: nothing is sent to gh', async ($, on) => {
    const { runs, clock } = engine(on, { remote: 'origin\tgit@gitlab.com:a/b.git (fetch)\n' })
    await start($)
    await $.command.run({ command: 'md', args: 'README.md' } as any)
    const pane = await mount($)
    await clock.advance(400)
    expect(runs.some(x => x.argv[0] === 'gh')).toBe(false)
    expect(runs.some(x => x.argv[0] === 'sh')).toBe(true)
    await pane.unmount()
  })

  test('/md <path> opens a given file; a bad path says so', async ($, on) => {
    engine(on)
    await start($)
    expect((await $.command.run({ command: 'md', args: 'nope.md' } as any)).text).toMatch(/no file at \/repo\/nope\.md/)
    expect((await $.command.run({ command: 'md', args: 'src/app.ts' } as any)).text).toMatch(/give a \.md/)
    expect((await $.command.run({ command: 'md', args: './docs/../docs/guide.md' } as any)).text).toMatch(/guide\.md/)
  })

  test('text view when there is no Chrome, with changed blocks marked', async ($, on) => {
    const { runs, clock } = engine(on, { chrome: false })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'A [link](https://example.com) here.' } as any)
    await settle()
    await $.command.run({ command: 'md', args: '' } as any)
    const pane = await mount($)
    await clock.advance(400)
    await pane.unmount()
    const drawn = await mount($)
    expect(await drawn.find({ type: 'Text', text: /needs Google Chrome/ })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: /\(https:\/\/example\.com\)/ })).toBeDefined()
    expect(await drawn.find({ type: 'Text', text: '▌' })).toBeDefined()
    expect(await drawn.find({ type: 'Image' })).toBeUndefined()
    expect(runs.some(x => x.argv[0] === 'sh')).toBe(false)
    await drawn.unmount()
  })

  test('text view in a terminal without pictures, and on desktop', async ($, on) => {
    const { runs, clock } = engine(on, { term: 'Apple_Terminal' })
    await start($)
    await $.command.run({ command: 'md', args: 'README.md' } as any)
    for (const surface of ['terminal', 'desktop'] as const) {
      const pane = await mount($, surface)
      await clock.advance(400)
      expect(await pane.find({ type: 'Text', text: /Title/ })).toBeDefined()
      expect(await pane.find({ type: 'Text', text: /• / })).toBeDefined()
      await pane.unmount()
    }
    expect(runs.some(x => x.argv[0] === 'sh')).toBe(false)
  })

  test('re-renders when the shown file changes again', async ($, on) => {
    const { runs, writes, clock, toasts } = engine(on, { gh: 'missing' })
    await start($)
    await $.command.run({ command: 'md', args: 'README.md' } as any)
    const pane = await mount($)
    await clock.advance(400)
    const before = runs.filter(x => x.argv[0] === 'sh').length
    expect(before).toBe(1)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'Fresh words.' } as any)
    await settle()
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'sh').length).toBe(2)
    expect(Object.values(writes).some(t => t.includes('Fresh words.'))).toBe(true)
    expect(toasts).toHaveLength(0) // it is on screen: no toast
    await pane.press({ key: 'again' })
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'sh').length).toBe(3)
    await pane.unmount()
  })

  test('b shows the file before the last edit next to it, stacked when narrow', async ($, on) => {
    const { writes, clock } = engine(on, { gh: 'missing' })
    await start($)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'Fresh paragraph.' } as any)
    await $.command.run({ command: 'md', args: '' } as any)
    const wide = await $.ui.mount({ plugin: 'md-preview', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 160 } } as any)
    await clock.advance(400)
    await wide.press({ key: 'before' })
    await clock.advance(400)
    const last = () => Object.entries(writes).filter(([p]) => p.endsWith('.html')).map(([, t]) => t).find(t => t.includes('Before')) ?? ''
    expect(last()).toContain('<div class="label">Before</div>')
    expect(last()).toContain('<div class="label">After</div>')
    expect(last()).toContain('Old paragraph.') // the text before the edit
    expect(last()).toContain('Fresh paragraph.')
    expect(last()).toContain('grid-template-columns') // side by side
    await wide.unmount()
    const narrow = await mount($) // 100 columns: stacked
    await clock.advance(400)
    const stacked = Object.values(writes).filter(t => t.includes('Before'))
    expect(stacked.some(t => !t.includes('grid-template-columns'))).toBe(true)
    expect(await narrow.find({ type: 'Text', text: /before \| after/ })).toBeDefined()
    await narrow.press({ key: 'view' }) // the text view shows both, labeled
    expect(await narrow.find({ type: 'Text', text: /── Before ──/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /── After ──/ })).toBeDefined()
    await narrow.unmount()
  })

  test('/md compare <a> <b> renders two files side by side under their names', async ($, on) => {
    const { writes, clock } = engine(on, { gh: 'missing' })
    await start($)
    expect((await $.command.run({ command: 'md', args: 'compare opt/a.md' } as any)).text).toMatch(/compare <fileA> <fileB>/)
    expect((await $.command.run({ command: 'md', args: 'compare opt/a.md opt/zz.md' } as any)).text).toMatch(/no file at/)
    const r = await $.command.run({ command: 'md', args: 'compare opt/a.md opt/b.md' } as any)
    expect(r.text).toMatch(/a\.md \| b\.md side by side/)
    const pane = await $.ui.mount({ plugin: 'md-preview', surface: 'terminal', ...PANE, props: { ...PANE.props, bodyColumns: 160 } } as any)
    await clock.advance(400)
    const html = Object.values(writes).find(t => t.includes('Option A')) ?? ''
    expect(html).toContain('<div class="label">a.md</div>')
    expect(html).toContain('<div class="label">b.md</div>')
    expect(html).toContain('Option B text.')
    expect(html).toContain('<div class="md-mark"></div>\n<p>Option B text.</p>') // what B has that A does not
    await pane.unmount()
  })

  test('o and /md open open the page in the browser from a temp file', async ($, on) => {
    const { runs, writes } = engine(on, { gh: 'missing' })
    await start($)
    expect((await $.command.run({ command: 'md', args: 'open' } as any)).text).toMatch(/nothing to open yet/)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'New paragraph.' } as any)
    const r = await $.command.run({ command: 'md', args: 'open' } as any)
    expect(r.text).toMatch(/opened README\.md in the browser/)
    const open = runs.find(x => x.argv[0] === 'open')
    expect(open?.argv[1]).toMatch(/^\/tmp\/md-preview\/open-\d+\.html$/)
    const page = writes[open?.argv[1] ?? ''] ?? ''
    expect(page).toContain('New paragraph.')
    expect(page).toContain('<style>') // self-contained
    expect(page).toContain('margin:0 auto')
    await $.command.run({ command: 'md', args: '' } as any)
    const pane = await mount($)
    await pane.press({ key: 'open' })
    expect(runs.filter(x => x.argv[0] === 'open')).toHaveLength(2)
    await pane.unmount()
  })

  test('review fixes: one Chrome at a time, no retry loop, the first text of the turn, big files', async ($, on) => {
    const { runs, clock, disk } = engine(on, { gh: 'missing' })
    await start($)
    await $.command.run({ command: 'md', args: 'README.md' } as any)
    const pane = await mount($)
    await $.command.run({ command: 'md', args: 'README.md' } as any) // asks again while the first waits
    await clock.advance(400)
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'sh')).toHaveLength(1) // one draw for one state
    const sh = runs.find(x => x.argv[0] === 'sh')
    expect(sh?.argv[5]).toMatch(/^file:\/\/\/tmp\/md-preview\/page-\d\.html$/) // a URL, not a bare path
    // Two edits in one turn: b compares with the text before the first.
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Old paragraph.', new_string: 'Step one.' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/README.md', old_string: 'Step one.', new_string: 'Step two.' } as any)
    await clock.advance(400)
    await pane.press({ key: 'view' })
    await pane.press({ key: 'before' })
    expect(await pane.find({ type: 'Text', text: /Old paragraph\./ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Step two\./ })).toBeDefined()
    await pane.unmount()
    // Over GitHub's size limit: the built-in renderer, and gh is not asked.
    disk['/repo/big.md'] = `# Big\n\n${'word '.repeat(90_000)}\n`
    const ghBefore = runs.filter(x => x.argv[0] === 'gh').length
    await $.command.run({ command: 'md', args: 'big.md' } as any)
    const big = await mount($)
    await big.press({ key: 'view' })
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'gh').length).toBe(ghBefore)
    await big.unmount()
  })

  test('a draw that throws is not retried on every redraw', async ($, on) => {
    const { runs, clock } = engine(on, { gh: 'missing', shFails: true })
    await start($)
    await $.command.run({ command: 'md', args: 'README.md' } as any)
    const pane = await mount($)
    for (let k = 0; k < 4; k++) await clock.advance(400)
    await pane.unmount()
    const again = await mount($)
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'sh')).toHaveLength(1)
    expect(await again.find({ type: 'Text', text: /Could not draw the page/ })).toBeDefined()
    await again.press({ key: 'again' }) // r tries once more
    await clock.advance(400)
    expect(runs.filter(x => x.argv[0] === 'sh')).toHaveLength(2)
    await again.unmount()
  })

  test('the built-in renderer is safe and handles real READMEs', () => {
    const bad = toHtml(parse('a <b>x</b> <script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror="alert(1)">\n\n<iframe src="https://e.com"></iframe>'))
    expect(bad).not.toMatch(/<script|onerror|javascript:|<iframe/i)
    expect(bad).toContain('<b>x</b>')
    expect(sanitize('<a href="JaVaScRiPt:x" onclick=go()>y</a>')).toBe('<a href="#">y</a>')
    const p0 = page([{ html: '<p>x</p>', dir: '/r' }], { title: 't', width: 900 })
    const nonce = p0.match(/'nonce-([0-9a-f]+)'/)?.[1] ?? ''
    expect(nonce).toHaveLength(24)
    expect(p0).toContain(`<script nonce="${nonce}">`) // only the page's own script runs
    expect(p0).toContain("default-src 'none'")
    expect(toHtml(parse('[wiki](https://en.wikipedia.org/wiki/Foo_(bar))'))).toContain('<a href="https://en.wikipedia.org/wiki/Foo_(bar)">wiki</a>')
    expect(toHtml(parse('AT&amp;T &copy; 1 & 2'))).toContain('AT&amp;T &copy; 1 &amp; 2')
    expect(toHtml(parse('`\\d+\\.` and `a\\*b`'))).toContain('<code>\\d+\\.</code> and <code>a\\*b</code>')
    const refs = toHtml(parse('See [docs][1] and [Home][].\n\n[1]: https://x.dev/docs\n[home]: https://x.dev'))
    expect(refs).toContain('<a href="https://x.dev/docs">docs</a>')
    expect(refs).toContain('<a href="https://x.dev">Home</a>')
    expect(refs).not.toContain('[1]:')
    expect(toHtml(parse('para\n\n    indented code\n    more'))).toContain('<pre><code>indented code\nmore</code></pre>')
    expect(toHtml(parse('<kbd>Ctrl</kbd> is **bold**'))).toContain('<strong>bold</strong>')
    expect(toHtml(parse('<!-- a\n\nb -->\n\ntext'))).toContain('<p>text</p>')
    expect(toHtml(parse('<!-- a\n\nb -->\n\ntext'))).not.toContain('<p>b')
    // A changed item in a loose list marks the list, and the list stays one.
    const marked = toHtml(parse(withMarks('- a\n\n- b changed\n\n- c\n', [1])))
    expect(marked.match(/<ul>/g)).toHaveLength(1)
    expect(marked.startsWith('<div class="md-mark"></div>')).toBe(true)
  })

  test('relative paths change inside tags only', () => {
    const out = absolute(`<p><img src='a.png'> <img srcset="x.png 1x, https://c.dev/y.png 2x"></p><pre>&lt;a href="foo.html"&gt; href="bar.html"</pre>`, '/r/my #1 docs')
    expect(out).toContain('src="file:///r/my%20%231%20docs/a.png"')
    expect(out).toContain('srcset="file:///r/my%20%231%20docs/x.png 1x, https://c.dev/y.png 2x"')
    expect(out).toContain('href="bar.html"') // text, not an attribute
    expect(fileUrl('/tmp/a b#c.html')).toBe('file:///tmp/a%20b%23c.html')
  })

  test('the built-in renderer', () => {
    const html = toHtml(
      parse(
        [
          '# Hello *world*',
          '',
          'Some `code <b>` and **bold** and [a link](https://x.dev/a_b_c) and ![logo](img/logo.png).',
          '',
          '- one',
          '- [x] done',
          '  - nested',
          '',
          '1. first',
          '2. second',
          '',
          '> quoted **text**',
          '',
          '```ts',
          'const a = 1 < 2',
          '```',
          '',
          '| Name | Count |',
          '| :--- | ---: |',
          '| a \\| b | 2 |',
          '',
          '<p align="center"><img src="x.png"></p>',
          '',
          'Setext',
          '======',
          '',
          '---',
          '',
          'Visit https://example.com today.',
        ].join('\n'),
      ),
    )
    expect(html).toContain('<h1 id="hello-world">Hello <em>world</em></h1>')
    expect(html).toContain('<code>code &lt;b&gt;</code>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<a href="https://x.dev/a_b_c">a link</a>') // underscores in URLs stay
    expect(html).toContain('<img src="img/logo.png" alt="logo">')
    expect(html).toContain('<li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled checked> done')
    expect(html).toContain('<ul>\n<li>nested</li>\n</ul>')
    expect(html).toContain('<ol>\n<li>first</li>\n<li>second</li>\n</ol>')
    expect(html).toContain('<blockquote>\n<p>quoted <strong>text</strong></p>\n</blockquote>')
    expect(html).toContain('<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>')
    expect(html).toContain('<th align="left">Name</th><th align="right">Count</th>')
    expect(html).toContain('<td align="left">a | b</td>')
    expect(html).toContain('<p align="center"><img src="x.png"></p>') // inline HTML passes through
    expect(html).toContain('<h1 id="setext">Setext</h1>')
    expect(html).toContain('<hr>')
    expect(html).toContain('<a href="https://example.com">https://example.com</a> today.')
    expect(inline('a <kbd>Ctrl</kbd> & b')).toBe('a <kbd>Ctrl</kbd> &amp; b')
    expect(inline('2 * 3 * 4')).toBe('2 * 3 * 4')
    expect(inline('snake_case_name')).toBe('snake_case_name')
  })

  test('changed blocks, marks and the text lines', () => {
    const before = '# T\n\nPara one.\n\n```\ncode\n\nmore\n```\n\nPara two.\n'
    const after = '# T\n\nPara one, edited.\n\n```\ncode\n\nmore\n```\n\nPara two.\n'
    expect(chunks(after)).toHaveLength(4) // the fence keeps its blank line
    expect(changedChunks(before, after)).toEqual([1])
    expect(changedChunks(null, after)).toEqual([]) // a new file: nothing marked
    const marked = withMarks(after, [1])
    expect(marked).toContain(`${MARK}\n\nPara one, edited.`)
    expect(toHtml(parse(marked))).toContain('<div class="md-mark"></div>\n<p>Para one, edited.</p>')
    expect(markers(`<p dir="auto">${MARK}</p>`)).toBe('<div class="md-mark"></div>')
    const lines = toLines(parse(marked))
    const edited = lines.find(l => l.segs.some(s => s.text.includes('edited')))
    expect(edited?.mark).toBe(true)
    expect(lines.find(l => l.segs.some(s => s.text === 'Para two.'))?.mark).toBeUndefined()
    const one = page([{ html: '<p><img src="img/a.png"> <a href="#x">x</a> <a href="https://g.com">g</a> <img src="/abs.png"></p>', dir: '/a b' }], { title: 'R', width: 900 })
    expect(one).toContain('src="file:///a%20b/img/a.png"') // local images load from the file's folder
    expect(one).toContain('href="#x"')
    expect(one).toContain('href="https://g.com"')
    expect(one).toContain('src="file:///abs.png"')
    expect(one).toContain('body{width:900px}')
    const two = page([{ label: 'Before', html: '<p>a</p>', dir: '/r' }, { label: 'After', html: '<p>b</p>', dir: '/r' }], { title: 'R', width: 0 })
    expect(two).toContain('grid-template-columns:repeat(2,minmax(0,1fr))')
    expect(two).toContain('<div class="label">Before</div>')
    expect(two).toContain('margin:0 auto') // the browser's page: centered, any width
    expect(page([{ html: 'a', dir: '/' }, { html: 'b', dir: '/' }], { title: 'R', width: 500, stacked: true })).not.toContain('grid-template-columns')
  })

  test('helpers', () => {
    expect(githubRepo('origin\tgit@github.com:hamzafer/claude-code-mods.git (fetch)')).toBe('hamzafer/claude-code-mods')
    expect(githubRepo('origin\thttps://github.com/a/b (fetch)')).toBe('a/b')
    expect(githubRepo('origin\tgit@gitlab.com:a/b.git (fetch)')).toBeNull()
    expect(githubRepo('origin\thttps://evil.com/github.com/x/y (fetch)')).toBeNull()
    expect(githubRepo('mirror\tgit@gitlab.com:a/b.git (fetch)\norigin\tssh://git@github.com/c/d.git (fetch)')).toBe('c/d')
    expect(MD_FILE.test('README.md') && MD_FILE.test('x.MDX') && MD_FILE.test('a.markdown')).toBe(true)
    expect(MD_FILE.test('a.ts')).toBe(false)
  })
})
