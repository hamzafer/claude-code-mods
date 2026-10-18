// Agent Radar: what are my subagents and background commands cooking?
//   The band above the prompt has one live line per running subagent or background Bash
//   command: status, time and what it is doing right now; a finished one shows a check for
//   30 s. A toast says when each finishes. /radar opens a pane with every one of them: a
//   subagent's messages, a command's output tail.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { RadarAgent } from '../types'
import { bandsFile, parseOrder, stackBands } from './bands'
import { TAILS_SH, baseName, blocks, clean, outputPathOf, parseOpen, shellLabel, tailLines } from './watch'

const PANE = 'agent-radar'
const SHOW_DONE_MS = 30_000 // a finished agent stays in the band this long
const BAND_ROWS = 4
const POLL_MS = 5_000
const MISSES_TO_FINISH = 2 // polls that find a shell's output file closed before it counts as over
const UNSEEN_MIN_MS = 15_000 // a shell never seen open is over only after this long and the misses
const LIMIT = 40

// Held by the host, so the radar survives a hot reload of this file.
const agents = atom({ plugin: 'agent-radar', key: 'agents' } as const, [] as RadarAgent[])
const selected = atom({ plugin: 'agent-radar', key: 'selected' } as const, null as string | null)
const now = atom({ plugin: 'agent-radar', key: 'now' } as const, 0)

let bandOrder: Promise<string[]> | undefined // read once per session: restart to apply
let isPolling = false // a slow lsof must not let two polls overlap
let lsofBin: string | null | undefined // undefined: not tried yet; null: none works

