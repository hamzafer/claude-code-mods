// Blast Radius: holds risky Bash commands and shows what they would change.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { HeldCommand } from '../types'

const PANE = 'blast-radius'
const MAX_LISTED = 200
const DEFAULT_TIMEOUT_SECONDS = 60

// Held by the host, so the drawing redraws when a command is held or released.
const held = atom({ plugin: 'blast-radius', key: 'held' } as const, null as HeldCommand | null)

const MIGRATION =
  /\b(prisma\s+(migrate|db\s+push)|supabase\s+(db\s+(reset|push)|migration\s+up)|drizzle-kit\s+(push|migrate)|knex\s+migrate|sequelize(-cli)?\s+db:migrate|rails\s+db:(migrate|reset|drop)|alembic\s+(upgrade|downgrade)|typeorm\s+migration:run)\b/

type Risk = { risk: HeldCommand['risk']; cwd?: string; targets?: string[]; hasQuotes?: boolean }

export const register: Register = (on, options) => {
  // How long a held command waits for a press before it is cancelled; 0 waits forever.
  const timeoutSeconds = timeoutFrom(options.timeoutSeconds)
  // The press of a Button, by held command id.
  const decisions = new Map<string, 'proceed' | 'cancel'>()
  // The call holding the pane now. Checked and claimed in one step, so two waiting calls can't both take it.
  let holder: string | null = null

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const found = classify(e.command)
    if (!found) return next(e)

    // Nothing draws the session (a plain `claude -p` run): nobody can see the buttons, so refuse now.
    if ((await $.session.surfaces()).length === 0) {
      const { summary } = await measure($, found)
      return {
        deny:
          `blast-radius: cancelled this command because this session has no screen, so nobody can answer. ` +
          `It would have: ${summary}. Ask the user to run it themselves.`,
      }
    }

    // One command is held at a time; a second waits its turn (the first one's timeout bounds the wait).
    for (;;) {
      // The call ended while it waited its turn: leave the held one alone.
      if (next.signal.aborted) return { deny: 'blast-radius: held this command, but the call was stopped before it was shown.' }
      if (holder === null && (await read($, held)) === null && holder === null) break
      await $.process.run(['sleep', '0.25'])
    }
    holder = e.tool_use_id
    try {
      const measured = await measure($, found)
      const one: HeldCommand = {
        id: e.tool_use_id,
        command: e.command,
        risk: found.risk,
        ...measured,
        where: 'pane',
        secondsLeft: timeoutSeconds > 0 ? timeoutSeconds : null,
      }
      await update($, held, () => one)

      const opened = await $.ui.open({ id: PANE, title: 'Blast Radius', focus: true })
      if (!opened.isPlaced) {
        await update($, held, h => (h ? { ...h, where: 'band' as const } : h)) // too narrow for a pane: draw above the prompt
      }

      // Time spent inside $ calls doesn't count against the hook's time limit.
      // Nobody pressing within the timeout counts as Cancel, so an unattended session never stalls.
      const deadline = timeoutSeconds > 0 ? (await $.clock.now()) + timeoutSeconds * 1000 : null
      let isTimedOut = false
      while (!decisions.has(one.id) && !next.signal.aborted) {
        if (deadline !== null) {
          const left = Math.ceil((deadline - (await $.clock.now())) / 1000)
          if (left <= 0) {
            isTimedOut = !decisions.has(one.id) // a press that landed at the deadline still counts
            break
          }
          if (left !== one.secondsLeft) {
            one.secondsLeft = left
            await update($, held, h => (h && h.id === one.id ? { ...h, secondsLeft: left } : h))
          }
        }
        await $.process.run(['sleep', '0.25'])
      }
      const decision = isTimedOut ? 'cancel' : (decisions.get(one.id) ?? 'cancel')
      decisions.delete(one.id)
      await update($, held, () => null)
      await $.ui.close({ id: PANE })

      if (decision === 'proceed') return next(e) // runs as written
      if (isTimedOut) {
        return {
          deny:
            `blast-radius: held this command and nobody answered within ${timeoutSeconds} s, so it was cancelled. ` +
            `It would have: ${one.summary}. Don't retry it on your own: ask the user to run it, or run it again once they're back.`,
        }
      }
      return {
        deny: `blast-radius: the user pressed Cancel on this command. It would have: ${one.summary}.`,
      }
    } finally {
      holder = null
      // If the hold failed partway, don't leave its command blocking the next call.
      await update($, held, h => (h && h.id === e.tool_use_id ? null : h)).catch(() => {})
    }
  })

  // The hook's loop picks the press up.
  const decide = (id: string, decision: 'proceed' | 'cancel') => {
    decisions.set(id, decision)
  }

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const one = await read($, held)
    const { Text } = $.ui.resolve(e)
    if (!one) return <Text dimColor>Nothing held.</Text>
    return report($, e, one, decide)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const one = await read($, held)
    if (!one || one.where !== 'band' || e.props.hasSurvey) return next(e)
    return report($, e, one, decide) // a held command takes the whole band until answered
  })
}

