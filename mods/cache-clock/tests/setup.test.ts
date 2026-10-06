import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

const CONFIG = '/home/me/.claude'
const USER_FILE = `${CONFIG}/settings.json`
const LOCAL_FILE = '/work/.claude/settings.local.json'
const SCRIPT = `${CONFIG}/cache-clock/cache-clock.mjs`

type World = {
  files: Map<string, string>
  sources: Record<string, Record<string, unknown>>
  version?: string
  hasNode?: boolean
}

// Stands for the host: files in memory, settings per source read from those files,
// and the plugin's own scripts.
async function start($: Engine, on: On, world: World) {
  const { files } = world
  mock.env(on, { HOME: '/home/me' })
  on('session.start', (_$, e: any) => ({ cwd: e.cwd }) as any)
  on('command.register', () => ({ value: undefined }) as any)
  on('session.cwd', () => ({ value: '/work' }) as any)
  on('session.version', () => ({ value: { version: world.version ?? '2.1.291', base: world.version ?? '2.1.291' } }) as any)
  on('process.run', () => {
    if (world.hasNode === false) throw new Error('not found')
    return { value: { exitCode: 0, stdout: 'v22.0.0\n', stderr: '' } } as any
  })
  on('settings.read', (_$, e: any) => {
    const file = e.source === 'user' ? USER_FILE : e.source === 'local' ? LOCAL_FILE : null
    if (file && files.has(file)) return { value: JSON.parse(files.get(file)!) } as any
    return { value: world.sources[e.source] ?? {} } as any
  })
  on('fs.exists', (_$, e: any) => ({ value: files.has(e.path) }) as any)
  on('fs.read', (_$, e: any) => {
    const name = e.path.match(/\/statusline\/([\w-]+\.mjs)$/)?.[1]
    if (name) return { value: `// shipped ${name}` } as any
    if (!files.has(e.path)) throw new Error(`ENOENT ${e.path}`)
    return { value: files.get(e.path) } as any
  })
  on('fs.write', (_$, e: any) => (files.set(e.path, e.text), { value: undefined }) as any)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
}

const run = async ($: Engine, args: string) => (await $.command.run({ command: 'cache-clock', args } as any)).text ?? ''
const json = (world: World, file: string) => JSON.parse(world.files.get(file)!)

