// rulebook-guard: enforces writing and git rules kept in CLAUDE.md and memory.
//   1. No em dashes in prose: notes, docs, commit messages, PR text, Slack posts.
//   2. New commits, not `git commit --amend`.
//   3. Changed files formatted (ruff format, Prettier) before `git push`.
//   4. No personal info (emails, phone numbers) in notes, memory or commits without asking.
import type { EngineInterface, Register } from 'claude-code'

const PROSE_FILE = /\.(md|mdx|markdown|txt)$/i
const PROSE_COMMAND = /\bgh\s+(pr|issue)\s+(create|comment|edit|review)\b/
// `git`, then any global options (`-c k=v`, `-C dir`, `--no-pager`), then the subcommand.
const GIT = String.raw`\bgit(?:\s+(?:-[cC]\s+\S+|--?[\w-]+(?:=\S+)?))*\s+`
const GIT_COMMIT = new RegExp(`${GIT}commit\\b`)
const GIT_AMEND = new RegExp(`${GIT}commit\\b[^|;&]*--amend\\b`)
const GIT_PUSH = new RegExp(`${GIT}push\\b`)
const SLACK_POST = /^mcp__claude_ai_Slack__slack_(send_message|send_message_draft|schedule_message)$/
const EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i
const PHONE = /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{2,4}/
const PRETTIER_FILE = /\.(js|jsx|ts|tsx|mjs|cjs|json|css|scss|md|mdx|ya?ml|html)$/

export const register: Register = on => {
  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    if (await isPrivatePath($, e.file_path)) {
      const found = pii(e.content)
      if (found && !(await allow($, `This write to ${short(e.file_path)} contains what looks like ${found}.`))) {
        return { deny: `rulebook-guard: the user blocked writing ${found} to ${e.file_path}. Personal info needs the user's approval first. Write the outcome instead of the details.` }
      }
    }
    if (PROSE_FILE.test(e.file_path) && e.content.includes('—')) {
      $.ui.toast(`rulebook-guard: replaced ${count(e.content)} em dash(es) in ${short(e.file_path)}`)
      return next({ ...e, content: undash(e.content) })
    }
    return next(e)
  })

  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    if (await isPrivatePath($, e.file_path)) {
      const found = pii(e.new_string)
      if (found && !(await allow($, `This edit to ${short(e.file_path)} adds what looks like ${found}.`))) {
        return { deny: `rulebook-guard: the user blocked writing ${found} to ${e.file_path}. Personal info needs the user's approval first. Write the outcome instead of the details.` }
      }
    }
    if (PROSE_FILE.test(e.file_path) && e.new_string.includes('—')) {
      $.ui.toast(`rulebook-guard: replaced ${count(e.new_string)} em dash(es) in ${short(e.file_path)}`)
      return next({ ...e, new_string: undash(e.new_string) })
    }
    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    let command = e.command
    const shell = bare(command) // what the shell runs, without quoted text or heredoc bodies

    if (GIT_AMEND.test(shell)) {
      if (!(await allow($, 'This is `git commit --amend`. Your rule: make a new commit instead.'))) {
        return { deny: 'rulebook-guard: the user blocked `git commit --amend`. Their rule is new commits, not amend. Make a new commit instead.' }
      }
    }

    if (GIT_COMMIT.test(shell)) {
      const found = pii(command)
      if (found && !(await allow($, `This commit message contains what looks like ${found}.`))) {
        return { deny: `rulebook-guard: the user blocked a commit message with ${found}. Personal info needs the user's approval first.` }
      }
    }

    if (GIT_PUSH.test(shell)) {
      const problems = await unformatted($, cdOf(command))
      if (problems.length > 0 && !(await allow($, `Not formatted yet: ${problems.join('; ')}. Your rule: format before push.`))) {
        return { deny: `rulebook-guard: the user blocked the push because these are not formatted: ${problems.join('; ')}. Run the formatter(s), commit, then push.` }
      }
    }

    if ((GIT_COMMIT.test(shell) || PROSE_COMMAND.test(shell)) && command.includes('—')) {
      $.ui.toast(`rulebook-guard: replaced ${count(command)} em dash(es) in the ${GIT_COMMIT.test(shell) ? 'commit message' : 'PR text'}`)
      command = undash(command)
    }

    return next(command === e.command ? e : { ...e, command })
  })

  // Slack posts: no em dashes either.
  on('tool.call', async ($, e, next) => {
    if (!SLACK_POST.test(e.tool)) return next(e)
    const args = e as unknown as { message?: unknown }
    if (typeof args.message !== 'string' || !args.message.includes('—')) return next(e)
    $.ui.toast(`rulebook-guard: replaced ${count(args.message)} em dash(es) in the Slack message`)
    return next({ ...e, message: undash(args.message) } as typeof e)
  })
}

