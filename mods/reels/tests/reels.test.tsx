import { describe, expect, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'reels',
  props: { title: 'Reels', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } },
}

// Stands for the engine beneath the mod: a home folder, a fake helper and its socket. With `win` set it is Windows, where
// the helper has a loopback port and a token in a file instead of a socket; `portFile` is what that file holds.
function engine(on: any, opts: { installed: boolean; win?: string; portFile?: string | null }) {
  const sent: string[] = []
  const spawned: string[][] = []
  const fetched: { url: string; token?: string; socket?: string }[] = []
  const blits: string[] = []
  const home = opts.win === undefined ? '/Users/me' : opts.win.replace(/\\/g, '/')
  let running = false
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', (_$: any, e: any) => ({ value: opts.win === undefined ? '/Users/me' : ({ OS: 'Windows_NT', USERPROFILE: opts.win } as Record<string, string>)[e.name] }))
  on('fs.exists', () => ({ value: opts.installed }))
  on('fs.read', () => (opts.portFile === null ? { deny: 'ENOENT' } : { value: opts.portFile ?? JSON.stringify({ port: 4321, token: 'tok' }) }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.blit', (_$: any, e: any) => (blits.push(e.source.file), { value: {} }))
  on('ui.log', () => ({ value: undefined }))
  on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('http.fetch', (_$: any, e: any) => {
    const path = new URL(e.url).pathname
    sent.push(path)
    fetched.push({ url: e.url, token: e.init?.headers?.['x-reels-token'], socket: e.init?.socketPath })
    if (!running) throw new Error('ECONNREFUSED')
    if (path === '/quit') running = false
    return { value: { status: 200, ok: true, headers: {}, text: 'ok' } }
  })
  on('process.spawn', async function* (_$: any, e: any) {
    spawned.push(e.argv)
    if (e.argv.at(-1) !== 'pane') return { code: 0 }
    running = true
    yield { stream: 'stdout', text: `R ready\nF 1 ${home}/.claude-mods/reels/frames/f-1.png\n` }
    while (running) await new Promise(done => (globalThis as any).setTimeout(done, 5))
    return { code: 0 }
  })
  return { sent, spawned, fetched, blits }
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

  test('macOS and Linux: node through env, and the Unix socket', async ($, on) => {
    const h = engine(on, { installed: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'reels', args: '' } as any)
    expect(h.spawned[0]?.slice(0, 2)).toEqual(['/usr/bin/env', 'node'])
    expect(h.spawned[0]?.[3]).toBe('/Users/me/.claude-mods/reels/ctl.sock')
    expect(h.fetched[0]).toMatchObject({ url: 'http://reels/state', socket: '/Users/me/.claude-mods/reels/ctl.sock' })
  })

  test('Windows: node on PATH, and the helper is reached on loopback with its token', async ($, on) => {
    const h = engine(on, { installed: true, win: 'C:\\Users\\me' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    await $.command.run({ command: 'reels', args: '' } as any)
    expect(h.spawned[0]?.[0]).toBe('node')
    expect(h.spawned[0]?.slice(2)).toEqual(['C:/Users/me/.claude-mods/reels/ctl.json', 'C:/Users/me/.claude-mods/reels/profile', 'C:/Users/me/.claude-mods/reels/frames', 'pane'])
    expect(h.fetched.length).toBeGreaterThan(0)
    expect(h.fetched.every(f => f.url.startsWith('http://127.0.0.1:4321/') && f.token === 'tok' && f.socket === undefined)).toBe(true)
  })

  for (const [what, portFile] of [['missing', null], ['not JSON', 'not json'], ['null', 'null'], ['a number', '5'], ['without a port', '{"token":"t"}'], ['without a token', '{"port":4321}']] as const) {
    test(`Windows: a port file that is ${what} means the helper is not running`, async ($, on) => {
      const h = engine(on, { installed: true, win: 'C:\\Users\\me', portFile })
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
      await $.command.run({ command: 'reels', args: '' } as any)
      expect(h.spawned.length).toBe(1) // so it starts one
      expect(h.fetched).toEqual([])
    })
  }

  test('Windows: a folder with spaces is quoted in the install command', async ($, on) => {
    const profile = 'C:\\Users\\Ana Maria'
    const missing = engine(on, { installed: false, win: profile })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    const r: any = await $.command.run({ command: 'reels', args: '' } as any)
    expect(r.text).toBe('Reels needs Playwright once: npm install --prefix "C:/Users/Ana Maria/.claude-mods/reels" playwright@1.63.0')
    expect(missing.spawned).toEqual([])
  })

  test('Windows: a frame path with spaces reaches the picture whole', async ($, on) => {
    const h = engine(on, { installed: true, win: 'C:\\Users\\Ana Maria' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    await $.command.run({ command: 'reels', args: '' } as any)
    let ui: any = null
    await until(async () => {
      if (ui) await ui.unmount()
      ui = await $.ui.mount({ plugin: 'reels', surface: 'terminal', ...PANE } as any)
      return h.blits.length > 0
    })
    expect(h.blits.at(-1)).toBe('C:/Users/Ana Maria/.claude-mods/reels/frames/f-1.png')
    await ui.unmount()
  })
})
