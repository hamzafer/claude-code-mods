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
// The three option forms can't match the same text, so a long run of them can't backtrack.
const GIT = String.raw`\bgit(?:[ \t]+(?:-[cC][ \t]+[^\s-]\S*|--[\w-]+(?:=\S+)?|-[^\s-cC]\S*))*[ \t]+`
const GIT_COMMIT = new RegExp(`${GIT}commit\\b`)
const GIT_ADD = new RegExp(`${GIT}add\\b`)
const GIT_INIT = new RegExp(`${GIT}init\\b`)
const GIT_PUSH = new RegExp(`${GIT}push\\b`)
// A commit or push with its global options, matched on the bare command (quotes filled, same
// length), so the options' place in the real command is known and a `-C` read from there.
const GIT_STEP = /\bgit((?:[ \t]+(?:-[cC][ \t]+[^\s-]\S*|--[\w-]+(?:=\S+)?|-[^\s-cC]\S*))*)[ \t]+(commit|push)\b/dg
const GIT_SAFE = ['git', '-c', 'core.fsmonitor=false', '--no-pager'] as const
// Tools whose results are the person's own words or Claude's: nothing to hide from Claude.
const SKIP = new Set(['AskUserQuestion', 'TodoWrite', 'ExitPlanMode', 'EnterPlanMode'])
const WRITES = new Set(['Write', 'Edit', 'NotebookEdit', 'MultiEdit'])
const GITLEAKS_MAX = 2_000_000 // a diff
const TRUNCATED = '\n[secret-guard: cut at 4 MiB]'
const GITLEAKS_OUTPUT_MAX = 512_000 // a tool's output: bigger outputs get the built-in rules only, to stay fast

type Stats = { hidden: Map<string, number>; held: number; blocked: number }
const stats: Stats = { hidden: new Map(), held: 0, blocked: 0 }
// undefined: not looked for yet; null: not installed (looked for again after 5 minutes).
let gitleaks: string | null | undefined
let gitleaksCheckedAt = 0

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
    const denied = await checkWrite($, e.file_path, e.new_string, useGitleaks, e.old_string)
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
    // Each commit and push call, in its own folder: `git -C a commit && git -C b commit` checks both.
    const seen = new Set<string>()
    for (const { step, dir: c } of gitSteps(e.command)) {
      const cwd = await runDir($, e.command, c)
      if (seen.has(`${step} ${cwd}`)) continue
      seen.add(`${step} ${cwd}`)
      // A commit with its own `git -C` runs elsewhere than the add: scan every untracked file there.
      let diff = await gitDiff($, cwd, step, GIT_ADD.test(shell) ? (c ? [] : addPaths(e.command)) : null)
      // `git init && git add . && git commit`: no repo yet, so git can't answer. The folder's
      // files are what the first commit takes; a folder the command makes has none yet.
      // Only when git says the folder is no repo: a timeout in a big repo still asks.
      if (diff === null && step === 'commit' && GIT_INIT.test(shell) && (await notARepo($, cwd))) diff = await folderFiles($, cwd)
      if (diff === null) {
        // git couldn't say what goes in (not a repo, a timeout): ask rather than wave it through.
        stats.held++
        if (await allow($, `Couldn't read what this ${step} adds (git gave no answer in ${short(cwd)}), so it wasn't checked for keys.`)) continue
        stats.blocked++
        return { deny: `secret-guard: the user blocked this ${step}: secret-guard couldn't read what it adds, so it wasn't checked for keys.` }
      }
      const found = await findInDiff($, diff, useGitleaks)
      if (found.length === 0 && diff.endsWith(TRUNCATED)) {
        // Over 4 MiB of changes: the rest wasn't read, so say so instead of passing it as clean.
        stats.held++
        if (await allow($, `This ${step} is too big to check whole: secret-guard read part of it and found no keys there.`)) continue
        stats.blocked++
        return { deny: `secret-guard: the user blocked this ${step}: it was too big for secret-guard to check whole.` }
      }
      if (found.length === 0) continue
      const what = `${describe(found.map(f => f.finding))} in ${[...new Set(found.map(f => f.file))].slice(0, 3).join(', ')}`
      stats.held++
      // A cut diff with a key in its start: one ask says both, so Allow once can't skip the cut.
      const cut = diff.endsWith(TRUNCATED) ? ` It's also too big to check whole: secret-guard read only part of it.` : ''
      if (await allow($, `This ${step} adds what looks like ${what}.${cut}`)) continue
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
    // The tool's own record is scanned, string by string: the text the model reads is mapped
    // from it (Read adds line numbers, an MCP mapper may escape), so a secret found in that
    // text may not be a substring of the record. The record is what gets rewritten.
    // Write and Edit records hold the whole file (originalFile, the patch) that Claude never
    // reads: there only the text Claude reads is scanned.
    const leaves: string[] = []
    if (!WRITES.has(e.tool)) mapStrings(r.result, s => (leaves.push(s), s))
    const context = r.context ?? []
    const found = await scanAll($, [...leaves, ...context], useGitleaks)
    // What the model reads but the record doesn't spell the same way (a mapper that adds or
    // reshapes text): withheld whole, redacted. A kind already found in the record is covered.
    const kinds = new Set(found.map(f => f.kind))
    const left = unique(builtin(r.text)).filter(f => !kinds.has(f.kind) && !leaves.some(l => l.includes(f.secret)))
    if (found.length === 0 && left.length === 0) return r
    const all = [...found, ...left]
    for (const f of all) stats.hidden.set(f.kind, (stats.hidden.get(f.kind) ?? 0) + 1)
    $.ui.toast(`secret-guard: hid ${describe(all)} from Claude (${e.tool} output)`)
    // Context entries other hooks attached can't be rewritten or dropped, only withheld with the
    // result: so a secret there, an error, or one only the mapped text shows withholds it all.
    const inContext = context.some(c => all.some(f => c.includes(f.secret)))
    if (r.isError || left.length > 0 || inContext) return { deny: redact([r.text, ...context].join('\n'), all) }
    return { result: mapStrings(r.result, s => redact(s, found)), context: r.context } as typeof r
  })
}