// The command as the shell reads it: heredoc bodies and quoted strings blanked, so text
// that merely mentions a command (a script, a commit message) is not taken for one.
export function bare(command: string) {
  return command
    .replace(/<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?\n\s*\2\s*(\n|$)/g, ' ')
    .replace(/'[^']*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
}

// "a — b" and "a—b" both read "a, b".
export function undash(text: string) {
  return text.replace(/\s*—\s*/g, ', ')
}

function count(text: string) {
  return text.split('—').length - 1
}

// What kind of personal info the text seems to hold, by category only; never the value.
export function pii(text: string): string | null {
  if (EMAIL.test(text)) return 'an email address'
  if (PHONE.test(text)) return 'a phone number'
  return null
}

// Notes, auto-memory and CLAUDE.md files: where the PII rule applies.
async function isPrivatePath($: EngineInterface, path: string) {
  const home = (await $.env.get('HOME')) ?? ''
  return (
    (home !== '' && path.startsWith(`${home}/notes/`)) ||
    /\/(\.claude|\.claude-work)\/projects\/[^/]+\/memory\//.test(path) ||
    /(^|\/)CLAUDE\.md$/.test(path)
  )
}

// Asks the person; anything but "Allow once" (or no one to ask) blocks.
async function allow($: EngineInterface, why: string) {
  try {
    const answer = await $.ui.ask(`rulebook-guard: ${why} Allow it anyway?`, {
      options: ['Block it', 'Allow once'],
      header: 'Rulebook',
    })
    return answer === 'Allow once'
  } catch {
    return false
  }
}

// The directory a leading `cd x &&` moves to, if any.
export function cdOf(command: string): string | undefined {
  return /^\s*cd\s+("[^"]+"|'[^']+'|\S+)\s*&&/.exec(command)?.[1]?.replace(/^["']|["']$/g, '')
}

// Changed files the repo's own formatters would change, as short reasons.
async function unformatted($: EngineInterface, cwd: string | undefined): Promise<string[]> {
  const init = cwd ? { cwd } : undefined
  const top = await $.process.run(['git', 'rev-parse', '--show-toplevel'], init).catch(() => null)
  if (!top || top.exitCode !== 0) return []
  const root = top.stdout.trim()
  const at = { cwd: root, timeoutMs: 60_000 }

  let diff = await $.process.run(['git', 'diff', '--name-only', '--diff-filter=ACMR', '@{u}...HEAD'], at)
  if (diff.exitCode !== 0) diff = await $.process.run(['git', 'diff', '--name-only', '--diff-filter=ACMR', 'origin/main...HEAD'], at)
  if (diff.exitCode !== 0) return []
  const files = diff.stdout.split('\n').filter(Boolean)
  const problems: string[] = []

  const py = files.filter(f => f.endsWith('.py'))
  if (py.length > 0) {
    const ruff = await $.process.run(['ruff', 'format', '--check', ...py], at).catch(() => null)
    if (ruff && ruff.exitCode === 1) {
      const bad = ruff.stdout.split('\n').filter(l => l.startsWith('Would reformat:')).map(l => l.slice(16).trim())
      problems.push(`ruff format: ${bad.join(', ') || 'some Python files'}`)
    }
  }

  const web = files.filter(f => PRETTIER_FILE.test(f))
  const hasPrettier = await $.fs.exists(`${root}/node_modules/.bin/prettier`).catch(() => false)
  if (web.length > 0 && hasPrettier) {
    const prettier = await $.process.run([`${root}/node_modules/.bin/prettier`, '--check', ...web], at).catch(() => null)
    if (prettier && prettier.exitCode === 1) {
      const bad = `${prettier.stdout}\n${prettier.stderr}`.split('\n').filter(l => l.startsWith('[warn] ') && !l.includes('Code style issues')).map(l => l.slice(7).trim())
      problems.push(`prettier: ${bad.join(', ') || 'some files'}`)
    }
  }
  return problems
}

function short(path: string) {
  return path.split('/').slice(-2).join('/')
}
