// Replay Theater: step through the last turn's file edits, one diff at a time.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReplayStep } from '../types'

const PANE = 'replay-theater'
const MAX_DIFF_LINES = 400

// Held by the host, so a replay survives a hot reload of this file.
const replay = atom({ plugin: 'replay-theater', key: 'replay' } as const, [] as ReplayStep[])
const pos = atom({ plugin: 'replay-theater', key: 'pos' } as const, 0)

export const register: Register = on => {
  let pending: ReplayStep[] = []
  let cwd = ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    cwd = e.cwd
    await $.command.register({ name: 'replay', description: "Step through the last turn's file edits" }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    return r
  })

  on('turn.start', ($, e, next) => {
    pending = [] // a model turn begins: start a fresh replay
    return next(e)
  })

  // Observe only: the edit runs untouched.
  on('tool.call', { tool: 'Edit' }, async ($, e, next) => {
    const r = await next(e)
    if (!r.deny && !r.isError) {
      pending.push({ file: e.file_path, kind: 'edit', before: e.old_string, after: e.new_string })
    }
    return r
  })

  on('tool.call', { tool: 'Write' }, async ($, e, next) => {
    const before = await $.fs.read(e.file_path).catch(() => '') // read just before the write lands
    const r = await next(e)
    if (!r.deny && !r.isError) {
      pending.push({ file: e.file_path, kind: 'write', before, after: e.content })
    }
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && pending.length > 0) {
      const steps = pending
      pending = []
      await update($, replay, () => steps) // one replay per turn
      await update($, pos, () => 0)
      $.ui.toast(`replay-theater: ${steps.length} edit${steps.length === 1 ? '' : 's'} last turn. Run /replay`)
    }
    return r
  })

  on('command.run', { command: 'replay' }, async $ => ({
    text: (await openReplay($)) ? 'Replaying the last turn' : 'No edits to replay yet',
  }))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const steps = await read($, replay)
    const at = Math.min(await read($, pos), Math.max(0, steps.length - 1))
    const step = steps[at]

    if (!step) {
      return (
        <Box flexDirection="column">
          <Text dimColor>No edits to replay yet.</Text>
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      )
    }

    const width = Math.max(20, e.props.bodyColumns - 2)
    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{`Step ${at + 1}/${steps.length} `}</Text>
          <Text dimColor>{`${step.kind === 'write' ? 'write' : 'edit'} `}</Text>
          <Text color="cyan">{relative(step.file, cwd)}</Text>
        </Text>
        <Text>
          {steps.map((_, i) => (
            <Text color={i === at ? 'cyan' : undefined} bold={i === at} dimColor={i !== at}>
              {i === at ? `[${i + 1}]` : ` ${i + 1} `}
            </Text>
          ))}
        </Text>
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="Prev" hotkey="p" onPress={() => update($, pos, p => Math.max(0, p - 1))} />
          <Button key="next" label="Next" hotkey="n" variant="primary" onPress={() => update($, pos, p => Math.min(steps.length - 1, p + 1))} />
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor>{'─'.repeat(width)}</Text>
        {diffLines(step).map(line => (
          <Text color={line.sign === '+' ? 'green' : line.sign === '-' ? 'red' : undefined} dimColor={line.sign === ' '} wrap="truncate-end">
            {`${line.sign} ${line.text}`}
          </Text>
        ))}
      </Box>
    )
  })
}

async function openReplay($: EngineInterface) {
  if ((await read($, replay)).length === 0) return false
  await update($, pos, () => 0)
  await $.ui.open({ id: PANE, title: 'Replay Theater', focus: true })
  return true
}

type DiffLine = { sign: '+' | '-' | ' '; text: string }

// A line diff (LCS) of the step's before and after text, capped for large files.
export function diffLines(step: ReplayStep): DiffLine[] {
  const a = lines(step.before)
  const b = lines(step.after)
  if (a.length + b.length > MAX_DIFF_LINES * 2) {
    return [{ sign: ' ', text: `(large change: ${a.length} → ${b.length} lines, diff not drawn)` }]
  }
  const n = a.length
  const m = b.length
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!)
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ sign: ' ', text: a[i]! })
      i++
      j++
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      out.push({ sign: '-', text: a[i++]! })
    } else {
      out.push({ sign: '+', text: b[j++]! })
    }
  }
  while (i < n) out.push({ sign: '-', text: a[i++]! })
  while (j < m) out.push({ sign: '+', text: b[j++]! })
  return out
}

// A file's lines, without the empty one after a trailing newline.
function lines(text: string) {
  return text === '' ? [] : text.replace(/\n$/, '').split('\n')
}

// The path from the working directory, or its last two parts when it is outside.
function relative(file: string, cwd: string) {
  if (cwd && file.startsWith(`${cwd}/`)) return file.slice(cwd.length + 1)
  const parts = file.split('/')
  return parts.length > 3 ? `…/${parts.slice(-2).join('/')}` : file
}
