// Cache Clock: a prompt-cache line under the status line, drawn from the
// status line input's `prompt_cache`. Plugins cannot register a status line,
// so /cache-clock setup points statusLine at a script that runs the person's
// own status line first and adds the cache line under it.
import type { EngineInterface, Register } from 'claude-code'

// The scripts setup copies out of the plugin. They live in the config dir, not
// in the plugin's folder, which changes with every version of the mod.
const SCRIPTS = ['cache-clock.mjs', 'render.mjs']
// What marks a statusLine command as this mod's.
const MARK = 'cache-clock/cache-clock.mjs'
const REFRESH_SECONDS = 30
// The first Claude Code that sends `prompt_cache` to the status line.
const MIN_VERSION = [2, 1, 251]

type StatusLine = { type?: string; command?: string; refreshInterval?: number; [key: string]: unknown }
// What setup leaves for remove and for the script: the settings file it wrote,
// the statusLine that file had before, and the command the script runs first.
type Saved = { file: string; previous: StatusLine | null; wrapped: string | null }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'cache-clock',
      description: 'Add a prompt-cache line under the status line; /cache-clock remove takes it out',
      argumentHint: '[setup|remove]',
    }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    void refreshScripts($).catch(() => {})
    return r
  })

  on('command.run', { command: 'cache-clock' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    try {
      if (word === 'setup') return { text: await setup($) }
      if (word === 'remove') return { text: await remove($) }
      if (word === '') return { text: await status($) }
      return { text: 'Usage: /cache-clock [setup|remove]' }
    } catch (err) {
      return { text: `cache-clock: ${err instanceof Error ? err.message : String(err)}` }
    }
  })
}

async function setup($: EngineInterface) {
  const dir = await clockDir($)
  const found = await inForce($)
  if (found.source === 'policy' || found.source === 'flag') {
    const where = found.source === 'policy' ? 'managed settings' : '--settings'
    return `Your status line comes from ${where}, which cache-clock can't change. Nothing changed.`
  }
  if (isOurs(found.statusLine)) {
    await copyScripts($, dir)
    return 'cache-clock is already set up. Its scripts are up to date.'
  }

  const file = await targetFile($, found.source)
  const settings = await readJson($, file)
  const current = found.statusLine
  const wrapped = typeof current?.command === 'string' && current.command.trim() ? current.command : null
  const saved: Saved = { file, previous: asStatusLine(settings.statusLine), wrapped }

  await copyScripts($, dir)
  await $.fs.write(`${dir}/setup.json`, JSON.stringify(saved, null, 2) + '\n')

  const { command: _command, refreshInterval, ...kept } = current ?? {}
  settings.statusLine = {
    ...kept,
    type: 'command',
    command: `node "${dir}/cache-clock.mjs"`,
    refreshInterval: typeof refreshInterval === 'number' && refreshInterval < REFRESH_SECONDS ? refreshInterval : REFRESH_SECONDS,
  }
  await $.fs.write(file, JSON.stringify(settings, null, 2) + '\n')

  const lines = [
    wrapped
      ? `cache-clock set up in ${file}. Your status line stays as it is, with the cache line under it.`
      : `cache-clock set up in ${file}. The cache line is your status line.`,
    'It shows up after Claude\'s next reply. /cache-clock remove puts things back.',
    ...(await warnings($)),
  ]
  return lines.join('\n')
}

async function remove($: EngineInterface) {
  const dir = await clockDir($)
  const saved = await readSaved($, dir)
  if (!saved) return 'cache-clock is not set up. Nothing changed.'

  const settings = await readJson($, saved.file)
  if (!isOurs(asStatusLine(settings.statusLine))) {
    await $.fs.write(`${dir}/setup.json`, '{}\n')
    return `The status line in ${saved.file} was changed since setup, so it was left as it is.`
  }
  if (saved.previous) settings.statusLine = saved.previous
  else delete settings.statusLine
  await $.fs.write(saved.file, JSON.stringify(settings, null, 2) + '\n')
  await $.fs.write(`${dir}/setup.json`, '{}\n')
  return saved.previous
    ? `cache-clock removed. Your status line in ${saved.file} is back as it was.`
    : `cache-clock removed from ${saved.file}.`
}