// Built-in rules, plus gitleaks when installed; one finding per distinct secret.
export async function scan($: EngineInterface, text: string, useGitleaks: boolean, max = GITLEAKS_MAX): Promise<Finding[]> {
  if (text.length < 8) return []
  const found = builtin(text)
  if (useGitleaks && text.length <= max) found.push(...(await runGitleaks($, text)))
  return unique(found)
}

// Several strings: the built-in rules on each, gitleaks once on them all. A finding that
// spans two strings can't be cut out of either, so gitleaks's are kept only when one string holds it.
async function scanAll($: EngineInterface, texts: readonly string[], useGitleaks: boolean): Promise<Finding[]> {
  const found = texts.flatMap(t => builtin(t))
  const joined = texts.filter(t => t.length >= 8).join('\n')
  if (useGitleaks && joined.length >= 8 && joined.length <= GITLEAKS_OUTPUT_MAX) {
    for (const f of await runGitleaks($, joined)) if (texts.some(t => t.includes(f.secret))) found.push(f)
  }
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
  if (gitleaks || (gitleaks === null && Date.now() - gitleaksCheckedAt < 300_000)) return gitleaks ?? null
  gitleaksCheckedAt = Date.now()
  const r = await $.process.run(['gitleaks', 'version'], { timeoutMs: 5_000 }).catch(() => null)
  gitleaks = r && r.exitCode === 0 ? 'gitleaks' : null
  return gitleaks
}

// gitleaks rule ids read as words: "github-pat" -> "github pat".
function kindOf(rule: string) {
  return rule.replace(/[-_]+/g, ' ')
}

