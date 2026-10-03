import { describe, expect, test } from 'claude-code/testing'

import { attachment, describeAttachment, parsePs } from '../hooks/attach'
import { browserReport, shotName, slug } from '../hooks/register'

const SHARED = '/Users/me/Library/Caches/ms-playwright-mcp/mcp-chrome-265f254'
// Two Claude processes: 100 (us) and 200 (another). Each has a Playwright server.
const ps = (chromeUnder: number, isolated = false) =>
  [
    '100 1 claude',
    '101 100 npm exec @playwright/mcp@latest',
    `102 101 node /x/.bin/playwright-mcp${isolated ? ' --isolated' : ''}`,
    '200 1 claude',
    '201 200 npm exec @playwright/mcp@latest',
    '202 201 node /x/.bin/playwright-mcp',
    `300 ${chromeUnder} /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --no-first-run --user-data-dir=${SHARED} about:blank`,
    '301 300 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (GPU).app/Contents/MacOS/Google Chrome Helper --type=gpu',
  ].join('\n')

// What `ps` prints: the whole list, or with `-p <pid>` that one process's command.
const psOut = (argv: string[], under: number) => {
  const i = argv.indexOf('-p')
  if (i === -1) return ps(under)
  const line = ps(under).split('\n').find(l => l.startsWith(`${argv[i + 1]} `))
  return line ? `${line.split(' ').slice(2).join(' ')}\n` : ''
}

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }

// Stands for the engine beneath the mod: records what the browser tools were called with.
function engine(on: any, other?: object) {
  const ran: any[] = []
  const toasts: string[] = []
  const store = new Map<string, unknown>(other ? [['driver', other]] : [])
  on('tool.call', (_$: any, e: any) => (ran.push(e), { result: {}, text: 'ok' }))
  on('session.id', () => ({ value: 'this-session-id' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', (_$: any, e: any) => {
    const [cmd] = e.argv as string[]
    const stdout = cmd === 'sh' ? '100\n' : cmd === 'ps' ? ps(102) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { ran, toasts }
}

const PW = 'mcp__plugin_playwright_playwright__browser_'

describe('browser-lanes', () => {
  test('helpers', () => {
    expect(slug('Login flow test!')).toBe('login-flow-test')
    expect(shotName('login-test', 3)).toBe('login-test-03.png')
    expect(shotName('main', 1, 'shots/home.png')).toBe('shots/main-home.png')
    expect(shotName('main', 1, 'main-home.png')).toBe('main-home.png')
  })

  test('screenshots are named by who took them; the band shows the driver', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    await $.tool.call({ tool: `${PW}take_screenshot`, type: 'png', scale: 'css' } as any)
    await $.tool.call({ tool: `${PW}take_screenshot`, filename: 'home.png', scale: 'css' } as any)
    expect(ran[1].filename).toBe('main-01.png')
    expect(ran[2].filename).toBe('main-home.png')

    const ui = await $.ui.mount({ plugin: 'browser-lanes', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /attached · this session's Chrome · shared profile/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /driving: main/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
  })

  test('closing the browser frees the lane', async ($, on) => {
    engine(on)
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    await $.tool.call({ tool: `${PW}close` } as any)
    const ui = await $.ui.mount({ plugin: 'browser-lanes', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /driving:/ })).toBeUndefined()
    await ui.unmount()
  })

  test('another session that just used the browser gets a warning', async ($, on) => {
    const { toasts } = engine(on, { session: 'other-session-xyz', label: 'main', at: Date.now() - 5_000 })
    await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    expect(toasts[0]).toMatch(/^browser-lanes: another Claude session \(other-se, main\) used the browser 5s ago/)
  })

  test('attachment: ours, blocked by another Claude, ready, none', () => {
    const procs = (under: number, iso = false) => parsePs(ps(under, iso))
    expect(attachment(procs(102), 100).state).toBe('attached')
    const blocked = attachment(procs(202), 100, '/Users/me/developer/web', new Map([[200, '/Users/me/developer/web']]))
    expect(blocked.state).toBe('blocked')
    expect(blocked.holder?.claudePid).toBe(200)
    expect(describeAttachment(blocked)).toBe('NOT attached · another Claude (pid 200 in developer/web) holds the shared profile')
    expect(browserReport(blocked)).toMatch(/--isolated/)
    expect(attachment(procs(202), 100, '/Users/me/other', new Map([[200, '/Users/me/developer/web']])).state).toBe('ready') // another folder's profile
    expect(attachment(procs(202, true), 100).state).toBe('ready') // isolated: its own profile, no clash
    expect(attachment(procs(102), 999).state).toBe('none')
  })

  test('/browser explains', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'browser', args: '' } as any)
    expect(r.text).toMatch(/^Browser: attached/)
  })

  test('cleaner: self-heal on "already in use", and closing on session end', async ($, on) => {
    const kills: string[] = []
    let chromeUnder = 202 // another Claude (200, same folder) holds the profile
    let calls = 0
    on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
      const q = e.questions[0]
      return { result: { questions: e.questions, answers: { [q.question]: 'Close it and retry' } }, text: '' }
    })
    on('tool.call', () => {
      calls++
      if (calls === 1) return { result: {}, text: 'Error: Browser is already in use for /x, use --isolated', isError: true }
      chromeUnder = 102 // after the retry, our server launched its own Chrome
      return { result: {}, text: 'ok' }
    })
    on('session.cwd', () => ({ value: '/work' }))
    on('session.id', () => ({ value: 'me' }))
    on('store.get', () => ({ value: undefined }))
    on('store.set', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('session.end', () => ({ sessionId: 'me' }))
    on('process.run', (_$: any, e: any) => {
      const argv = e.argv as string[]
      if (argv[0] === 'kill') kills.push(argv[1] as string)
      const stdout = argv[0] === 'sh' ? '100\n' : argv[0] === 'ps' ? psOut(argv, chromeUnder) : argv[0] === 'lsof' ? 'p200\nfcwd\nn/work\n' : ''
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })

    const r: any = await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com' } as any)
    expect(kills).toEqual(['300']) // asked, closed the blocker, retried
    expect(r.text).toBe('ok')
    await new Promise(done => (globalThis as any).setTimeout(done, 10)) // the background re-check

    await $.session.end({ reason: 'exit' } as any)
    expect(kills).toEqual(['300', '300']) // now ours: closed with the session
  })

  test('/browser clean closes the other sessions browsers', async ($, on) => {
    const kills: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
      const q = e.questions[0]
      return { result: { questions: e.questions, answers: { [q.question]: 'Close all 1 other browsers' } }, text: '' }
    })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }) as any)
    on('session.cwd', () => ({ value: '/work' }))
    on('process.run', (_$: any, e: any) => {
      const argv = e.argv as string[]
      if (argv[0] === 'kill') kills.push(argv[1] as string)
      const stdout = argv[0] === 'sh' ? '100\n' : argv[0] === 'ps' ? psOut(argv, 202) : ''
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'browser', args: 'clean' } as any)
    expect(r.text).toMatch(/^Closed 1 of 1 browser\(s\):\n- Chrome 300 · Claude pid 200/)
    expect(kills).toEqual(['300'])
  })

  test('a pid that is no longer a Playwright Chrome is not killed', async ($, on) => {
    const kills: string[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
      const q = e.questions[0]
      return { result: { questions: e.questions, answers: { [q.question]: 'Close all 1 other browsers' } }, text: '' }
    })
    on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
    on('command.register', () => ({ value: undefined }) as any)
    on('session.cwd', () => ({ value: '/work' }))
    on('process.run', (_$: any, e: any) => {
      const argv = e.argv as string[]
      if (argv[0] === 'kill') kills.push(argv[1] as string)
      // The list still shows Chrome 300, but by the re-check its pid belongs to something else.
      const stdout = argv[0] === 'sh' ? '100\n' : argv[0] === 'ps' ? (argv.includes('-p') ? 'vim notes.md\n' : ps(202)) : ''
      return { value: { exitCode: 0, stdout, stderr: '' } } as any
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'browser', args: 'clean' } as any)
    expect(kills).toEqual([])
    expect(r.text).toMatch(/Closed 0 of 1.*could not close/s)
  })

  test('other tools pass straight through', async ($, on) => {
    const { ran } = engine(on)
    await $.tool.call({ tool: 'Read', file_path: '/a' } as any)
    expect(ran).toHaveLength(1)
  })
})