describe('cache-clock setup', () => {
  test('wraps an existing status line and keeps its other keys', async ($, on) => {
    const world: World = {
      files: new Map([[USER_FILE, JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: 'my-line.sh', padding: 0 } })]]),
      sources: {},
    }
    await start($, on, world)

    expect(await run($, 'setup')).toMatch(/stays as it is/)
    const settings = json(world, USER_FILE)
    expect(settings.model).toBe('opus')
    expect(settings.statusLine).toEqual({ type: 'command', command: `node "${SCRIPT}"`, padding: 0, refreshInterval: 30 })
    expect(json(world, `${CONFIG}/cache-clock/setup.json`)).toEqual({
      file: USER_FILE,
      previous: { type: 'command', command: 'my-line.sh', padding: 0 },
      wrapped: 'my-line.sh',
    })
    expect(world.files.get(SCRIPT)).toBe('// shipped cache-clock.mjs')
    expect(world.files.get(`${CONFIG}/cache-clock/render.mjs`)).toBe('// shipped render.mjs')
  })

  test('remove puts the original status line back exactly', async ($, on) => {
    const original = { model: 'opus', statusLine: { type: 'command', command: 'my-line.sh', padding: 0 } }
    const world: World = { files: new Map([[USER_FILE, JSON.stringify(original)]]), sources: {} }
    await start($, on, world)

    await run($, 'setup')
    expect(await run($, 'remove')).toMatch(/back as it was/)
    expect(json(world, USER_FILE)).toEqual(original)
    expect(await run($, 'remove')).toMatch(/not set up/)
  })

  test('with no status line, the cache line becomes it, and remove takes it out', async ($, on) => {
    const world: World = { files: new Map([[USER_FILE, '{"theme":"dark"}']]), sources: {} }
    await start($, on, world)

    expect(await run($, 'setup')).toMatch(/The cache line is your status line/)
    expect(json(world, `${CONFIG}/cache-clock/setup.json`).wrapped).toBeNull()
    await run($, 'remove')
    expect(json(world, USER_FILE)).toEqual({ theme: 'dark' })
  })

  test('creates the user settings file when there is none', async ($, on) => {
    const world: World = { files: new Map(), sources: {} }
    await start($, on, world)
    await run($, 'setup')
    expect(json(world, USER_FILE).statusLine.command).toBe(`node "${SCRIPT}"`)
  })

  test('keeps a shorter refresh interval', async ($, on) => {
    const world: World = {
      files: new Map([[USER_FILE, JSON.stringify({ statusLine: { type: 'command', command: 'x', refreshInterval: 5 } })]]),
      sources: {},
    }
    await start($, on, world)
    await run($, 'setup')
    expect(json(world, USER_FILE).statusLine.refreshInterval).toBe(5)
  })

  test("a project's shared status line gets a local override, not an edit", async ($, on) => {
    const world: World = { files: new Map(), sources: { project: { statusLine: { type: 'command', command: 'team-line.sh' } } } }
    await start($, on, world)

    await run($, 'setup')
    expect(json(world, LOCAL_FILE).statusLine.command).toBe(`node "${SCRIPT}"`)
    expect(json(world, `${CONFIG}/cache-clock/setup.json`).wrapped).toBe('team-line.sh')
    await run($, 'remove')
    expect(json(world, LOCAL_FILE)).toEqual({})
  })

  test('leaves a managed status line alone', async ($, on) => {
    const world: World = { files: new Map(), sources: { policy: { statusLine: { type: 'command', command: 'corp.sh' } } } }
    await start($, on, world)
    expect(await run($, 'setup')).toMatch(/managed settings/)
    expect(world.files.size).toBe(0)
  })

  test('running setup twice keeps the original saved', async ($, on) => {
    const world: World = { files: new Map([[USER_FILE, JSON.stringify({ statusLine: { command: 'my-line.sh' } })]]), sources: {} }
    await start($, on, world)
    await run($, 'setup')
    expect(await run($, 'setup')).toMatch(/already set up/)
    expect(json(world, `${CONFIG}/cache-clock/setup.json`).wrapped).toBe('my-line.sh')
  })

  test('remove leaves a status line changed since setup', async ($, on) => {
    const world: World = { files: new Map([[USER_FILE, '{}']]), sources: {} }
    await start($, on, world)
    await run($, 'setup')
    world.files.set(USER_FILE, JSON.stringify({ statusLine: { command: 'other.sh' } }))
    expect(await run($, 'remove')).toMatch(/changed since setup/)
    expect(json(world, USER_FILE).statusLine.command).toBe('other.sh')
  })

  test('invalid settings JSON is left as it is', async ($, on) => {
    const world: World = { files: new Map([[USER_FILE, '{ nope']]), sources: {} }
    await start($, on, world)
    expect(await run($, 'setup')).toMatch(/not valid JSON/)
    expect(world.files.get(USER_FILE)).toBe('{ nope')
  })

  test('warns about an old Claude Code and a missing node', async ($, on) => {
    const world: World = { files: new Map(), sources: {}, version: '2.1.200', hasNode: false }
    await start($, on, world)
    const text = await run($, 'setup')
    expect(text).toMatch(/older than 2\.1\.251/)
    expect(text).toMatch(/node is not on your PATH/)
  })

  test('status says whether it is on', async ($, on) => {
    const world: World = { files: new Map(), sources: {} }
    await start($, on, world)
    expect(await run($, '')).toMatch(/off/)
    await run($, 'setup')
    expect(await run($, '')).toMatch(/is on/)
  })
})
