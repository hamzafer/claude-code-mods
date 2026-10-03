// Next Steps: after each turn, 2 or 3 likely next prompts above the input.
// In an empty prompt, 1 to 3 drafts one (nothing sends on its own) and 0 dismisses.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextSteps } from '../types'

const MODEL = 'haiku'
const MAX_ITEMS = 3
const MAX_CHARS = 60
const MIN_ANSWER = 20 // a reply shorter than this is not worth a model call

// Held by the host, so the list survives a hot reload of this file.
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, null as NextSteps | null)
// Read by where-am-i: while this is true it leaves the "next" part to this mod.
const active = atom({ plugin: 'next-steps', key: 'active' } as const, false)

export const register: Register = on => {
  // The turn a suggestion may still be shown for. A submit or a new turn moves it on.
  let latest = ''
  let submits = 0

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await update($, active, () => true)
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    latest = `submit-${++submits}`
    await clear($)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    latest = e.turnId
    await clear($)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // a subagent's turn, not the person's
    if (latest !== '' && latest !== e.turnId) return r // a prompt typed during the turn is already queued
    latest = e.turnId // also after a hot reload, which forgets `latest`
    if (e.reason !== 'answer' || e.answer.trim().length < MIN_ANSWER) return r
    void suggest($, e.turnId, e.answer, () => latest).catch(() => {}) // in the background, so the turn ends at once
    return r
  })

  // A digit typed into an empty prompt picks a suggestion instead of landing as text.
  on('prompt.edit', async ($, e, next) => {
    if (e.text !== '' || e.start !== 0 || e.end !== 0 || !/^[0-9]$/.test(e.inputText)) return next(e)
    const s = await read($, steps)
    if (!s) return next(e)
    if (e.inputText === '0') {
      await update($, steps, () => null)
      return { text: '', cursor: 0 } // consumed: the box stays empty
    }
    const pick = s.items[Number(e.inputText) - 1]
    if (!pick) return next(e)
    return next({ ...e, inputText: pick }) // a draft: the person edits it or presses Enter
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    const s = await read($, steps)
    if (e.props.hasSurvey || e.props.isWorking || !s || s.items.length === 0) return rest

    const { Box, Text } = $.ui.resolve(e)
    const sep = <Text dimColor>{'  ·  '}</Text>
    const item = (text: string, i: number) => [
      <Text color="cyan" bold>{`${i + 1} `}</Text>,
      <Text>{text}</Text>,
    ]
    const dismiss = [<Text color="cyan" bold>{'0 '}</Text>, <Text dimColor>dismiss</Text>]

    const lines =
      fitsOnOneLine(s.items, e.props.bodyColumns) ? (
        <Text wrap="truncate-end">
          <Text dimColor>{'next:  '}</Text>
          {s.items.flatMap((t, i) => [...item(t, i), sep])}
          {dismiss}
        </Text>
      ) : (
        <Box flexDirection="column">
          {s.items.map((t, i) => (
            <Text wrap="truncate-end">
              <Text dimColor>{i === 0 ? 'next:  ' : '       '}</Text>
              {item(t, i)}
              {i === s.items.length - 1 && sep}
              {i === s.items.length - 1 && dismiss}
            </Text>
          ))}
        </Box>
      )

    return (
      <Box flexDirection="column">
        <Box paddingX={1}>{lines}</Box>
        {rest}
      </Box>
    )
  })
}

async function clear($: EngineInterface) {
  if (await read($, steps)) await update($, steps, () => null)
}

// The whole list on one row, or one suggestion per row when it would not fit.
export function fitsOnOneLine(items: string[], columns: number) {
  const width = 'next:  '.length + items.reduce((n, t) => n + 2 + t.length + 5, 0) + '0 dismiss'.length
  return width <= columns - 2 // the band's padding
}

async function suggest($: EngineInterface, turnId: string, answer: string, current: () => string) {
  // Wait for background agents: the main agent picks up again once they finish.
  const agents = await $.agent.list().catch(() => [])
  if (agents.some(a => a.status === 'running')) return

  const messages = (await $.session.messages().catch(() => [])).filter(m => m.text.trim() !== '').slice(-6)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 200,
    system:
      'You predict what a person will type next to their coding assistant, after reading a transcript of their session. ' +
      `Give 2 or 3 short, concrete follow-up prompts, each an instruction in the imperative, under ${MAX_CHARS} characters, ` +
      'specific to what just happened (name the file, test or feature). Plain words, no em dashes, no numbering, no quotes. ' +
      'One per line and nothing else. If the session is clearly finished or nothing sensible follows, reply with nothing.',
    prompt: [
      `<transcript>\n${messages.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`).join('\n')}\n</transcript>`,
      `<latest_reply>\n${answer.slice(0, 2000)}\n</latest_reply>`,
      'Write the follow-up prompts the person is likely to send next: the lines only, not a reply to the transcript.',
    ].join('\n\n'),
  })
  if (!r.isAnswered || current() !== turnId) return // a newer turn or a submit has moved on
  const items = parseSteps(r.text)
  await update($, steps, () => (items.length > 0 ? { turnId, items } : null))
}

// The model's lines, cleaned: no bullets or numbers, no em dashes, short, at most three.
export function parseSteps(text: string): string[] {
  let lines: string[]
  const trimmed = text.trim()
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed) as unknown
      lines = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      lines = trimmed.split('\n')
    }
  } else {
    lines = trimmed.split('\n')
  }
  const out: string[] = []
  for (const line of lines) {
    const clean = line
      .replace(/^\s*(?:[-*•]|\d+[.):]|\d+\s)\s*/, '')
      .replace(/^["'`]+|["'`]+$/g, '')
      .replace(/\s*\u2014\s*/g, ', ')
      .replace(/\.$/, '')
      .trim()
    if (clean === '' || clean.endsWith(':')) continue
    const short = clip(clean)
    if (!out.some(o => o.toLowerCase() === short.toLowerCase())) out.push(short)
    if (out.length === MAX_ITEMS) break
  }
  return out
}

// At most MAX_CHARS, cut at a word: the model does not always keep to the limit.
export function clip(text: string, max = MAX_CHARS) {
  if (text.length <= max) return text
  const cut = text.lastIndexOf(' ', max - 1)
  return `${text.slice(0, cut > 0 ? cut : max - 1)}…`
}