function report(
  $: EngineInterface,
  e: Parameters<EngineInterface['ui']['resolve']>[0],
  one: HeldCommand,
  decide: (id: string, d: 'proceed' | 'cancel') => void,
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const label = { delete: 'Deletes files', 'force-push': 'Force push', migration: 'Database migration' }[one.risk]
  const shown = one.where === 'band' ? one.details.slice(0, 5) : one.details
  return (
    <Box flexDirection="column" paddingX={1}>
      <Text>
        <Text color="red" bold>{'⚠ Blast Radius held a command '}</Text>
        <Text dimColor>{`(${label})`}</Text>
      </Text>
      <Text color="yellow" wrap="truncate-end">{`$ ${one.command}`}</Text>
      <Text bold>{one.summary}</Text>
      {shown.map(line => (
        <Text dimColor wrap="truncate-end">{`  ${line}`}</Text>
      ))}
      {one.details.length > shown.length && <Text dimColor>{`  … ${one.details.length - shown.length} more`}</Text>}
      <Box flexDirection="row" gap={1}>
        <Button key="cancel" label="Cancel" hotkey="c" variant="primary" autoFocus onPress={() => decide(one.id, 'cancel')} />
        <Button key="proceed" label="Proceed" hotkey="y" onPress={() => decide(one.id, 'proceed')} />
        {one.secondsLeft != null && (
          <Text key="countdown" color={one.secondsLeft <= 10 ? 'yellow' : undefined} dimColor={one.secondsLeft > 10}>
            {`auto-cancels in ${one.secondsLeft} s`}
          </Text>
        )}
      </Box>
    </Box>
  )
}

// The timeoutSeconds option as whole seconds: a number or a numeric string, 0 to wait forever.
export function timeoutFrom(value: unknown): number {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return DEFAULT_TIMEOUT_SECONDS
  return Math.ceil(n) // a positive fraction stays a timeout, never 0 (wait forever)
}