// A Write or Edit: undefined to let it through, or the deny text.
async function checkWrite($: EngineInterface, path: string, text: string, useGitleaks: boolean, before?: string): Promise<string | undefined> {
  if (text.includes(MARKER) && !(before ?? (await $.fs.read(path).catch(() => ''))).toString().includes(MARKER)) {
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
  const abs = path.startsWith('/') ? path : `${(await $.session.cwd()).replace(/\/$/, '')}/${path}`
  let dir = abs.replace(/\/[^/]*$/, '') || '/'
  for (let i = 0; i < 40 && dir !== '/' && !(await $.fs.exists(dir).catch(() => false)); i++) dir = dir.replace(/\/[^/]*$/, '') || '/'
  const r = await $.process.run([...GIT_SAFE, 'check-ignore', '-q', '--', abs], { cwd: dir, timeoutMs: 5_000 }).catch(() => null)
  return r !== null && r.exitCode === 0
}

// What a commit or push would add, as a diff; null when git can't say.
// A commit is checked before its command runs, and `git add x && git commit` stages x only
// then: so a commit scans every change since HEAD (staged or not), and when the command
// runs `git add`, the untracked files git doesn't ignore too. It may ask about a change the
// commit leaves out; it never misses one the commit takes.
// adds: the pathspecs the command's `git add` stages ([] = every untracked file), or null when it runs none.
async function gitDiff($: EngineInterface, cwd: string, step: 'commit' | 'push', adds: string[] | null): Promise<string | null> {
  const at = { cwd, timeoutMs: 30_000 }
  const run = (argv: string[]) => $.process.run(argv, at).catch(() => null)
  const DIFF = [...GIT_SAFE, 'diff', '--no-ext-diff', '--no-color', '-U0']
  if (step === 'push') {
    // Every commit not on any remote yet, each one's own patch: a secret added and then
    // deleted still lands in history. With no remote at all, that's the whole history.
    // Every local branch, not just HEAD: `git push origin other-branch` pushes that one.
    const r = await run([...GIT_SAFE, 'log', '-p', '--no-ext-diff', '--no-color', '-U0', '--format=', '--branches', '--not', '--remotes'])
    return r && r.exitCode === 0 ? r.stdout + (r.isStdoutTruncated ? TRUNCATED : '') : null
  }
  let r = await run([...DIFF, 'HEAD'])
  if (!r || r.exitCode !== 0) r = await run([...DIFF, '--cached']) // no commit yet
  if (!r || r.exitCode !== 0) return null
  const out = adds ? r.stdout + (await untracked($, cwd, adds)) : r.stdout
  return r.isStdoutTruncated && !out.endsWith(TRUNCATED) ? out + TRUNCATED : out
}

// Whether git says the folder is in no repo (exit 128), as opposed to failing some other way.
// A folder that doesn't exist yet (`mkdir app && cd app && git init`) counts as no repo.
async function notARepo($: EngineInterface, cwd: string) {
  if (!(await $.fs.exists(cwd).catch(() => false))) return true
  const r = await $.process.run([...GIT_SAFE, 'rev-parse', '--git-dir'], { cwd, timeoutMs: 5_000 }).catch(() => null)
  return r !== null && r.exitCode === 128
}

// A folder's files as a diff that adds them whole, for a commit right after `git init`.
// Skips .git and node_modules; at most 200 files of 1 MB, 5 MB in all, 300 folders, 6
// levels; past a cap the diff ends in TRUNCATED. Links are never followed. It doesn't read .gitignore, so an ignored key file asks.
async function folderFiles($: EngineInterface, root: string): Promise<string> {
  if (!(await $.fs.exists(root).catch(() => false))) return ''
  let out = ''
  let left = 200
  let dirs = 300
  let cut = false // a cap left something unread: the commit then asks instead of passing as clean
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (dirs-- <= 0) return void (cut = true)
    const entries = await $.fs.list(dir).catch(() => [])
    for (const en of entries) {
      if (left <= 0 || out.length > 5_000_000) return void (cut = true)
      const path = `${dir.replace(/\/$/, '')}/${en.name}`
      const name = rel ? `${rel}/${en.name}` : en.name
      if (en.kind === 'dir' && en.name !== '.git' && en.name !== 'node_modules') {
        if (depth < 6) await walk(path, name, depth + 1)
        else cut = true
      }
      if (en.kind === 'file' && en.size > 1_000_000) cut = true
      if (en.kind !== 'file' || en.size > 1_000_000) continue
      left--
      const text = await $.fs.read(path).catch(() => '')
      if (typeof text === 'string') out += `\n+++ b/${name}\n${text.split('\n').map(l => `+${l}`).join('\n')}`
    }
  }
  await walk(root, '', 0)
  return cut ? out + TRUNCATED : out
}

