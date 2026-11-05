// secret-guard: keeps API keys, tokens and private keys out of Claude's context, your files
// and your git history.
//   1. Tool output: a secret in what a tool returns (cat .env, env, a Read, an MCP answer) is
//      replaced by a label before Claude reads it, so it never reaches the model or the transcript.
//   2. Writes: a Write or Edit that adds a secret asks first. A git-ignored file (.env) goes
//      through with a toast. A write that would put the label back over a real secret is refused.
//   3. Git: `git commit` and `git push` scan what they add (changes since HEAD, unpushed commits) and ask.
// Finds secrets with built-in rules, plus gitleaks when it is installed. Nothing is sent
// anywhere: gitleaks runs locally and never verifies a key over the network. Asks and toasts
// name the kind of secret, never its value.
import type { EngineInterface, Register } from 'claude-code'

import { addedLines, builtin, describe, type Finding, mapStrings, MARKER, redact, unique } from './rules'

// `git`, then any global options (`-c k=v`, `-C dir`, `--no-pager`), then the subcommand.
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`
const GIT_COMMIT = new RegExp(`${GIT}commit\\b`)
const GIT_ADD = new RegExp(`${GIT}add\\b`)
const GIT_PUSH = new RegExp(`${GIT}push\\b`)
const GIT_SAFE = ['git', '-c', 'core.fsmonitor=false', '--no-pager'] as const
// Tools whose results are the person's own words or Claude's: nothing to hide from Claude.
const SKIP = new Set(['AskUserQuestion', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode'])
const GITLEAKS_MAX = 2_000_000

type Stats = { hidden: Map<string, number>; held: number; blocked: number }
const stats: Stats = { hidden: new Map(), held: 0, blocked: 0 }
// undefined: not looked for yet; null: not installed.
let gitleaks: string | null | undefined

export const register: Register = (on, options) => {
  const redactOutput = options.redactOutput !== false
  const useGitleaks = options.useGitleaks !== false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command
      .register({ name: 'secret-guard', description: 'Show what secret-guard hid or held this session, and which scanner it uses' })
      .catch(() => {}) // a name Claude Code already has is refused: start anyway
    return r
  })

  on('command.run', { command: 'secret-guard' }, async $ => ({ text: await report($, useGitleaks) }))

  // 2. Writes.
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const denied = await checkWrite($, e.file_path, e.content, useGitleaks)
    return denied ? { deny: denied } : next(e)
  })
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const denied = await checkWrite($, e.file_path, e.new_string, useGitleaks)
    return denied ? { deny: denied } : next(e)
  })
  on('tool.call', { tool: 'NotebookEdit' }, async ($, e, next) => {
    const denied = await checkWrite($, e.notebook_path, e.new_source ?? '', useGitleaks)
    return denied ? { deny: denied } : next(e)
  })

  // 3. Git, before it runs.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const shell = bare(e.command)
    const commit = GIT_COMMIT.test(shell)
    const push = GIT_PUSH.test(shell)
    if (!commit && !push) return next(e)
    const cwd = await runDir($, e.command)
    for (const step of [commit && 'commit', push && 'push'] as const) {
      if (!step) continue
      const diff = await gitDiff($, cwd, step, GIT_ADD.test(shell))
      if (diff === null) continue
      const found = await findInDiff($, diff, useGitleaks)
      if (found.length === 0) continue
      const what = `${describe(found.map(f => f.finding))} in ${[...new Set(found.map(f => f.file))].slice(0, 3).join(', ')}`
      stats.held++
      if (await allow($, `This ${step} adds what looks like ${what}.`)) continue
      stats.blocked++
      return {
        deny: `secret-guard: the user blocked this ${step}: it adds what looks like ${what}. Take the secret out of the code (read it from an environment variable or a git-ignored file), ${step === 'push' ? 'rewrite the commit that added it, ' : 'unstage it, '}then try again. If the key was real, tell the user to rotate it.`,
      }
    }
    return next(e)
  })

  // 1. Tool output, after the tool ran.
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if (!redactOutput || SKIP.has(e.tool) || r.deny !== undefined || typeof r.text !== 'string') return r
    const found = await scan($, r.text, useGitleaks)
    if (found.length === 0) return r
    for (const f of found) stats.hidden.set(f.kind, (stats.hidden.get(f.kind) ?? 0) + 1)
    $.ui.toast(`secret-guard: hid ${describe(found)} from Claude (${e.tool} output)`)
    if (r.isError) return { deny: redact(r.text, found) }
    return { result: mapStrings(r.result, s => redact(s, found)), context: r.context } as typeof r
  })
}

// Built-in rules, plus gitleaks when installed; one finding per distinct secret.
export async function scan($: EngineInterface, text: string, useGitleaks: boolean): Promise<Finding[]> {
  if (text.length < 8) return []
  const found = builtin(text)
  if (useGitleaks && text.length <= GITLEAKS_MAX) found.push(...(await runGitleaks($, text)))
  return unique(found)
}

async function runGitleaks($: EngineInterface, text: string): Promise<Finding[]> {
  const bin = await findGitleaks($)
  if (!bin) return []
  try {
    // From a neutral folder, with gitleaks:allow comments ignored: the repo being read can't
    // switch the scan off with its own .gitleaks.toml, .gitleaksignore or inline comments.
    const tmp = (await $.env.get('TMPDIR')) || '/tmp'
    const r = await $.process.run(
      [bin, 'stdin', '--no-banner', '--log-level', 'error', '--ignore-gitleaks-allow', '-f', 'json', '-r', '-', '--exit-code', '0'],
      { stdin: text, cwd: tmp, timeoutMs: 10_000 },
    )
    if (r.exitCode !== 0) return []
    const rows = JSON.parse(r.stdout || '[]') as { RuleID?: string; Secret?: string }[]
    return rows.filter(x => typeof x.Secret === 'string' && x.Secret.length >= 8).map(x => ({ kind: kindOf(x.RuleID ?? 'secret'), secret: x.Secret as string }))
  } catch {
    return []
  }
}

async function findGitleaks($: EngineInterface): Promise<string | null> {
  if (gitleaks !== undefined) return gitleaks
  const r = await $.process.run(['gitleaks', 'version'], { timeoutMs: 5_000 }).catch(() => null)
  gitleaks = r && r.exitCode === 0 ? 'gitleaks' : null
  return gitleaks
}

// gitleaks rule ids read as words: "github-pat" -> "github pat".
function kindOf(rule: string) {
  return rule.replace(/[-_]+/g, ' ')
}

// A Write or Edit: undefined to let it through, or the deny text.
async function checkWrite($: EngineInterface, path: string, text: string, useGitleaks: boolean): Promise<string | undefined> {
  if (text.includes(MARKER)) {
    return `secret-guard: this write to ${path} contains "${MARKER}: …]", the label secret-guard showed you in place of a real secret. Writing it would replace the real secret in the file. Leave those lines as they are: edit around them with Edit, or ask the user to change the secret.`
  }
  const found = await scan($, text, useGitleaks)
  if (found.length === 0) return undefined
  const what = describe(found)
  if (await ignored($, path)) {
    $.ui.toast(`secret-guard: ${what} written to ${short(path)} (git ignores it)`)
    return undefined
  }
  stats.held++
  if (await allow($, `This write to ${short(path)} adds what looks like ${what}, in a file git would commit.`)) return undefined
  stats.blocked++
  return `secret-guard: the user blocked writing ${what} to ${path}. Don't put secrets in files git commits: read it from an environment variable, or put it in a git-ignored file such as .env.`
}

