import { describe, expect, mock, test } from 'claude-code/testing'

import { classify, sleepArgv, timeoutFrom, winPath } from '../hooks/register'

const PANE = { component: 'Pane', requestId: 'blast-radius', props: { title: 'Blast Radius', isFocused: true, bodyColumns: 100, placement: 'dock' } }

// Stands for the engine beneath the mod: tools run, a 9-file build folder, panes that open, a terminal that draws.
// Its clock is the test's: pass one from mock.clock to move it, or the engine makes its own.
function engine(on: any, ran: string[], { surfaces = ['terminal'], opened = [] as unknown[], clock = undefined as unknown, isPlaced = true, previews = [] as string[][], procs = [] as string[][], cwds = [] as unknown[], env = { HOME: '/home/me' } as Record<string, string> } = {}) {
  if (!clock) mock.clock(on)
  on('env.get', (_$: any, e: any) => ({ value: env[e.name] }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('tool.call', (_$: any, e: any) => {
    ran.push(e.command)
    return { result: {}, text: 'ok' }
  })
  on('process.run', async (_$: any, e: any) => {
    const argv: string[] = e.argv
    procs.push(argv)
    const isPreview = argv[1] === '-c' && /^shopt /.test(argv[2] ?? '') // bash, or Git Bash on Windows
    const isSleep = argv[0] === 'sleep' || (argv[1] === '-c' && /^sleep /.test(argv[2] ?? ''))
    if (isPreview) previews.push(argv.slice(4)) // the targets the preview looks at
    if (isPreview) cwds.push(e.init?.cwd) // and the folder it runs in
    if (isSleep) await new Promise(done => (globalThis as any).setTimeout(done, 5)) // a real wait, so the hold loop yields
    const stdout = isPreview
      ? ['S 1126', ...Array.from({ length: 9 }, (_, i) => `F build/chunk-${i}.js`)].join('\n')
      : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  on('ui.open', (_$: any, e: any) => {
    opened.push(e)
    return { value: { isPlaced } }
  })
  on('ui.close', () => ({ value: undefined }))
}

// Mounts the pane until it shows text matching `text` (the hold loop runs on its own).
async function paneShowing($: any, text: RegExp) {
  for (let i = 0; i < 50; i++) {
    const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', ...PANE })
    if (await ui.find({ type: 'Text', text })) return ui
    await ui.unmount()
    await new Promise(done => (globalThis as any).setTimeout(done, 5))
  }
  throw new Error(`the pane never showed ${text}`)
}

async function heldPane($: any) {
  for (let i = 0; i < 50; i++) {
    const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', ...PANE })
    if (await ui.find({ type: 'Text', text: /held a command/ })) return ui
    await ui.unmount()
  }
  throw new Error('nothing was held')
}

describe('blast-radius', () => {
  test('classifies only the risky commands', () => {
    expect(classify('rm -rf build')?.risk).toBe('delete')
    expect(classify('cd web && rm -r dist')).toEqual({ risk: 'delete', cwd: 'web', targets: ['dist'] })
    expect(classify('git push --force origin main')?.risk).toBe('force-push')
    expect(classify('git push -f')?.risk).toBe('force-push')
    expect(classify('npx prisma migrate deploy')?.risk).toBe('migration')
    expect(classify('rm file.txt')).toBeNull()
    expect(classify('git push origin main')).toBeNull()
    expect(classify('ls -la && echo rm -rf')).toBeNull()
  })

  test('Cancel refuses the command with the reason', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /delete 9 files \(1\.1 MB\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /build\/chunk-0\.js/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    const r: any = await call
    expect(r.deny).toMatch(/^blast-radius: the user pressed Cancel on this command\. It would have: delete 9 files/)
    expect(ran).toEqual([])
    await ui.unmount()
  })

  test('Proceed runs the command as written', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'proceed' })
    await call
    expect(ran).toEqual(['rm -rf build'])
    await ui.unmount()
  })

  test('lists files from the folder being deleted', async ($, on) => {
    on('tool.call', () => ({ result: {}, text: 'ok' }) as any)
    on('process.run', async (_$: any, e: any) => {
      if (e.argv[0] === 'sleep') await new Promise(done => (globalThis as any).setTimeout(done, 5))
      const stdout = e.argv[0] === 'bash' ? 'S 4\nF /tmp/deep/demo/build/chunk-1.js' : ''
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.close', () => ({ value: undefined }) as any)
    on('session.surfaces', () => ({ value: ['terminal'] }) as any)
    mock.clock(on)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/deep/demo/build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /^  build\/chunk-1\.js$/ })).toBeDefined()
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('a path with a shell variable says it cannot preview, never "nothing"', async ($, on) => {
    const ran: string[] = []
    const previews: string[][] = []
    engine(on, ran, { previews })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf $S/build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /can't preview: a path uses a shell variable, check by hand/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$S\/build/ })).toBeDefined()
    expect(previews).toEqual([]) // nothing measured, so no false "nothing"
    await ui.press({ key: 'cancel' })
    const r: any = await call
    expect(r.deny).toMatch(/can't preview/)
    await ui.unmount()
  })

  test('~ and $HOME are expanded before the preview', async ($, on) => {
    const ran: string[] = []
    const previews: string[][] = []
    engine(on, ran, { previews })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf ~/build $HOME/cache' } as any)
    const ui = await heldPane($)
    expect(previews[0]).toEqual(['/home/me/build', '/home/me/cache'])
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test("a quoted '~' is not previewed as the home folder", async ($, on) => {
    const ran: string[] = []
    const previews: string[][] = []
    engine(on, ran, { previews })
    const call = $.tool.call({ tool: 'Bash', command: "rm -rf '~' \"$HOME/x\"" } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /can't preview: 2 paths use a shell variable/ })).toBeDefined()
    expect(previews).toEqual([])
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('a safe command is never held', async ($, on) => {
    const ran: string[] = []
    engine(on, ran)
    await $.tool.call({ tool: 'Bash', command: 'ls -la' } as any)
    expect(ran).toEqual(['ls -la'])
  })

  test('reads timeoutSeconds as whole seconds, 60 when unset or wrong', () => {
    expect(timeoutFrom(undefined)).toBe(60)
    expect(timeoutFrom(30)).toBe(30)
    expect(timeoutFrom('120')).toBe(120)
    expect(timeoutFrom(0)).toBe(0)
    expect(timeoutFrom(0.4)).toBe(1)
    expect(timeoutFrom(-5)).toBe(60)
    expect(timeoutFrom('soon')).toBe(60)
  })

  test('nobody pressing within 60 s cancels with the reason', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const ran: string[] = []
    engine(on, ran, { clock })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await paneShowing($, /auto-cancels in 60 s/)
    await ui.unmount()
    await clock.advance(18_000)
    const later = await paneShowing($, /auto-cancels in 42 s/)
    await later.unmount()
    await clock.advance(42_000)
    const r: any = await call
    expect(r.deny).toMatch(/nobody answered within 60 s, so it was cancelled\. It would have: delete 9 files \(1\.1 MB\)\. Don't retry it on your own: ask the user to run it/)
    expect(ran).toEqual([])
  })

  test('a shorter timeoutSeconds cancels sooner', { options: { timeoutSeconds: 30 } }, async ($, on) => {
    const clock = mock.clock(on)
    const ran: string[] = []
    engine(on, ran, { clock })
    const call = $.tool.call({ tool: 'Bash', command: 'git push --force' } as any)
    const ui = await paneShowing($, /auto-cancels in 30 s/)
    await ui.unmount()
    await clock.advance(30_000)
    const r: any = await call
    expect(r.deny).toMatch(/nobody answered within 30 s/)
    expect(ran).toEqual([])
  })

  for (const key of ['cancel', 'proceed'] as const) {
    test(`pressing ${key} before the timeout still decides`, async ($, on) => {
      const clock = mock.clock(on)
      const ran: string[] = []
      engine(on, ran, { clock })
      const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
      const first = await paneShowing($, /auto-cancels in 60 s/)
      await first.unmount()
      await clock.advance(50_000)
      const ui = await paneShowing($, /auto-cancels in 10 s/)
      await ui.press({ key })
      const r: any = await call
      if (key === 'cancel') {
        expect(r.deny).toMatch(/the user pressed Cancel/)
        expect(ran).toEqual([])
      } else {
        expect(ran).toEqual(['rm -rf build'])
      }
      await ui.unmount()
    })
  }

  test('timeoutSeconds 0 waits for a press, with no countdown', { options: { timeoutSeconds: 0 } }, async ($, on) => {
    const clock = mock.clock(on)
    const ran: string[] = []
    engine(on, ran, { clock })
    let isSettled = false
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any).then((r: any) => {
      isSettled = true
      return r
    })
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /auto-cancels/ })).toBeUndefined()
    await ui.unmount()
    await clock.advance(10 * 60_000)
    await new Promise(done => (globalThis as any).setTimeout(done, 50))
    expect(isSettled).toBe(false)
    const again = await heldPane($)
    await again.press({ key: 'proceed' })
    await call
    expect(ran).toEqual(['rm -rf build'])
    await again.unmount()
  })

  test('a session with no screen cancels at once', async ($, on) => {
    const ran: string[] = []
    const opened: unknown[] = []
    engine(on, ran, { surfaces: [], opened })
    const r: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    expect(r.deny).toMatch(/no screen, so nobody can answer\. It would have: delete 9 files/)
    expect(ran).toEqual([])
    expect(opened).toEqual([])
  })

  test('the countdown shows in the band when the pane cannot open', async ($, on) => {
    const clock = mock.clock(on)
    const ran: string[] = []
    engine(on, ran, { clock, isPlaced: false })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    await clock.advance(52_000)
    let band: any
    for (let i = 0; i < 50 && !band; i++) {
      const ui = await $.ui.mount({ plugin: 'blast-radius', surface: 'terminal', component: 'AbovePrompt', props: { bodyColumns: 100 } } as any)
      if (await ui.find({ type: 'Text', text: /auto-cancels in 8 s/ })) band = ui
      else {
        await ui.unmount()
        await new Promise(done => (globalThis as any).setTimeout(done, 5))
      }
    }
    expect(band).toBeDefined()
    await clock.advance(8_000)
    const r: any = await call
    expect(r.deny).toMatch(/nobody answered within 60 s/)
    expect(ran).toEqual([])
    await band.unmount()
  })

  test('a second held command gets its own full wait', async ($, on) => {
    const clock = mock.clock(on)
    const ran: string[] = []
    engine(on, ran, { clock })
    const first = $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'one' } as any)
    const second = $.tool.call({ tool: 'Bash', command: 'git push --force', tool_use_id: 'two' } as any)
    const ui = await paneShowing($, /rm -rf build/)
    await ui.unmount()
    await clock.advance(60_000)
    expect(((await first) as any).deny).toMatch(/nobody answered within 60 s/)
    const next = await paneShowing($, /auto-cancels in 60 s/)
    expect(await next.find({ type: 'Text', text: /git push --force/ })).toBeDefined()
    await next.press({ key: 'proceed' })
    await second
    expect(ran).toEqual(['git push --force'])
    await next.unmount()
  })

  test('sleepArgv and winPath', () => {
    const git = 'C:\\Program Files\\Git\\bin\\bash.exe'
    expect(sleepArgv({ isWindows: false, bash: 'bash' }, '0.25')).toEqual(['sleep', '0.25'])
    expect(sleepArgv({ isWindows: true, bash: git }, '0.25')).toEqual([git, '-c', 'sleep 0.25'])
    expect(winPath('/c/proj')).toBe('c:/proj')
    expect(winPath('/c')).toBe('c:/')
    expect(winPath('/home/me')).toBe('/home/me')
    expect(winPath('web/c/x')).toBe('web/c/x')
  })

  test('Windows: the preview and the wait run in Git Bash, and ~ is the profile folder', async ($, on) => {
    const git = 'C:\\Program Files\\Git\\bin\\bash.exe'
    const ran: string[] = []
    const procs: string[][] = []
    const previews: string[][] = []
    engine(on, ran, { procs, previews, env: { OS: 'Windows_NT', SHELL: git, USERPROFILE: 'C:\\Users\\me' } })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf ~/build' } as any)
    const ui = await heldPane($)
    expect(previews[0]).toEqual(['C:/Users/me/build'])
    await ui.press({ key: 'cancel' })
    await call
    expect(procs.length).toBeGreaterThan(1)
    expect(procs.every(argv => argv[0] === git)).toBe(true) // never `sleep` or `bash` looked up on PATH
    expect(procs.some(argv => argv[2] === 'sleep 0.25')).toBe(true)
    await ui.unmount()
  })

  test('Windows: a cd to a Git Bash path previews in the matching Windows folder', async ($, on) => {
    const ran: string[] = []
    const cwds: unknown[] = []
    engine(on, ran, { cwds, env: { OS: 'Windows_NT', SHELL: 'C:\\Program Files\\Git\\bin\\bash.exe' } })
    const call = $.tool.call({ tool: 'Bash', command: 'cd /c/proj && rm -rf dist' } as any)
    const ui = await heldPane($)
    expect(cwds[0]).toBe('c:/proj')
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('Windows without Git Bash in SHELL falls back to bash on PATH', async ($, on) => {
    const ran: string[] = []
    const procs: string[][] = []
    engine(on, ran, { procs, env: { OS: 'Windows_NT', SHELL: 'C:\\Windows\\System32\\cmd.exe' } })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'cancel' })
    await call
    expect(procs.every(argv => argv[0] === 'bash')).toBe(true)
    await ui.unmount()
  })

  test('a wait that cannot start refuses the command instead of letting it through', async ($, on) => {
    const ran: string[] = []
    on('tool.call', (_$: any, e: any) => (ran.push(e.command), { result: {}, text: 'ok' }) as any)
    on('process.run', (_$: any, e: any) => (e.argv[0] === 'sleep' ? { deny: 'ENOENT: sleep not found' } : { value: { exitCode: 0, stdout: '', stderr: '' } }) as any)
    on('env.get', () => ({ value: undefined }) as any)
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.close', () => ({ value: undefined }) as any)
    on('ui.log', () => ({ value: undefined }) as any)
    on('session.surfaces', () => ({ value: ['terminal'] }) as any)
    mock.clock(on)
    const r: any = await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    expect(r.deny).toMatch(/^blast-radius: could not hold this command for an answer \(.*sleep not found.*\), so it was not run/)
    expect(ran).toEqual([])
  })

  test('Windows without SHELL falls back to bash on PATH too', async ($, on) => {
    const ran: string[] = []
    const procs: string[][] = []
    engine(on, ran, { procs, env: { OS: 'Windows_NT' } })
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    await ui.press({ key: 'cancel' })
    await call
    expect(procs.every(argv => argv[0] === 'bash')).toBe(true)
    await ui.unmount()
  })

  for (const [where, env] of [['off Windows with no HOME', {}], ['on Windows with no profile folder', { OS: 'Windows_NT' }]] as const) {
    test(`${where}, ~ is passed on as written`, async ($, on) => {
      const ran: string[] = []
      const previews: string[][] = []
      engine(on, ran, { previews, env })
      const call = $.tool.call({ tool: 'Bash', command: 'rm -rf ~/build' } as any)
      const ui = await heldPane($)
      expect(previews[0]).toEqual(['~/build'])
      await ui.press({ key: 'cancel' })
      await call
      await ui.unmount()
    })
  }

  test('on macOS and Linux a cd target is the preview folder as written', async ($, on) => {
    const ran: string[] = []
    const cwds: unknown[] = []
    engine(on, ran, { cwds })
    const call = $.tool.call({ tool: 'Bash', command: 'cd /c/proj && rm -rf dist' } as any)
    const ui = await heldPane($)
    expect(cwds[0]).toBe('/c/proj') // no Windows drive rewrite off Windows
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })

  test('a second command whose wait for its turn cannot start is refused too', async ($, on) => {
    const ran: string[] = []
    let isBroken = false
    on('tool.call', (_$: any, e: any) => (ran.push(e.command), { result: {}, text: 'ok' }) as any)
    on('process.run', async (_$: any, e: any) => {
      if (e.argv[0] !== 'sleep') return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
      if (isBroken) return { deny: 'ENOENT: sleep not found' } as any
      await new Promise(done => (globalThis as any).setTimeout(done, 5))
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
    })
    on('env.get', () => ({ value: undefined }) as any)
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.close', () => ({ value: undefined }) as any)
    on('ui.log', () => ({ value: undefined }) as any)
    on('session.surfaces', () => ({ value: ['terminal'] }) as any)
    mock.clock(on)
    const first = $.tool.call({ tool: 'Bash', command: 'rm -rf build', tool_use_id: 'one' } as any)
    const ui = await heldPane($)
    await ui.unmount()
    isBroken = true // from here on the wait cannot start, for the held one and for the one in line
    const second: any = await $.tool.call({ tool: 'Bash', command: 'git push --force', tool_use_id: 'two' } as any)
    expect(second.deny).toMatch(/could not hold this command for an answer/)
    expect(((await first) as any).deny).toMatch(/could not hold this command for an answer/)
    expect(ran).toEqual([])
  })

  test('a preview that fails is reported as not measured, never as nothing', async ($, on) => {
    on('tool.call', () => ({ result: {}, text: 'ok' }) as any)
    on('process.run', async (_$: any, e: any) => {
      if (e.argv[0] === 'sleep') await new Promise(done => (globalThis as any).setTimeout(done, 5))
      const isPreview = e.argv[0] === 'bash'
      return { value: { exitCode: isPreview ? 1 : 0, stdout: '', stderr: isPreview ? 'WSL has no distribution' : '' } } as any // a launcher that never ran the script
    })
    on('env.get', () => ({ value: undefined }) as any)
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.close', () => ({ value: undefined }) as any)
    on('session.surfaces', () => ({ value: ['terminal'] }) as any)
    mock.clock(on)
    const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any)
    const ui = await heldPane($)
    expect(await ui.find({ type: 'Text', text: /run a risky delete command \(could not measure it\)/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /delete nothing/ })).toBeUndefined()
    await ui.press({ key: 'cancel' })
    await call
    await ui.unmount()
  })
})