// Untracked files git doesn't ignore, as a diff that adds them whole. At most 200 files of 1 MB.
// Only those the command's `git add` names: a big build file lying around that the commit
// leaves out must not make every commit "too big to check".
async function untracked($: EngineInterface, cwd: string, paths: string[] = []): Promise<string> {
  const spec = paths.length > 0 ? ['--', ...paths] : []
  const list = (argv: string[]) => $.process.run([...GIT_SAFE, 'ls-files', '--others', '--exclude-standard', '-z', ...argv], { cwd, timeoutMs: 30_000 }).catch(() => null)
  let r = await list(spec)
  // A path git won't take (outside the repo, in a submodule) fails the whole list: scan every untracked file instead.
  if (spec.length > 0 && (!r || r.exitCode !== 0)) r = await list([])
  if (!r || r.exitCode !== 0) return ''
  let out = ''
  const files = r.stdout.split('\0').filter(Boolean)
  let cut = files.length > 200
  for (const file of files.slice(0, 200)) {
    const path = `${cwd.replace(/\/$/, '')}/${file}`
    const stat = await $.fs.stat(path).catch(() => undefined)
    if (stat?.kind === 'file' && stat.size > 1_000_000) cut = true
    if (!stat || stat.kind !== 'file' || stat.size > 1_000_000) continue
    const text = await $.fs.read(path).catch(() => '')
    if (typeof text !== 'string') continue
    out += `\n+++ b/${file}\n${text.split('\n').map(l => `+${l}`).join('\n')}`
  }
  return cut ? out + TRUNCATED : out
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
// Same length as the command: heredoc bodies become spaces, quoted text becomes _ inside its quotes.
export function bare(command: string) {
  const fill = (m: string) => m[0] + '_'.repeat(m.length - 2) + m[m.length - 1]
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/'[^']*'/g, fill)
    .replace(/"(?:[^"\\]|\\.)*"/g, fill)
}