// Whether git ignores the file (so it can't be committed by accident).
async function ignored($: EngineInterface, path: string) {
  const dir = path.replace(/\/[^/]*$/, '') || '/'
  const r = await $.process.run([...GIT_SAFE, 'check-ignore', '-q', '--', path], { cwd: dir, timeoutMs: 5_000 }).catch(() => null)
  return r !== null && r.exitCode === 0
}

// What a commit or push would add, as a diff; null when git can't say.
// A commit is checked before its command runs, and `git add x && git commit` stages x only
// then: so a commit scans every change since HEAD (staged or not), and when the command
// runs `git add`, the untracked files git doesn't ignore too. It may ask about a change the
// commit leaves out; it never misses one the commit takes.
async function gitDiff($: EngineInterface, cwd: string, step: 'commit' | 'push', adds: boolean): Promise<string | null> {
  const at = { cwd, timeoutMs: 30_000 }
  const run = (argv: string[]) => $.process.run(argv, at).catch(() => null)
  const DIFF = [...GIT_SAFE, 'diff', '--no-ext-diff', '--no-color', '-U0']
  if (step === 'push') {
    // Every commit not on any remote yet, each one's own patch: a secret added and then
    // deleted still lands in history.
    const r = await run([...GIT_SAFE, 'log', '-p', '--no-ext-diff', '--no-color', '-U0', '--format=', 'HEAD', '--not', '--remotes'])
    return r && r.exitCode === 0 ? r.stdout : null
  }
  let r = await run([...DIFF, 'HEAD'])
  if (!r || r.exitCode !== 0) r = await run([...DIFF, '--cached']) // no commit yet
  if (!r || r.exitCode !== 0) return null
  return adds ? r.stdout + (await untracked($, cwd)) : r.stdout
}