// Which risky kind a command is, if any, looking at each part of a compound command.
export function classify(command: string): Risk | null {
  let cwd: string | undefined
  for (const part of command.split(/&&|\|\||;|\n/)) {
    const words = split(part.trim())
    if (words[0] === 'cd' && words[1]) cwd = words[1]
    const at = words.findIndex(w => w === 'rm')
    if (at !== -1 && (at === 0 || words[at - 1] === 'sudo')) {
      const args = words.slice(at + 1)
      const flags = args.filter(a => a.startsWith('-'))
      const isRecursive = flags.some(f => f === '--recursive' || (/^-[a-zA-Z]+$/.test(f) && /[rR]/.test(f)))
      // Quotes are gone after split: remember they were there, so '~' or '$HOME' are not expanded as if bare.
      if (isRecursive) return { risk: 'delete', cwd, targets: args.filter(a => !a.startsWith('-')), ...(/['"\\]/.test(command) ? { hasQuotes: true } : {}) }
    }
    if (words[0] === 'git' && words.includes('push') && words.some(w => w === '-f' || w.startsWith('--force') || /^\+/.test(w))) {
      return { risk: 'force-push', cwd }
    }
    if (MIGRATION.test(part)) return { risk: 'migration', cwd }
  }
  return null
}

// What the command would touch, from the tools' own commands.
// Paths the preview can't resolve without running the command: shell variables, command substitution, ~user.
const UNRESOLVED = /[$`]|^~[^/]/
const UNRESOLVED_QUOTED = /[$`~]/ // with quotes around, even ~ and $HOME are unknown

async function measure($: EngineInterface, found: Risk): Promise<Pick<HeldCommand, 'summary' | 'details'>> {
  // ~ and $HOME are expanded here; anything else with a variable is reported as unknown, never as "nothing".
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  // With quotes in the command we can't tell '~' (literal) from ~ (home): don't expand, report it instead.
  const expand = (p: string) => (home && !found.hasQuotes ? p.replace(/^~(?=\/|$)/, home).replace(/\$\{HOME\}|\$HOME\b/g, home) : p)
  const cwd = found.cwd ? expand(found.cwd) : undefined
  const unresolved = found.hasQuotes ? UNRESOLVED_QUOTED : UNRESOLVED
  const init = cwd && !unresolved.test(cwd) ? { cwd, timeoutMs: 10_000 } : { timeoutMs: 10_000 }
  try {
    if (found.risk === 'delete') {
      const targets = (found.targets ?? []).map(expand)
      const unknown = targets.filter(t => unresolved.test(t))
      if (unknown.length > 0 || (cwd !== undefined && unresolved.test(cwd))) {
        const list = unknown.length > 0 ? unknown : [`cd ${found.cwd}`]
        return { summary: `can't preview: ${list.length === 1 ? 'a path uses' : `${list.length} paths use`} a shell variable, check by hand`, details: list.slice(0, MAX_LISTED) }
      }
      // Unquoted $t expands globs, and nothing else, without running the command.
      const script =
        'shopt -s nullglob; for t in "$@"; do for p in $t; do [ -e "$p" ] || continue; ' +
        'echo "S $(du -sk "$p" | cut -f1)"; find "$p" -type f | head -n 5000 | sed "s/^/F /"; done; done'
      const r = await $.process.run(['bash', '-c', script, 'blast-radius', ...targets], init)
      const lines = r.stdout.split('\n')
      const files = lines.filter(l => l.startsWith('F ')).map(l => short(l.slice(2), targets))
      const kb = lines.filter(l => l.startsWith('S ')).reduce((sum, l) => sum + Number(l.slice(2)), 0)
      if (files.length === 0 && kb === 0) return { summary: 'delete nothing that exists right now', details: [] }
      return {
        summary: `delete ${files.length >= 5000 ? '5000+' : files.length} file${files.length === 1 ? '' : 's'} (${size(kb)})`,
        details: files.slice(0, MAX_LISTED),
      }
    }
    if (found.risk === 'force-push') {
      const lost = await $.process.run(['git', 'log', '--oneline', 'HEAD..@{u}'], init)
      const ahead = await $.process.run(['git', 'log', '--oneline', '@{u}..HEAD'], init)
      const gone = lost.stdout.split('\n').filter(Boolean)
      const added = ahead.stdout.split('\n').filter(Boolean)
      return {
        summary: `overwrite the remote branch: ${gone.length} remote commit${gone.length === 1 ? '' : 's'} lost, ${added.length} pushed (as of the last fetch)`,
        details: [...gone.map(c => `lost   ${c}`), ...added.map(c => `pushed ${c}`)].slice(0, MAX_LISTED),
      }
    }
    const status = await $.process.run(['git', 'status', '--porcelain'], init)
    const touched = status.stdout.split('\n').filter(l => /migrat|schema|prisma|supabase|drizzle/i.test(l))
    return {
      summary: 'change the database schema (not previewable here)',
      details: touched.map(l => `uncommitted ${l.trim()}`).slice(0, MAX_LISTED),
    }
  } catch {
    return { summary: `run a risky ${found.risk} command (could not measure it)`, details: [] }
  }
}

// Shell-like words: quotes kept together, the quotes themselves dropped.
function split(text: string) {
  return (text.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(w => w.replace(/^["']|["']$/g, ''))
}

// A path from the folder being deleted (build/chunk-1.js), not the whole path.
function short(file: string, targets: string[]) {
  for (const t of targets) {
    const base = t.replace(/\/+$/, '')
    const parent = base.includes('/') ? base.slice(0, base.lastIndexOf('/') + 1) : ''
    if (parent && file.startsWith(parent)) return file.slice(parent.length)
  }
  return file
}

function size(kb: number) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}
