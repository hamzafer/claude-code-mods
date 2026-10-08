import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'reels',
  props: { title: 'Reels', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
}

// Stands for the engine beneath the mod: a home folder, a fake helper and its socket.
function engine(on: any, opts: { installed: boolean }) {
  const sent: string[] = []
  const spawned: string[][] = []
  let running = false
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('fs.exists', () => ({ value: opts.installed }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', () => ({ value: {} }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('http.fetch', (_$: any, e: any) => {
    const path = new URL(e.url).pathname
    sent.push(path)
    if (!running) throw new Error('ECONNREFUSED')
    if (path === '/quit') running = false
    return { value: { status: 200, ok: true, headers: {}, text: 'ok' } }
  })
  on('process.spawn', async function* (_$: any, e: any) {
    spawned.push(e.argv)
    if (e.argv.at(-1) !== 'pane') return { code: 0 }
    running = true
    yield { stream: 'stdout', text: 'R ready\nF 1 /Users/me/.claude-mods/reels/frames/f-1.png\n' }
    while (running) await new Promise(done => (globalThis as any).setTimeout(done, 5))
    return { code: 0 }
  })
  return { sent, spawned }
}

const until = async (check: () => Promise<unknown>) => {
  for (let i = 0; i < 200; i++) {
    if (await check()) return
    await new Promise(done => (globalThis as any).setTimeout(done, 5))
  }
}

describe('reels', () => {
  test('/reels without Playwright says how to install it, and starts nothing', async ($, on) => {
    const h = engine(on, { installed: false })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r: any = await $.command.run({ command: 'reels', args: '' } as any)
    expect(r.text).toMatch(/npm install --prefix \/Users\/me\/\.claude-mods\/reels playwright@1\.63\.0/)
    expect(h.spawned).toEqual([])
  })

  test('nothing starts on its own: a turn without /reels spawns no helper', async ($, on) => {
    const h = engine(on, { installed: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(h.spawned).toEqual([])
  })

  test('/reels starts the helper, draws the frame, and follows the turns', async ($, on) => {
    const h = engine(on, { installed: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'reels', args: '' } as any)
    expect(h.spawned[0]?.at(-1)).toBe('pane')

    let ui: any = null
    await until(async () => {
      if (ui) await ui.unmount()
      ui = await $.ui.mount({ plugin: 'reels', surface: 'terminal', ...PANE } as any)
      return ui.find({ type: 'Image', key: 'reel' })
    })
    expect(await ui.find({ type: 'Image', key: 'reel' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Claude's done, your turn/ })).toBeDefined()

    await $.turn.start({ text: 'go', turnId: 't1' } as any)
    expect(h.sent).toContain('/play')
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(h.sent.at(-1)).toBe('/pause')

    await ui.press({ key: 'next' })
    await until(async () => h.sent.includes('/next'))
    expect(h.sent).toContain('/next')

    await ui.press({ key: 'stop' })
    await until(async () => h.sent.includes('/quit'))
    expect(h.sent).toContain('/quit')
    await ui.unmount()
  })
})