// Untracked files git doesn't ignore, as a diff that adds them whole. At most 200 files of 1 MB.
async function untracked($: EngineInterface, cwd: string): Promise<string> {
  const r = await $.process.run([...GIT_SAFE, 'ls-files', '--others', '--exclude-standard', '-z'], { cwd, timeoutMs: 30_000 }).catch(() => null)
  if (!r || r.exitCode !== 0) return ''
  let out = ''
  for (const file of r.stdout.split('\0').filter(Boolean).slice(0, 200)) {
    const path = `${cwd.replace(/\/$/, '')}/${file}`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (!stat || stat.kind !== 'file' || stat.size > 1_000_000) continue
    const text = await $.fs.read(path).catch(() => '')
    if (typeof text !== 'string') continue
    out += `\n+++ b/${file}\n${text.split('\n').map(l => `+${l}`).join('\n')}`
  }
  return out
}

async function findInDiff($: EngineInterface, diff: string, useGitleaks: boolean) {
  const lines = addedLines(diff)
  if (lines.length === 0) return []
  const found = await scan($, lines.map(l => l.text).join('\n'), useGitleaks)
  return found.map(finding => ({ finding, file: lines.find(l => l.text.includes(finding.secret))?.file || 'a file' }))
}

async function report($: EngineInterface, useGitleaks: boolean) {
  const bin = useGitleaks ? await findGitleaks($) : null
  const scanner = bin
    ? `gitleaks + built-in rules`
    : useGitleaks
      ? 'built-in rules only (install gitleaks for 150+ more: brew install gitleaks)'
      : 'built-in rules only (gitleaks is off in the options)'
  const hidden = [...stats.hidden].map(([kind, n]) => `${n} × ${kind}`)
  return [
    `Scanner: ${scanner}.`,
    hidden.length > 0 ? `Hidden from Claude this session: ${hidden.join(', ')}.` : 'Nothing hidden from Claude this session.',
    stats.held === 0 ? 'No write, commit or push added a secret.' : `Held ${stats.held} ${stats.held === 1 ? 'write, commit or push' : 'writes, commits or pushes'} that added a secret; you blocked ${stats.blocked}.`,
  ].join('\n')
}

// Asks the person; anything but "Allow once" (or no one to ask) blocks.
async function allow($: EngineInterface, why: string) {
  try {
    const answer = await $.ui.ask(`secret-guard: ${why} Allow it anyway?`, { options: ['Block it', 'Allow once'], header: 'Secret' })
    return answer === 'Allow once'
  } catch {
    return false
  }
}

// The command as the shell reads it: heredoc bodies and quoted strings blanked, so text
// that merely mentions git (a script, a commit message) is not taken for it.
export function bare(command: string) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, ' ')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// The directory a leading `cd x &&` moves to, if any.
export function cdOf(command: string): string | undefined {
  return /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/.exec(command)?.[1]?.replace(/^["']|["']$/g, '')
}

async function runDir($: EngineInterface, command: string): Promise<string> {
  const base = await $.session.cwd()
  const target = cdOf(command)
  if (target === undefined || target.includes('$')) return base
  const home = (await $.env.get('HOME')) ?? ''
  if (target === '~' || target.startsWith('~/')) return home ? home + target.slice(1) : base
  return target.startsWith('/') ? target : `${base.replace(/\/$/, '')}/${target}`
}

function short(path: string) {
  return path.split('/').slice(-2).join('/')
}
