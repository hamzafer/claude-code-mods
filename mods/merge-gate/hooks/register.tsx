// Merge Gate: CI, the Codex second-opinion review and the merge in one view.
//   - `codex review`: preflights ~/.codex/config.toml for the Ollama takeover, requires the
//     gpt-5.6-luna model, allows one pass per PR, and never `codex exec`.
//   - `gh pr merge`: holds the merge when CI is not green or Codex has not run, and asks.
//   - A band above the prompt for the current branch's PR, and /gate (/gate rerun).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallResult } from 'claude-code'

import type { GateStatus } from '../types'

const LUNA = 'gpt-5.6-luna'

// A command counts only where the shell starts one: at the start, after ; & | ( or a backtick,
// or on a new line. Before it may come VAR=x, sudo, env, npx, bunx, time, !, then, do or else,
// and options; between the tool and its subcommand, global options (codex -c k=v exec, gh -R o/r pr merge).
const START = String.raw`(?:^|[\n;&|(\x60])\s*`
const PREFIX = String.raw`(?:(?:\w+=\S*|sudo|env|npx|bunx|time|!|then|do|else|-\S+)\s+)*`
const OPTS = String.raw`(?:\s+-\S+(?:\s+[^\s;&|)\x60-]\S*)?)*`
const at = (tool: string, ...sub: string[]) => new RegExp(START + PREFIX + String.raw`(?:\S*/)?` + tool + sub.map(s => OPTS + String.raw`\s+` + s).join('') + String.raw`(?![\w-])`)
const CODEX_EXEC = at('codex', 'exec')
const CODEX_REVIEW = at('codex', 'review')
const GH_MERGE = at('gh', 'pr', 'merge')

// Held by the host, so the band survives a hot reload of this file.
const status = atom({ plugin: 'merge-gate', key: 'status' } as const, null as GateStatus | null)

type Pr = { number: number; title: string; branch: string }
type Checks = { pass: number; fail: number; pending: number; failing: string[] }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'gate', description: 'PR status: CI, Codex review, ready to merge? (/gate rerun retries failed CI)', argumentHint: '[rerun]' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    void refresh($).catch(() => {}) // background; a failed refresh just keeps the last band
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) void refresh($).catch(() => {}) // in the background, so the turn ends at once
    return r
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const shell = bare(e.command) // what the shell runs, without quoted text, heredoc bodies or comments
    if (CODEX_EXEC.test(shell)) {
      return { deny: 'Merge Gate: `codex exec` can edit the branch. The rule is review only: use `codex review`.' }
    }
    if (CODEX_REVIEW.test(shell)) return codexReview($, e.command, () => next(e))
    if (GH_MERGE.test(shell)) return merge($, shell, () => next(e))
    return next(e)
  })

  on('command.run', { command: 'gate' }, async ($, e) => {
    if (e.args.trim() === 'rerun') return { text: await rerun($) }
    const s = await refresh($)
    return { text: s ? describeStatus(s) : 'No open PR for this branch.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const s = await read($, status)
    if (e.props.hasSurvey || !s) return rest

    const { Box, Text } = $.ui.resolve(e)
    const ci = s.fail > 0 ? 'red' : s.pending > 0 ? 'yellow' : 'green'
    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          <Text bold>{` ⛙ PR #${s.pr} `}</Text>
          <Text color={ci}>
            {s.fail > 0 ? `CI ✗ ${s.fail} failing` : s.pending > 0 ? `CI … ${s.pending} running` : `CI ✓ ${s.pass}`}
          </Text>
          <Text dimColor>{'  ·  '}</Text>
          <Text color={s.codex > 0 ? 'green' : 'yellow'}>{`Codex ${Math.min(s.codex, 1)}/1`}</Text>
          {s.fail > 0 && <Text dimColor>{'  ·  /gate rerun'}</Text>}
          <Text dimColor>{`  ·  ${s.title}`}</Text>
        </Text>
        {rest}
      </Box>
    )
  })
}

