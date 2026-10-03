// Where Am I: a live recap above the prompt (goal, now, waiting on you, next), plus /where.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Recap } from '../types'

const MODEL = 'haiku'
const MAX_LOG = 20

// Held by the host, so the recap survives a hot reload of this file.
const recap = atom({ plugin: 'where-am-i', key: 'recap' } as const, null as Recap | null)
const live = atom({ plugin: 'where-am-i', key: 'live' } as const, '')
// True while the next-steps mod shows its list of next prompts: this band leaves out its own next meanwhile.
const nextStepsActive = { plugin: 'next-steps', key: 'active' } as const

export const register: Register = on => {
  let prompt = ''
  let log: string[] = []

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'where', description: 'Recap the session so far in a few bullets' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    prompt = e.text.slice(0, 1500)
    log = []
    await update($, live, () => 'reading your message')
    return next(e)
  })

  // Observe only: note what is happening, then let the call run untouched.
  on('tool.call', async ($, e, next) => {
    const line = describe(e as unknown as Record<string, unknown>)
    log = [...log, e.agentId ? `(agent) ${line}` : line].slice(-MAX_LOG)
    if (!e.agentId) await update($, live, () => line)
    const r = await next(e)
    return r
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      await update($, live, () => '')
      void summarize($, prompt, log, e.answer).catch(() => {}) // in the background, so the turn ends at once
    }
    return r
  })

  on('command.run', { command: 'where' }, async $ => ({ text: await longRecap($, prompt, log) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const r = await read($, recap)
    if (e.props.hasSurvey || !r) return rest

    const { Box, Text } = $.ui.resolve(e)
    const now = clip((await read($, live)) || r.now)
    const { value: hasNextSteps = false } = await $.state.get(nextStepsActive)
    const nextStep = hasNextSteps ? '' : r.next

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" paddingX={1}>
          <Text wrap="truncate-end">
            <Text color="cyan" bold>{'◆ Goal: '}</Text>
            <Text>{clip(r.goal)}</Text>
          </Text>
          <Text wrap="truncate-end">
            <Text dimColor>{'  now: '}</Text>
            <Text>{now}</Text>
            {nextStep !== '' && <Text dimColor>{'  ·  next: '}</Text>}
            {nextStep !== '' && <Text>{clip(nextStep)}</Text>}
          </Text>
          {r.waiting !== '' && (
            <Text color="yellow" wrap="truncate-end">{`  waiting on you: ${clip(r.waiting)}`}</Text>
          )}
        </Box>
        {rest}
      </Box>
    )
  })
}

// A short label for one tool call: what a person would say Claude is doing.
export function describe(e: Record<string, unknown>): string {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const file = (p: string) => p.split('/').slice(-2).join('/')
  if (tool === 'Bash') return `running ${s('description') || s('command').slice(0, 60)}`
  if (tool === 'Edit' || tool === 'Write') return `editing ${file(s('file_path'))}`
  if (tool === 'Read') return `reading ${file(s('file_path'))}`
  if (tool === 'Grep' || tool === 'Glob') return `searching for ${s('pattern').slice(0, 40)}`
  if (tool === 'Agent') return `starting an agent: ${s('description')}`
  if (tool === 'AskUserQuestion') return 'asking you a question'
  if (tool.startsWith('mcp__')) return `using ${tool.split('__').slice(1).join(' ')}`
  return `using ${tool}`
}

async function summarize($: EngineInterface, prompt: string, log: string[], answer: string) {
  const before = await read($, recap)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 300,
    system:
      'You keep a one-glance recap of a coding session for someone with ADHD. Plain words, no em dashes, ' +
      'each field at most 70 characters. Reply with JSON only: {"goal","now","waiting","next"}. ' +
      '"goal": the overall aim of the session (keep the previous goal unless it clearly changed). ' +
      '"now": what was just done. "waiting": what the assistant is waiting on from the person, or "". ' +
      '"next": the next step.',
    prompt: [
      `Previous recap: ${before ? JSON.stringify(before) : 'none'}`,
      `The person's latest message: ${prompt}`,
      `Tools used this turn: ${log.join('; ') || 'none'}`,
      `The assistant's reply: ${answer.slice(0, 2500)}`,
    ].join('\n\n'),
  })
  if (!r.isAnswered) return
  const parsed = parseRecap(r.text)
  if (parsed) await update($, recap, () => parsed)
}

async function longRecap($: EngineInterface, prompt: string, log: string[]) {
  const messages = (await $.session.messages()).slice(-12)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 500,
    system:
      'Write a recap of this coding session for someone who lost track. Plain words, no em dashes. ' +
      'At most 6 short bullets: the goal, what is done, what is happening now, what is waiting on them, the next step.',
    prompt: [
      `<transcript>\n${messages.filter(m => m.text.trim() !== '').map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`).join('\n')}\n</transcript>`,
      `Latest message: ${prompt}`,
      `Recent tool calls: ${log.join('; ') || 'none'}`,
      'Write the recap of the transcript above now: the bullets only, not a reply to it.',
    ].join('\n\n'),
  })
  return r.isAnswered ? r.text : 'Could not build a recap right now.'
}

// At most 70 characters, cut at a word: the model does not always keep to the limit.
export function clip(text: string, max = 70) {
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text // one sentence
  if (first.length <= max) return first.replace(/\.$/, '')
  return `${first.slice(0, first.lastIndexOf(' ', max - 1))}…`
}

// The model's JSON, tolerating a code fence around it.
export function parseRecap(text: string): Recap | null {
  const body = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    const o = JSON.parse(body) as Record<string, unknown>
    const field = (k: string) => (typeof o[k] === 'string' ? clip((o[k] as string).replace(/\s*—\s*/g, ', ').trim()) : '')
    if (!field('goal')) return null
    return { goal: field('goal'), now: field('now'), waiting: field('waiting'), next: field('next') }
  } catch {
    return null
  }
}