async function status($: EngineInterface) {
  const found = await inForce($)
  if (isOurs(found.statusLine)) {
    return ['cache-clock is on. /cache-clock remove takes it out.', ...(await warnings($))].join('\n')
  }
  return 'cache-clock is off. /cache-clock setup adds the cache line under your status line.'
}

// After an update of the mod, the copies setup made catch up with the new scripts.
async function refreshScripts($: EngineInterface) {
  if (!isOurs((await inForce($)).statusLine)) return
  const dir = await clockDir($)
  for (const name of SCRIPTS) {
    const fresh = await $.fs.read(`${$.plugin.root}/statusline/${name}`)
    const copy = await $.fs.read(`${dir}/${name}`).catch(() => null)
    if (copy !== fresh) await $.fs.write(`${dir}/${name}`, fresh)
  }
}

async function copyScripts($: EngineInterface, dir: string) {
  for (const name of SCRIPTS) {
    await $.fs.write(`${dir}/${name}`, await $.fs.read(`${$.plugin.root}/statusline/${name}`))
  }
}

async function warnings($: EngineInterface) {
  const out: string[] = []
  const node = await $.process.run(['node', '--version'], { timeoutMs: 5000 }).catch(() => null)
  if (!node || node.exitCode !== 0) out.push('Warning: node is not on your PATH. The cache line needs Node to run.')
  const { base, version } = await $.session.version()
  if (isOlder(base ?? version, MIN_VERSION)) {
    out.push(`Warning: Claude Code ${version} is older than 2.1.251, so it sends no cache data. The line stays empty until you update.`)
  }
  return out
}

// The statusLine in force and the settings source it comes from, highest precedence first.
async function inForce($: EngineInterface) {
  for (const source of ['policy', 'flag', 'local', 'project', 'user'] as const) {
    const settings = await $.settings.read({ source }).catch(() => ({}))
    const statusLine = asStatusLine((settings as Record<string, unknown>).statusLine)
    if (statusLine) return { source, statusLine }
  }
  return { source: null, statusLine: null }
}

// The file setup writes: where the status line lives, except that a project's
// shared settings get a local override instead of a path from this machine.
async function targetFile($: EngineInterface, source: string | null) {
  const cwd = await $.session.cwd()
  if (source === 'local' || source === 'project') return `${cwd}/.claude/settings.local.json`
  return `${await configDir($)}/settings.json`
}

async function configDir($: EngineInterface) {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  if (custom) return custom.replace(/\/+$/, '')
  return `${await $.env.get('HOME')}/.claude`
}

async function clockDir($: EngineInterface) {
  return `${await configDir($)}/cache-clock`
}

async function readJson($: EngineInterface, file: string): Promise<Record<string, unknown>> {
  if (!(await $.fs.exists(file))) return {}
  const text = await $.fs.read(file)
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error(`${file} is not valid JSON, so it was left as it is.`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(`${file} does not hold a settings object.`)
  return parsed as Record<string, unknown>
}

async function readSaved($: EngineInterface, dir: string): Promise<Saved | null> {
  const text = await $.fs.read(`${dir}/setup.json`).catch(() => null)
  if (!text) return null
  try {
    const saved = JSON.parse(text)
    return typeof saved?.file === 'string' ? (saved as Saved) : null
  } catch {
    return null
  }
}

function asStatusLine(value: unknown): StatusLine | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as StatusLine) : null
}

function isOurs(statusLine: StatusLine | null) {
  return typeof statusLine?.command === 'string' && statusLine.command.includes(MARK)
}

function isOlder(version: string, min: number[]) {
  const parts = version.split(/[.-]/).slice(0, 3).map(Number)
  if (parts.some(Number.isNaN)) return false
  for (let i = 0; i < min.length; i++) {
    if (parts[i] !== min[i]) return parts[i] < min[i]
  }
  return false
}