async function codexReview($: EngineInterface, command: string, run: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const home = (await $.env.get('HOME')) ?? ''
  const config = await $.fs.read(`${home}/.codex/config.toml`).catch(() => '')
  if (isOllama(config)) {
    return {
      deny:
        "Merge Gate: ~/.codex/config.toml points at Ollama (the Ollama app's ChatGPT toggle is on), so the review would go to a local model. " +
        'Stop and ask Hamza to switch the toggle off. Do not edit the config.',
    }
  }
  if (!command.includes(LUNA)) {
    return { deny: `Merge Gate: Codex reviews run on ${LUNA} only. Add -c 'model="${LUNA}"' to the command.` }
  }
  const key = await codexKey($)
  const done = Number((await $.store.get(key)) ?? 0)
  if (done >= 1) {
    return { deny: 'Merge Gate: Codex already reviewed this PR once (rule: one pass per PR). Fix or answer its findings instead of running it again.' }
  }
  await $.store.set(key, done + 1) // counted when it starts: a quota error is not a reason to retry
  void refresh($).catch(() => {}) // background; a failed refresh just keeps the last band
  return run()
}

async function merge($: EngineInterface, command: string, run: () => Promise<ToolCallResult>): Promise<ToolCallResult> {
  const asked = prNumber(command)
  const pr = await currentPr($, asked)
  if (!pr) return run()
  const checks = await ciChecks($, pr.number)
  const codex = Number((await $.store.get(await codexKey($, pr))) ?? 0)
  const missing = [
    checks.fail > 0 && `CI has ${checks.fail} failing (${checks.failing.join(', ')})`,
    checks.pending > 0 && `CI has ${checks.pending} still running`,
    codex === 0 && 'Codex has not reviewed it',
  ].filter((x): x is string => typeof x === 'string')
  if (missing.length === 0) return run()

  let answer = 'Hold'
  try {
    answer = await $.ui.ask(`Merge Gate: PR #${pr.number} is not ready: ${missing.join('; ')}. Merge anyway?`, {
      options: ['Hold', 'Merge anyway'],
      header: 'Merge Gate',
    })
  } catch {
    // no one to ask: hold
  }
  if (answer === 'Merge anyway') return run()
  return { deny: `Merge Gate held the merge of PR #${pr.number}: ${missing.join('; ')}. Finish those first${checks.fail > 0 ? ' (failed CI: /gate rerun)' : ''}.` }
}

// The command as the shell reads it: heredoc bodies, quoted text and # comments blanked, so text
// that merely mentions a command (a grep pattern, a commit message, a note) is not taken for one.
// $( ) and backticks inside double quotes still run, so they are kept.
export function bare(command: string) {
  const text = command.replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, '\n')
  let i = 0

  // Plain shell, up to `stop` (the ) or backtick that closes a substitution) or the end.
  const plain = (stop?: string): string => {
    let out = ''
    let depth = 0
    while (i < text.length) {
      const c = text[i]
      if (c === stop && (stop !== ')' || depth === 0)) {
        i++
        return out
      }
      if (c === "'") {
        const end = text.indexOf("'", i + 1)
        i = end < 0 ? text.length : end + 1
        out += "''"
      } else if (c === '"') {
        i++
        out += `"${quoted()}"`
      } else if (c === '\\') {
        out += text.slice(i, i + 2)
        i += 2
      } else if (c === '#' && (i === 0 || /[\s;&|()`]/.test(text[i - 1]))) {
        const end = text.indexOf('\n', i)
        i = end < 0 ? text.length : end
      } else {
        if (c === '(') depth++
        if (c === ')') depth--
        out += c
        i++
      }
    }
    return out
  }

  // Inside double quotes: the text is dropped, the substitutions are kept.
  const quoted = (): string => {
    let out = ''
    while (i < text.length) {
      const c = text[i]
      if (c === '"') {
        i++
        return out
      }
      if (c === '\\') {
        i += 2
      } else if (c === '$' && text[i + 1] === '(') {
        i += 2
        out += `(${plain(')')})`
      } else if (c === '`') {
        i++
        out += `\`${plain('`')}\``
      } else {
        i++
      }
    }
    return out
  }

  return plain()
}

// The PR number given to `gh pr merge`, if any (options may come first).
export function prNumber(shell: string) {
  const m = GH_MERGE.exec(shell)
  if (!m) return undefined
  const rest = shell.slice(m.index + m[0].length)
  return /^(?:\s+-\S+(?:\s+[^\s;&|)\x60-]\S*)?)*?\s+(\d+)(?![^\s;&|)\x60])/.exec(rest)?.[1]
}

// Ollama's ChatGPT toggle rewrites the config to a local server or an Ollama model.
export function isOllama(config: string) {
  const base = /^\s*openai_base_url\s*=\s*"([^"]*)"/m.exec(config)?.[1] ?? ''
  const model = /^\s*model\s*=\s*"([^"]*)"/m.exec(config)?.[1] ?? ''
  return /127\.0\.0\.1:11434|localhost:11434/.test(base) || /^(gemma|llama|qwen|mistral|deepseek|phi|gpt-oss)/i.test(model) || /:\d+b\b|:latest$/.test(model)
}

