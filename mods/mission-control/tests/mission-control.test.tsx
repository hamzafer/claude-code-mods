import { describe, expect, mock, test } from 'claude-code/testing'

import { edges, fit, importsOf, layout, svg, titleOf, wrap } from '../hooks/map'
import { label, lines, summary } from '../hooks/tree'
import { cap } from '../hooks/register'

let mockClock: any
const PANE = { component: 'Pane', requestId: 'mission-control', props: { title: 'Mission Control', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } }
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 120 } }

// Stands for the engine beneath the mod.
function engine(on: any, opts: { noChrome?: boolean } = {}) {
  const runs: string[][] = []
  const writes: Record<string, string> = {}
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  const clock = mock.clock(on)
  mockClock = clock
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('agent.spawn', () => ({ model: 'sonnet', agentId: 'ag1' }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('fs.read', (_$: any, e: any) => ({ value: e.path.endsWith('login.tsx') ? "import { start } from '../auth/session'\n" : '' }))
  on('fs.write', (_$: any, e: any) => ((writes[e.path] = e.text), { value: undefined }))
  on('fs.exists', () => ({ value: !opts.noChrome }))
  on('env.get', () => ({ value: '/tmp/' }))
  on('process.run', (_$: any, e: any) => (runs.push(e.argv), { value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [{ id: 'mission-control', title: 'Mission Control', isShown: true, isFocused: true, isPlaced: true }] }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '["tokens now expire after an hour"]', usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  return { runs, writes, clock }
}

describe('mission-control', () => {
  test('bug fixes from the demo video', () => {
    // 1. An import that skips a column arcs over the card between instead of hiding behind it.
    const f = (path: string, imports: string[]) => ({ path, act: 'edit' as const, at: 0, changedTurn: 1, imports })
    const chain = [f('/r/a.ts', ['/r/b', '/r/c']), f('/r/b.ts', ['/r/c']), f('/r/c.ts', [])]
    const out = svg(chain, { width: 1200, height: 600, at: 99_999, turn: 1 })
    const paths = [...out.matchAll(/<path d="M(-?[\d.]+),(-?[\d.]+) C-?[\d.]+,(-?[\d.]+)/g)].map(m => ({ y: Number(m[2]), peak: Number(m[3]) }))
    expect(paths).toHaveLength(3)
    expect(paths.some(p => p.peak < p.y - 20)).toBe(true) // the a → c arrow goes up and over
    // 4. A small graph in a roomy picture is drawn larger, text included.
    expect(out).toContain('scale(1.500)')
  })


  test('review fixes: the cap keeps main, a turn ending closes stuck calls, no Chrome says so', async ($, on) => {
    const many = [
      { id: 'main', parent: null, kind: 'main' as const, label: 'main', family: 'main', status: 'running' as const, start: 0 },
      { id: 'ag', parent: 'main', kind: 'agent' as const, label: 'a', family: 'agent', status: 'running' as const, start: 0 },
      ...Array.from({ length: 400 }, (_, i) => ({ id: `t${i}`, parent: 'main', kind: 'tool' as const, label: 'x', family: 'bash', status: 'done' as const, start: i })),
    ]
    const kept = cap(many)
    expect(kept).toHaveLength(300)
    expect(kept[0]?.id).toBe('main')
    expect(kept.some(n => n.id === 'ag')).toBe(true)
    expect(kept.at(-1)?.id).toBe('t399') // the newest calls stay
    const crowd = Array.from({ length: 310 }, (_, i) => ({ id: `a${i}`, parent: 'main', kind: 'agent' as const, label: 'a', family: 'agent', status: 'done' as const, start: i }))
    expect(cap([...crowd, ...many.slice(2)]).filter(n => n.kind === 'tool')).toHaveLength(0) // no room left: no tool calls

    const { runs } = engine(on, { noChrome: true }) // no Chrome on this machine
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    await $.command.run({ command: 'mission', args: 'code' } as any)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/a.ts' } as any)
    await mockClock.advance(800)
    expect(await pane.find({ type: 'Text', text: /needs Google Chrome/ })).toBeDefined()
    expect(runs.some(a => a[0] === 'sh')).toBe(false)
    await pane.unmount()
  })

  test('a background agent still running keeps its open calls when main ends', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    await $.agent.spawn({ prompt: 'p', description: 'long runner' } as any) // agent ag1, background
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any) // main ends, ag1 runs on
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    expect(await pane.find({ type: 'Text', text: /1 agents \(1 running\)/ })).toBeDefined() // still running
    await pane.unmount()
  })

  test('labels tool calls by family', () => {
    expect(label({ tool: 'Bash', description: 'Run tests' })).toEqual({ label: 'Run tests', family: 'bash' })
    expect(label({ tool: 'mcp__playwright__browser_click' })).toEqual({ label: 'click', family: 'browser' })
    expect(label({ tool: 'mcp__claude_ai_Slack__slack_send_message' })).toEqual({ label: 'slack_send_message', family: 'mcp:Slack' })
  })

  test('the who tree nests agents and folds runs of one tool family', () => {
    const at = 10_000
    const ls = lines(
      [
        { id: 'main', parent: null, kind: 'main', label: 'main · fix login', family: 'main', status: 'running', start: 0 },
        { id: 'a', parent: 'main', kind: 'agent', label: 'test login flow', family: 'agent', status: 'running', start: 1000 },
        { id: 't1', parent: 'a', kind: 'tool', label: 'navigate', family: 'browser', status: 'done', start: 1000, end: 2000 },
        { id: 't2', parent: 'a', kind: 'tool', label: 'click', family: 'browser', status: 'running', start: 2000 },
        { id: 't3', parent: 'main', kind: 'tool', label: 'npm test', family: 'bash', status: 'failed', start: 3000, end: 4000 },
      ],
      at,
    )
    expect(ls.map(l => l.prefix + l.text)).toEqual([
      '◆ main · fix login  10s',
      '├─ ● test login flow  9.0s · 2 tools',
      '│  └─ ◎ browser: navigate → click  ×2  9.0s',
      '└─ $ bash: npm test  1.0s',
    ])
    expect(ls[2]?.status).toBe('running')
    expect(ls[3]?.status).toBe('failed')
  })

  test('the code map finds imports, columns and draws an SVG', () => {
    expect(importsOf('/r/src/pages/login.tsx', "import { a } from '../auth/session'\nconst b = require('./x.js')")).toEqual(['/r/src/auth/session', '/r/src/pages/x'])
    expect(importsOf('/r/app/views.py', 'from .models import User\nfrom ..core.db import q')).toEqual(['/r/app/models', '/r/core/db'])
    const files = [
      { path: '/r/a.ts', act: 'read' as const, at: 0, changedTurn: 0, imports: ['/r/b'] },
      { path: '/r/b.ts', act: 'edit' as const, at: 0, changedTurn: 2, imports: [], why: 'adds a & b <check>' },
    ]
    expect(edges(files)).toEqual([{ from: '/r/a.ts', to: '/r/b.ts' }])
    expect(layout(files, edges(files))).toEqual([['/r/a.ts'], ['/r/b.ts']])
    const out = svg(files, { width: 800, height: 400, at: 99_999, turn: 2 })
    expect(out).toContain('1 changed')
    expect(out).toContain('adds a &amp; b &lt;check&gt;')
    expect(fit('tokens now expire after one hour', 20)).toBe('tokens now expire…')
    const regs = ['/m/merge-gate/hooks/register.tsx', '/m/snake/hooks/register.tsx']
    expect(titleOf(regs[0] as string, regs)).toBe('merge-gate › register.tsx')
    expect(titleOf('/m/a/login.tsx', regs)).toBe('login.tsx')
    expect(wrap('Added userId validation before login', 20)).toEqual(['Added userId', 'validation before login'])
  })

  test('a turn fills the tree, the band sums it up, and /mission code draws the map', async ($, on) => {
    const { runs, writes, clock } = engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' } as any)
    await $.turn.start({ text: 'fix the login bug', turnId: 't1' } as any)
    await $.agent.spawn({ prompt: 'check it', description: 'test login flow' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/repo/src/pages/login.tsx' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/src/auth/session.ts', old_string: 'a', new_string: 'b' } as any)

    const band = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...BAND } as any)
    expect(await band.find({ type: 'Text', text: /1\/1 agents · 2 tools · 1 files changed/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await band.unmount()

    const r = await $.command.run({ command: 'mission', args: '' } as any)
    expect(r.text).toMatch(/1 agents · 2 tool calls · 2 files/)
    const pane = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE } as any)
    expect(await pane.find({ type: 'Text', text: /◆ main · fix the login bug/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /● test login flow/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /✎ edit: auth\/session\.ts/ })).toBeDefined()

    // 2. Images are not code: a screenshot read now stays off the map.
    await $.tool.call({ tool: 'Read', file_path: '/repo/shots/v2.png' } as any)
    // 5. Claude Code's own bookkeeping is not a tool call in the tree.
    await $.tool.call({ tool: 'SubagentHandback', summary: 'done' } as any)
    expect(await pane.find({ type: 'Text', text: /SubagentHandback/ })).toBeUndefined()

    await $.turn.complete({ reason: 'answer', answer: 'done', durationMs: 1 } as any)
    await pane.press({ key: 'code' })
    await clock.advance(800) // the map draws a moment after a change
    const map = writes['/tmp/mission-control/map.svg'] ?? ''
    expect(map).toContain('login.tsx')
    expect(map).toContain('session.ts')
    expect(map).not.toContain('v2.png')
    expect(map).toContain('marker-end="url(#a)"') // the import arrow login → session
    expect(runs.some(a => a[0] === 'sh' && a.includes('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'))).toBe(true)
    expect(await pane.find({ type: 'Image' })).toBeDefined()
    await clock.advance(800) // the "why" lines redraw the map
    const drawn = writes['/tmp/mission-control/map.svg'] ?? ''
    expect(drawn).toContain('tokens now expire') // the why, wrapped over two lines
    expect(drawn).toContain('after an hour')
    await pane.unmount()
    // 3. In a tall enough pane the picture's size follows the width alone: two heights, one size.
    const rowsAt = async (bodyRows: number) => {
      const tall = await $.ui.mount({ plugin: 'mission-control', surface: 'terminal', ...PANE, props: { ...PANE.props, scroll: { offset: 0, bodyRows } } } as any)
      const img: any = await tall.find({ type: 'Image' })
      await tall.unmount()
      return img?.props?.rows ?? img?.rows
    }
    expect(await rowsAt(50)).toBe(30)
    expect(await rowsAt(60)).toBe(30)
    expect(summary([]).tools).toBe(0)
  })
})