export const register: Register = on => {
  let timers: Timer[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'radar', description: 'Show what each subagent and background command is doing, in the Agent Radar pane' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    for (const t of timers) t.cancel()
    timers = []
    // A clock for the elapsed times, ticking only while something runs.
    timers.push(
      $.clock.every(1000, () => {
        void (async () => {
          // A few seconds past the 30 s too, so the redraw that drops a finished line happens.
          if ((await read($, agents)).some(a => isShown(a, Date.now() - 3_000))) await update($, now, () => Date.now())
        })().catch(() => {})
      }),
    )
    timers.push($.clock.every(POLL_MS, () => void poll($).catch(() => {})))
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (r.agentId) {
      const id = r.agentId
      const one: RadarAgent = { id, kind: 'agent', description: e.description || e.name || e.subagentType, type: e.subagentType, status: 'running', startedAt: Date.now(), tools: 0, last: 'starting' }
      await update($, agents, list => [one, ...list.filter(a => a.id !== id)].slice(0, 30))
    }
    return r
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const id = e.agentId
      const line = describe(e as unknown as Record<string, unknown>)
      await update($, agents, list => list.map(a => (a.id === id ? { ...a, tools: a.tools + 1, last: line } : a)))
    }
    return next(e)
  })

  // A background Bash command: a line until its output file is no longer open.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    if (r.deny || r.isError) return r
    const result = r.result as { backgroundTaskId?: string; backgroundOutputPath?: string } | undefined
    if (!e.run_in_background && !result?.backgroundTaskId) return r // it ran in the foreground (or Ctrl+B / a timeout moved it)
    const out = outputPathOf(r.text, result)
    if (!out) return r // no output file, no way to tell when it ends: better no line than a stuck one
    const command = e.command
    const { label, detail } = shellLabel(command, e.description)
    const id = `sh:${baseName(out)}`
    const one: RadarAgent = { id, kind: 'shell', description: label, type: 'shell', status: 'running', startedAt: Date.now(), tools: 0, last: 'running', command, detail, out, misses: 0 }
    await update($, agents, list => [one, ...list.filter(a => a.id !== id)].slice(0, LIMIT))
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      const id = e.agentId
      const failed = e.reason === 'error' || e.reason === 'aborted'
      const list = await update($, agents, all =>
        all.map(a => (a.id === id ? { ...a, status: failed ? 'failed' : 'done', endedAt: Date.now(), last: failed ? `stopped: ${e.reason}` : 'finished' } : a)),
      )
      const one = list.find(a => a.id === id)
      if (one) $.ui.toast(`${failed ? '✗' : '✓'} ${one.description} ${failed ? 'failed' : 'done'} (${elapsed(one)} · ${one.tools} tools)`)
    }
    return r
  })

  on('command.run', { command: 'radar' }, async $ => {
    await adopt($)
    await update($, selected, () => null)
    await $.ui.open({ id: PANE, title: 'Agent Radar', focus: true })
    const list = await read($, agents)
    const running = list.filter(a => a.status === 'running').length
    return { text: `${running} running, ${list.length - running} finished` }
  })

  // The band: one live line per running subagent or command, and a ✓ for 30 s once one finishes.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    await read($, now) // subscribes the band to the clock
    const shown = (await read($, agents)).filter(a => isShown(a))
    if (e.props.hasSurvey || shown.length === 0) return rest
    const { Box, Text } = $.ui.resolve(e)
    const mine = (
      <Box flexDirection="column">
        {shown.slice(0, BAND_ROWS).map(a => (
          <Text wrap="truncate-end">
            <Text color={color(a)} bold>{` ${icon(a)} ${a.description}`}</Text>
            <Text dimColor>{`  ${tag(a)} ${elapsed(a)}${kindOf(a) === 'agent' ? ` · ${a.tools} tools` : ''}`}</Text>
            {a.status === 'running' && <Text>{` · ${a.last}`}</Text>}
            {a.status === 'failed' && <Text color="red">{` · ${a.last}`}</Text>}
          </Text>
        ))}
        {shown.length > BAND_ROWS && <Text dimColor>{`   +${shown.length - BAND_ROWS} more · /radar`}</Text>}
      </Box>
    )
    return stackBands(rest, 'agent-radar', mine, 'above', await (bandOrder ??= readBandOrder($).catch(() => []))) // above what other mods draw, unless the band order says otherwise
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    await read($, now) // subscribes the pane to the clock
    const list = await read($, agents)
    const pick = await read($, selected)
    const one = list.find(a => a.id === pick)

    if (one && kindOf(one) === 'shell') {
      const lines = one.lines ?? []
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={color(one)} bold>{`${icon(one)} ${one.description}`}</Text>
            <Text dimColor>{`  shell · ${elapsed(one)} · ${one.status}`}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">{`$ ${clean(one.command ?? '').replace(/\s+/g, ' ').slice(0, 300)}`}</Text>
          {one.out && <Text dimColor wrap="truncate-end">{`output: ${clean(one.out)}`}</Text>}
          <Text dimColor>{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
          {lines.length === 0 && <Text dimColor>No output yet.</Text>}
          {lines.map(l => (
            <Text wrap="truncate-end">{l}</Text>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="Back" hotkey="b" variant="primary" onPress={() => update($, selected, () => null)} />
            <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    if (one) {
      const found = await $.session.messages({ agentId: one.id })
      const messages = 'deny' in found ? [] : found.slice(-6)
      return (
        <Box flexDirection="column">
          <Text>
            <Text color={color(one)} bold>{`${icon(one)} ${one.description}`}</Text>
            <Text dimColor>{`  ${one.type} · ${elapsed(one)} · ${one.tools} tools`}</Text>
          </Text>
          <Text dimColor wrap="truncate-end">{`now: ${one.last}`}</Text>
          <Text dimColor>{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
          {messages.length === 0 && <Text dimColor>No messages yet.</Text>}
          {messages.map(m => (
            <Text wrap="truncate-end">
              <Text color={m.role === 'assistant' ? 'cyan' : undefined} bold>{m.role === 'assistant' ? 'agent: ' : 'task:  '}</Text>
              <Text>{m.text.replace(/\s+/g, ' ').slice(0, 400) || '(tool calls)'}</Text>
            </Text>
          ))}
          <Box flexDirection="row" gap={1}>
            <Button key="back" label="Back" hotkey="b" variant="primary" onPress={() => update($, selected, () => null)} />
            <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
          </Box>
        </Box>
      )
    }

    const running = list.filter(a => a.status === 'running').length
    return (
      <Box flexDirection="column">
        <Text bold>{`${running} running · ${list.length - running} finished`}</Text>
        {list.length === 0 && <Text dimColor>No subagents or background commands yet this session.</Text>}
        {list.slice(0, 9).map((a, i) => (
          <Button
            key={`agent-${a.id}`}
            plain
            hotkey={String(i + 1)}
            dimColor={a.status !== 'running'}
            label={`${icon(a)} ${a.description} · ${tag(a)} · ${elapsed(a)}${kindOf(a) === 'agent' ? ` · ${a.tools} tools` : ''}${a.status === 'done' ? '' : ` · ${a.last}`}`}
            onPress={() => update($, selected, () => a.id)}
          />
        ))}
        {list.length > 9 && <Text dimColor>{`… ${list.length - 9} older`}</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="clear" label="Clear finished" hotkey="c" onPress={() => update($, agents, all => all.filter(x => x.status === 'running'))} />
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

// The band order file, as the claude-code-mods checklist saves it; [] on any error.
async function readBandOrder($: EngineInterface): Promise<string[]> {
  const file = bandsFile(await $.env.get('CLAUDE_CONFIG_DIR'), await $.env.get('HOME'))
  return file && (await $.fs.exists(file)) ? parseOrder(await $.fs.read(file)) : []
}

// Forgets the cached band order, for tests.
export function resetBandOrder() {
  bandOrder = undefined
  lsofBin = undefined
  isPolling = false
}

// Agents that started before this mod loaded: take them from the engine's own list.
async function adopt($: EngineInterface) {
  const known = new Set((await read($, agents)).map(a => a.id))
  const fresh = (await $.agent.list())
    .filter(a => !known.has(a.id))
    .map((a): RadarAgent => ({
      id: a.id,
      kind: 'agent',
      description: a.description,
      type: a.type,
      status: a.status === 'running' ? 'running' : a.status === 'completed' ? 'done' : 'failed',
      startedAt: Date.now(),
      tools: 0,
      last: a.status === 'running' ? 'running (started before the radar)' : a.status,
    }))
  if (fresh.length > 0) await update($, agents, list => [...list, ...fresh])
}

// ---------------------------------------------------------------- the poll: background commands

async function poll($: EngineInterface) {
  if (isPolling) return
  isPolling = true
  try {
    await pollOnce($)
  } finally {
    isPolling = false
  }
}

async function pollOnce($: EngineInterface) {
  // 1. Which running shells still hold their output file open (one lsof for all of them).
  const list = await read($, agents)
  const shells = list.filter(a => kindOf(a) === 'shell' && a.status === 'running' && a.out)
  if (shells.length === 0) return
  const open = await openFiles($, shells.map(a => a.out!))

  // 2. The tails of their output (one process).
  const tailOf = new Map<string, string>()
  const t = await $.process.run(['sh', '-c', TAILS_SH, 'sh', ...new Set(shells.map(a => a.out!))], { timeoutMs: 8_000 }).catch(() => null)
  if (t && t.exitCode === 0) for (const b of blocks(t.stdout)) tailOf.set(b.path, b.body)

  // 3. Apply: lines and last for each, then the shells that closed twice in a row are over.
  const finished: string[] = []
  await update($, agents, all =>
    all.map(a => {
      if (kindOf(a) !== 'shell' || a.status !== 'running' || !a.out) return a
      const lines = tailOf.has(a.out) ? tailLines(tailOf.get(a.out)!) : a.lines
      const last = lines?.at(-1) ?? a.last
      if (!open) return { ...a, lines, last }
      if (open.has(baseName(a.out))) return { ...a, lines, last, seen: true, misses: 0 }
      const misses = (a.misses ?? 0) + 1
      if (misses >= MISSES_TO_FINISH && (a.seen || Date.now() - a.startedAt >= UNSEEN_MIN_MS)) {
        finished.push(a.id)
        return { ...a, lines, last: last === 'running' ? 'finished' : last, misses, status: 'done', endedAt: Date.now() }
      }
      return { ...a, lines, last, misses }
    }),
  )
  for (const id of finished) {
    const one = (await read($, agents)).find(a => a.id === id)
    if (one) $.ui.toast(`✓ ${one.description} done (${elapsed(one)})`)
  }
}

// Which of these files some process holds open: one `lsof -Fn` for all. Undefined when lsof cannot say
// (not installed, failed, timed out): nothing is guessed done.
async function openFiles($: EngineInterface, files: string[]): Promise<Set<string> | undefined> {
  if (lsofBin === null) return undefined
  for (const bin of lsofBin ? [lsofBin] : ['/usr/sbin/lsof', 'lsof']) {
    const r = await $.process.run([bin, '-Fn', '--', ...files], { timeoutMs: 8_000 }).catch(() => null)
    if (!r) continue // would not start (or timed out): try the next one
    lsofBin = bin
    return r.exitCode === 0 || r.exitCode === 1 ? parseOpen(r.stdout) : undefined // 1: none of them open
  }
  if (lsofBin === undefined) lsofBin = null
  return undefined
}

// ---------------------------------------------------------------- display helpers

function kindOf(a: Pick<RadarAgent, 'kind'>) {
  return a.kind ?? 'agent'
}

function tag(a: Pick<RadarAgent, 'kind'>) {
  return kindOf(a) === 'agent' ? 'sub' : 'sh'
}

// Running, or finished in the last 30 s.
export function isShown(a: RadarAgent, at = Date.now()) {
  return a.status === 'running' || (a.endedAt !== undefined && at - a.endedAt < SHOW_DONE_MS)
}

function icon(a: RadarAgent) {
  return a.status === 'running' ? '●' : a.status === 'done' ? '✓' : '✗'
}

function color(a: RadarAgent) {
  return a.status === 'running' ? 'yellow' : a.status === 'done' ? 'green' : 'red'
}

export function elapsed(a: Pick<RadarAgent, 'startedAt' | 'endedAt'>, at = Date.now()) {
  const s = Math.max(0, Math.round(((a.endedAt ?? at) - a.startedAt) / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

// A short label for one tool call: what a person would say the agent is doing.
export function describe(e: Record<string, unknown>): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const file = (p: string) => p.split('/').slice(-2).join('/')
  if (tool === 'Bash') return `running ${s('description') || s('command').slice(0, 50)}`
  if (tool === 'Edit' || tool === 'Write') return `editing ${file(s('file_path'))}`
  if (tool === 'Read') return `reading ${file(s('file_path'))}`
  if (tool === 'Grep' || tool === 'Glob') return `searching ${s('pattern').slice(0, 30)}`
  if (tool.includes('playwright')) return `browser: ${tool.split('__').pop()?.replace(/^browser_/, '')}`
  if (tool.startsWith('mcp__')) return `using ${tool.split('__').slice(1).join(' ')}`
  return `using ${tool}`
}