// One counter per PR (or per branch before it has one), shared across sessions.
async function codexKey($: EngineInterface, known?: Pr | null) {
  const pr = known ?? (await currentPr($))
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel']).catch(() => null)
  const repo = top?.exitCode === 0 ? top.stdout.trim() : await $.session.cwd()
  if (pr) return `codex:${repo}#${pr.number}`
  const branch = await $.process.run(['git', 'branch', '--show-current']).catch(() => null)
  return `codex:${repo}@${branch?.stdout.trim() ?? 'unknown'}`
}

async function currentPr($: EngineInterface, number?: string): Promise<Pr | null> {
  const args = ['gh', 'pr', 'view', ...(number ? [number] : []), '--json', 'number,title,headRefName,state']
  const r = await $.process.run(args, { timeoutMs: 15_000 }).catch(() => null)
  if (!r || r.exitCode !== 0) return null
  try {
    const o = JSON.parse(r.stdout) as { number: number; title: string; headRefName: string; state: string }
    if (o.state !== 'OPEN') return null
    return { number: o.number, title: o.title, branch: o.headRefName }
  } catch {
    return null
  }
}

export function countChecks(json: string): Checks {
  try {
    const rows = JSON.parse(json) as { name: string; bucket: string }[]
    return {
      pass: rows.filter(c => c.bucket === 'pass' || c.bucket === 'skipping').length,
      fail: rows.filter(c => c.bucket === 'fail' || c.bucket === 'cancel').length,
      pending: rows.filter(c => c.bucket === 'pending').length,
      failing: rows.filter(c => c.bucket === 'fail' || c.bucket === 'cancel').map(c => c.name),
    }
  } catch {
    return { pass: 0, fail: 0, pending: 0, failing: [] }
  }
}

async function ciChecks($: EngineInterface, pr: number) {
  const r = await $.process.run(['gh', 'pr', 'checks', String(pr), '--json', 'name,bucket'], { timeoutMs: 15_000 }).catch(() => null)
  return countChecks(r?.stdout ?? '[]') // gh exits non-zero while checks fail or run; the JSON is still there
}

async function refresh($: EngineInterface): Promise<GateStatus | null> {
  const pr = await currentPr($)
  if (!pr) {
    await update($, status, () => null)
    return null
  }
  const checks = await ciChecks($, pr.number)
  const codex = Number((await $.store.get(await codexKey($, pr))) ?? 0)
  const s: GateStatus = { pr: pr.number, title: pr.title, branch: pr.branch, ...checks, codex }
  await update($, status, () => s)
  return s
}

async function rerun($: EngineInterface) {
  const pr = await currentPr($)
  if (!pr) return 'No open PR for this branch.'
  const list = await $.process.run(['gh', 'run', 'list', '--branch', pr.branch, '--json', 'databaseId,conclusion,name', '-L', '20'], { timeoutMs: 15_000 })
  const runs = (JSON.parse(list.stdout || '[]') as { databaseId: number; conclusion: string; name: string }[]).filter(r => r.conclusion === 'failure')
  if (runs.length === 0) return `No failed runs on ${pr.branch}.`
  const done: string[] = []
  for (const r of runs) {
    const x = await $.process.run(['gh', 'run', 'rerun', String(r.databaseId), '--failed'], { timeoutMs: 30_000 })
    done.push(`${r.name}: ${x.exitCode === 0 ? 'retriggered' : `failed (${x.stderr.trim().slice(0, 80)})`}`)
  }
  void refresh($).catch(() => {}) // background; a failed refresh just keeps the last band
  return `Reran failed jobs on PR #${pr.number}:\n${done.map(d => `- ${d}`).join('\n')}`
}

export function describeStatus(s: GateStatus) {
  const ready = s.fail === 0 && s.pending === 0 && s.codex > 0
  return [
    `PR #${s.pr}: ${s.title}`,
    `- CI: ${s.pass} passing, ${s.fail} failing${s.failing.length ? ` (${s.failing.join(', ')})` : ''}, ${s.pending} running`,
    `- Codex review: ${s.codex > 0 ? 'done' : 'not run yet'}`,
    `- ${ready ? 'Ready to merge' : 'Not ready to merge'}`,
  ].join('\n')
}
