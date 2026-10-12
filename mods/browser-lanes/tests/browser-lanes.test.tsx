import { describe, expect, test } from 'claude-code/testing'

import { attachment, browsers, describeAttachment, parsePs } from '../hooks/attach'
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
// The same on Windows, as the PowerShell list prints it: \r\n lines, quoted paths, node.EXE, and chrome.exe's helpers
// carrying --type=. 9000 is the PowerShell itself, whose parent (100) is our Claude.
const WIN_SHARED = 'C:\\Users\\me\\AppData\\Local\\ms-playwright-mcp\\mcp-chrome-265f254'
const CLAUDE_EXE = '"C:\\Users\\me\\.local\\bin\\claude.exe"'
const CHROME_EXE = '"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"'
const NODE_EXE = '"C:\\Program Files\\nodejs\\node.EXE"'
const winPs = (chromeUnder: number, isolated = false) =>
  [
    `100 1 ${CLAUDE_EXE}`,
    '101 100 "C:\\Windows\\system32\\cmd.exe" /c npx @playwright/mcp@latest',
    `102 101 ${NODE_EXE} "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npx-cli.js" @playwright/mcp@latest`,
    `103 102 ${NODE_EXE} C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\1\\node_modules\\@playwright\\mcp\\cli.js --browser chrome${isolated ? ' --isolated' : ''}`,
    `200 1 ${CLAUDE_EXE} --resume 12345678-aaaa`,
    '201 200 "C:\\Windows\\system32\\cmd.exe" /c npx @playwright/mcp@latest',
    `203 201 ${NODE_EXE} C:\\Users\\me\\AppData\\Local\\npm-cache\\_npx\\2\\node_modules\\@playwright\\mcp\\cli.js --browser chrome`,
    `300 ${chromeUnder} ${CHROME_EXE} --no-first-run --user-data-dir=${WIN_SHARED} about:blank`,
    `301 300 ${CHROME_EXE} --type=renderer --user-data-dir=${WIN_SHARED} --lang=en-US`,
    `9000 100 powershell.exe -NoProfile -NonInteractive -Command ...`,
  ].join('\r\n') + '\r\n'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }

// Stands for the engine beneath the mod: records what the browser tools were called with.
function engine(on: any, other?: object, sleeps: string[][] = []) {
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
  on('process.run', async (_$: any, e: any) => {
    const [cmd] = e.argv as string[]
    if (cmd === 'sleep') {
      sleeps.push(e.argv)
      await new Promise(done => (globalThis as any).setTimeout(done, 5)) // a real wait, so a loop that sleeps yields
    }
    const stdout = cmd === 'sh' ? '100\n' : cmd === 'ps' ? ps(102) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { ran, toasts }
}

// The engine on Windows: PowerShell prints the process list (first line its own pid) and one command line, taskkill ends
// a process, and Claude Code's sessions/<pid>.json says where another Claude works. There is no sh, ps, lsof or kill.
function winEngine(on: any, { chromeUnder = 103, holderCwd = '', sessionFile = undefined as string | undefined, configDir = '', command = '', sleeps = [] as string[][], answer = 'Close all 1 other browsers', reads = [] as string[], noSelf = false } = {}) {
  const argvs: string[][] = []
  const taskkills: string[][] = []
  on('tool.call', (_$: any, e: any) =>
    e.tool === 'AskUserQuestion' ? { result: { questions: e.questions, answers: { [e.questions[0].question]: answer }, text: '' } } : { result: {}, text: 'ok' })
  on('session.id', () => ({ value: 'this-session-id' }))
  on('session.cwd', () => ({ value: 'C:\\work' }))
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('env.get', (_$: any, e: any) => ({ value: ({ OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\me', ...(configDir ? { CLAUDE_CONFIG_DIR: configDir } : {}) } as Record<string, string>)[e.name] }))
  on('fs.read', (_$: any, e: any) => {
    reads.push(String(e.path).replace(/\\/g, '/'))
    const text = sessionFile ?? (holderCwd ? JSON.stringify({ pid: 200, cwd: holderCwd }) : undefined)
    return /sessions[\\/]200\.json$/.test(e.path) && text !== undefined ? { value: text } : { deny: 'ENOENT' }
  })
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('command.register', () => ({ value: undefined }))
  on('process.run', async (_$: any, e: any) => {
    const argv = e.argv as string[]
    argvs.push(argv)
    const script = argv.at(-1) ?? ''
    if (argv[0] === 'taskkill') taskkills.push(argv)
    if (/Start-Sleep/.test(script)) {
      sleeps.push(argv)
      await new Promise(done => (globalThis as any).setTimeout(done, 5))
    }
    const one = /ProcessId = (\d+)/.exec(script)
    const stdout = one ? command : /Win32_Process/.test(script) ? `${noSelf ? '9999' : '9000'}\n${winPs(chromeUnder)}` : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { argvs, taskkills }
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

  test('Windows lists: CRLF lines, quoted paths, node.EXE, and the helpers left out', () => {
    const list = parsePs(winPs(103))
    expect(list.length).toBe(10)
    expect(list.find(p => p.pid === 9000)?.ppid).toBe(100) // how the mod finds its own Claude
    const ours = attachment(list, 100)
    expect(ours).toMatchObject({ state: 'attached', serverPid: 103, chromePid: 300, profile: WIN_SHARED }) // not the --type=renderer helper (301), not npx's own @playwright/mcp@latest (102)
    expect(browsers(list, 100).map(b => [b.chromePid, b.serverPid, b.claudePid, b.isMine])).toEqual([[300, 103, 100, true]])
    expect(attachment(parsePs(winPs(103, true)), 100).isolated).toBe(true)
    expect(attachment(list, 999).state).toBe('none')
    // A path with spaces is quoted: the whole argument, or only the value.
    const spaced = 'C:\\Users\\Me Smith\\AppData\\Local\\ms-playwright-mcp\\mcp-chrome-1'
    for (const arg of [`"--user-data-dir=${spaced}"`, `--user-data-dir="${spaced}"`]) {
      const rows = parsePs(`100 1 ${CLAUDE_EXE}\r\n103 100 ${NODE_EXE} C:\\x\\@playwright\\mcp\\cli.js\r\n300 103 ${CHROME_EXE} ${arg} about:blank\r\n`)
      expect(attachment(rows, 100).profile).toBe(spaced)
    }
  })

  test('Windows: another Claude holding the profile is found through its sessions file', async ($, on) => {
    const { argvs } = winEngine(on, { chromeUnder: 203, holderCwd: 'C:\\work' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    const r: any = await $.command.run({ command: 'browser', args: '' } as any)
    expect(r.text).toMatch(/^Browser: NOT attached · another Claude \(pid 200 in C:\/work\) holds the shared profile/)
    expect(r.text).toMatch(/Chrome pid 300 under Claude pid 200 \(C:\\work\)/)
    expect(argvs.every(a => a[0] === 'powershell')).toBe(true) // no sh, ps, lsof
  })

  test("Windows: another Claude's other folder, or no sessions file, is no clash", async ($, on) => {
    winEngine(on, { chromeUnder: 203, holderCwd: 'C:\\other' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    expect(((await $.command.run({ command: 'browser', args: '' } as any)) as any).text).toMatch(/^Browser: ready/)
  })

  test('Windows: /browser clean closes the other sessions browsers with taskkill', async ($, on) => {
    const { taskkills } = winEngine(on, { chromeUnder: 203, command: `${CHROME_EXE} --user-data-dir=${WIN_SHARED} about:blank` })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    const r: any = await $.command.run({ command: 'browser', args: 'clean' } as any)
    expect(taskkills).toEqual([['taskkill', '/PID', '300', '/T', '/F']])
    expect(r.text).toMatch(/^Closed 1 of 1 browser\(s\):\n- Chrome 300 · Claude pid 200/)
  })

  test('Windows: a pid that is no longer a Playwright Chrome is not killed', async ($, on) => {
    const { taskkills } = winEngine(on, { chromeUnder: 203, command: 'C:\\Windows\\system32\\notepad.exe notes.txt' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    const r: any = await $.command.run({ command: 'browser', args: 'clean' } as any)
    expect(taskkills).toEqual([])
    expect(r.text).toMatch(/could not close/)
  })

  for (const [where, win] of [['macOS and Linux', false], ['Windows', true]] as const) {
    test(`a second driver waits for the lane with ${win ? 'PowerShell' : 'sleep'} on ${where}`, async ($, on) => {
      const sleeps: string[][] = []
      if (win) winEngine(on, { sleeps })
      else engine(on, undefined, sleeps)
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: win ? 'C:\\work' : '/work' } as any)
      await $.tool.call({ tool: `${PW}navigate`, url: 'https://example.com', agentId: 'first' } as any) // takes the lane
      const second = $.tool.call({ tool: `${PW}navigate`, url: 'https://example.org', agentId: 'second' } as any)
      for (let i = 0; i < 200 && sleeps.length === 0; i++) await new Promise(done => (globalThis as any).setTimeout(done, 5))
      void second.catch(() => {}) // still waiting for the lane when the test ends
      expect(sleeps[0]?.at(-1)).toBe(win ? 'Start-Sleep -Milliseconds 500' : '0.5')
      expect(sleeps[0]?.[0]).toBe(win ? 'powershell' : 'sleep')
    })
  }

  for (const [what, sessionFile] of [['missing', undefined], ['not JSON', 'not json'], ['without a folder', '{}'], ['holding a folder that is not text', '{"cwd":5}']] as const) {
    test(`Windows: a sessions file that is ${what} is no clash`, async ($, on) => {
      const reads: string[] = []
      winEngine(on, { chromeUnder: 203, sessionFile, reads })
      await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
      expect(((await $.command.run({ command: 'browser', args: '' } as any)) as any).text).toMatch(/^Browser: ready/)
      expect([...new Set(reads)]).toEqual(['C:/Users/me/.claude/sessions/200.json']) // read at session start, and again by /browser
    })
  }

  test('Windows: CLAUDE_CONFIG_DIR says where the sessions files are', async ($, on) => {
    const reads: string[] = []
    winEngine(on, { chromeUnder: 203, holderCwd: 'C:\\work', configDir: 'D:\\cfg', reads })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    expect(((await $.command.run({ command: 'browser', args: '' } as any)) as any).text).toMatch(/^Browser: NOT attached/)
    expect([...new Set(reads)]).toEqual(['D:/cfg/sessions/200.json'])
  })

  test('Windows: with its own pid missing from the list, it does not guess whose browser is whose', async ($, on) => {
    winEngine(on, { noSelf: true })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: 'C:\\work' } as any)
    expect(((await $.command.run({ command: 'browser', args: '' } as any)) as any).text).toMatch(/^Browser: no Playwright server in this session/)
  })
})