// The paths every `git add` in the command stages. [] means all untracked files. It fails
// closed: once the scan covers only these paths, a path read wrong is a file committed
// unscanned. So it narrows only when every word after each `add` is a plain relative path
// or a known-safe option, the `add` has no global options of its own (`git -C sub add`),
// and no `cd` moves the shell after the start. Anything else (`.`, `-A`, `-u`, globs, `$x`,
// `\ ` escapes, `{a,b}`, `~`, `:(magic)`, `--pathspec-from-file`, line breaks, redirections)
// scans every untracked file, as before.
const ADD_SAFE_OPTS = new Set(['-v', '--verbose', '-f', '--force', '-N', '--intent-to-add'])
export function addPaths(command: string): string[] {
  if (!plainShape(command)) return []
  const shell = bare(command)
  // A `cd` (or pushd/popd) after the start moves the add away from where the commit runs.
  const cds = [...shell.matchAll(/(^|[;&|(\n])\s*(cd|pushd|popd)\b/g)]
  // Only a leading `cd x &&` is allowed: the commit follows that one too.
  if (cds.length > 1 || (cds.length === 1 && (cds[0][1] !== '' || cdOf(command) === undefined))) return []
  if (/\\\n/.test(command)) return []
  const out: string[] = []
  const re = new RegExp(`${GIT}add\\b`, 'g')
  for (const m of shell.matchAll(re)) {
    if (!/^git[ \t]+add$/.test(m[0])) return []
    // Nothing before `git` in its step: `GIT_DIR=x git add`, `sudo git add`, `xargs git add` move or hide the paths.
    if (/\S/.test(shell.slice(0, m.index).split(/&&|\|\||[;|&\n(]/).pop()!)) return []
    const from = m.index + m[0].length
    const end = shell.slice(from).search(/&&|\|\||[;|&\n]/)
    const words = [...command.slice(from, end < 0 ? undefined : from + end).matchAll(/(?:"[^"]*"|'[^']*'|[^\s"'])+/g)].map(w => w[0])
    if (words.length === 0) return []
    let opts = true
    for (const w of words) {
      if (opts && w === '--') { opts = false; continue }
      if (opts && w.startsWith('-')) {
        if (!ADD_SAFE_OPTS.has(w)) return []
        continue
      }
      // Quotes may wrap a whole plain path ("b c.md"); anything the shell or git would read further may not.
      if (/[\\$`*?[\]{}~:<>()!#&=]/.test(w)) return []
      // A word glued from quoted and bare parts ('safe'.env) is one path the split above may cut.
      if (!/^(?:"[^"]*"|'[^']*'|[^"']*)$/.test(w)) return []
      const path = w.replace(/"([^"]*)"|'([^']*)'/g, '$1$2')
      if (path === '' || path === '.' || path.startsWith('/') || path.startsWith('-') || /["']/.test(path)) return []
      out.push(path)
    }
  }
  return out
}

// Whether the whole command is a shape addPaths can read for sure: an optional leading
// `cd dir`, then only `git add`, `git commit`, `git push` and `git status`, joined by `&&`,
// `;` or line breaks. A commit message may be quoted, or a `"$(cat <<'EOF' … EOF)"` heredoc
// (its delimiter quoted, so nothing in it runs). Anything else may stage or move a file the
// parse never sees: `git stage`, `bash -c "git add x"`, `eval`, `{ cd x; }`, `command cd`,
// `git -c alias.s=add s x`, `"git" add`.
const PLAIN_GIT = new Set(['add', 'commit', 'push', 'status'])
function plainShape(command: string): boolean {
  let isQuoteSafe = true
  const s = command
    .replace(/"\$\(cat <<'(\w+)'\n[\s\S]*?\n\1\n\s*\)"/g, '""')
    .replace(/"[^"]*"|'[^']*'/g, q => {
      if (q[0] === '"' && /[$`\\!]/.test(q)) isQuoteSafe = false // still read by the shell
      return q[0] + q[0]
    })
  if (!isQuoteSafe) return false
  const steps = s.split(/&&|;|\n/)
  if (/[`$\\<>|(){}*?[\]~!#&"']/.test(steps.join(' ').replace(/''|""/g, ''))) return false
  return steps.every((step, i) => {
    const words = step.trim().split(/[ \t]+/).filter(Boolean)
    if (words.length === 0) return true
    if (i === 0 && words[0] === 'cd') return words.length === 2
    return words[0] === 'git' && PLAIN_GIT.has(words[1])
  })
}

// The directory a leading `cd x &&` moves to, if any.
export function cdOf(command: string): string | undefined {
  return /^\s*cd\s+("[^"]+"|'[^']+'|[^\s;&|]+)\s*(?:&&|;)/.exec(command)?.[1]?.replace(/^["']|["']$/g, '')
}

// Where git runs: the session's folder, moved by a leading `cd x &&` and then by `git -C y`.
async function runDir($: EngineInterface, command: string, c: string | undefined): Promise<string> {
  const home = (await $.env.get('HOME')) ?? ''
  const join = (base: string, to: string | undefined) => {
    if (to === undefined || to.includes('$')) return base
    if (to === '~' || to.startsWith('~/')) return home ? home + to.slice(1) : base
    return to.startsWith('/') ? to : `${base.replace(/\/$/, '')}/${to}`
  }
  const dir = join(await $.session.cwd(), cdOf(command))
  return join(dir, c)
}

// The folder the commit's or push's own `git -C dir` names, if any. Text in quotes (a commit
// message that mentions `git -C x`) and other git calls (`git -C x status && git commit`) don't count.
export function gitCOf(command: string, step: 'commit' | 'push' = 'commit'): string | undefined {
  return gitSteps(command).find(s => s.step === step)?.dir
}

// Every commit and push call in the command, each with the folder its own `git -C` names.
export function gitSteps(command: string): { step: 'commit' | 'push'; dir: string | undefined }[] {
  const out: { step: 'commit' | 'push'; dir: string | undefined }[] = []
  for (const m of bare(command).matchAll(GIT_STEP)) {
    if (!m.indices?.[1]) continue
    const [from, to] = m.indices[1]
    // A shell word: quoted parts and bare parts run together, as in `"a b"/c`.
    const opts = [...command.slice(from, to).matchAll(/(?:^|[ \t])-C[ \t]+((?:"[^"]*"|'[^']*'|[^\s"'])+)/g)]
    const dir = opts.at(-1)?.[1]?.replace(/"([^"]*)"|'([^']*)'/g, '$1$2')
    out.push({ step: m[2] as 'commit' | 'push', dir })
  }
  return out
}

function short(path: string) {
  return path.split('/').slice(-2).join('/')
}
