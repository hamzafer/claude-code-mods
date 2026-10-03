// Next Steps: after each turn, 2 or 3 likely next prompts above the input.
// In an empty prompt, 1 to 3 drafts one (nothing sends on its own) and 0 dismisses.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextSteps } from '../types'

const MODEL = 'haiku'
const MAX_ITEMS = 3
const MAX_CHARS = 60 // what the model is asked for
const MAX_KEPT = 120 // a longer line is dropped, never cut: a cut draft would send half a prompt
const MIN_ANSWER = 20 // a reply shorter than this is not worth a model call

// Held by the host, so the list survives a hot reload of this file.
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, null as NextSteps | null)
// True while the list is on screen. where-am-i reads it and leaves out its own "next" meanwhile.
const active = atom({ plugin: 'next-steps', key: 'active' } as const, false)

export const register: Register = on => {
  // The turn a suggestion may still be shown for. A submit or a new turn moves it on.
  let latest = ''
  let submits = 0
  // A survey answers bare digits in the band: leave them to it.
  let hasSurvey = false

  on('prompt.submit', async ($, e, next) => {
    latest = `submit-${++submits}`
    await setSteps($, () => null)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    latest = e.turnId
    await setSteps($, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // a subagent's turn, not the person's
    latest = e.turnId // also for a turn that raised no turn.start, and after a hot reload
    if (e.reason !== 'answer' || e.answer.trim().length < MIN_ANSWER) return r
    void suggest($, e.turnId, e.answer, () => latest).catch(() => {}) // in the background, so the turn ends at once
    return r
  })

  // A digit typed into an empty prompt picks a suggestion instead of landing as text.
  // A paste carries no key, so a pasted "1" lands as typed.
  on('prompt.edit', async ($, e, next) => {
    if (hasSurvey || !e.key || e.key.ctrl || e.key.meta || e.text !== '' || e.start !== 0 || e.end !== 0 || !/^[0-9]$/.test(e.inputText)) return next(e)
    const s = await read($, steps)
    if (!s) return next(e)
    if (e.inputText === '0') {
      await setSteps($, () => null)
      return { text: '', cursor: 0 } // consumed: the box stays empty
    }
    const pick = s.items[Number(e.inputText) - 1]
    if (!pick) return next(e)
    return next({ ...e, inputText: pick }) // a draft: the person edits it or presses Enter
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    hasSurvey = e.props.hasSurvey
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
      // One per row needs a row each; a short band gets the one row, cut at its end.
      fitsOnOneLine(s.items, e.props.bodyColumns) || e.props.maxRows < s.items.length + 2 ? (
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

// Writes the list, then whether it shows, for where-am-i.
async function setSteps($: EngineInterface, fn: (before: NextSteps | null) => NextSteps | null) {
  const after = await update($, steps, fn)
  const showing = after !== null && after.items.length > 0
  if ((await read($, active)) !== showing) await update($, active, () => showing)
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

  const all = (await $.session.messages().catch(() => [])).filter(m => m.text.trim() !== '')
  if (all.at(-1)?.role === 'assistant') all.pop() // the latest reply goes in on its own below
  const messages = all.slice(-6)
  const r = await $.model.complete({
    model: MODEL,
    maxTokens: 200,
    timeoutMs: 20_000,
    system:
      'You predict what a person will type next to their coding assistant, after reading a transcript of their session. ' +
      `Give 2 or 3 short, concrete follow-up prompts, each an instruction in the imperative, under ${MAX_CHARS} characters, ` +
      'specific to what just happened (name the file, test or feature). Plain words, no em dashes, no numbering, no quotes. ' +
      'One per line and nothing else. If nothing sensible follows, reply with the single word NONE.\n' +
      'Example reply:\nRun the login tests again\nAdd the same check to signup.ts\nOpen a draft PR',
    prompt: [
      `<transcript>\n${messages.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, 800)}`).join('\n')}\n</transcript>`,
      `<latest_reply>\n${answer.slice(0, 2000)}\n</latest_reply>`,
      'Write the follow-up prompts the person is likely to send next: the lines only, not a reply to the transcript.',
    ].join('\n\n'),
  })
  if (!r.isAnswered) return
  const items = parseSteps(r.text)
  // Checked inside the write, so a submit or a new turn that lands meanwhile always wins.
  await setSteps($, before => (current() !== turnId ? before : items.length > 0 ? { turnId, items } : null))
}

// The model's lines, cleaned: no fences, bullets, numbers or em dashes; at most three.
// A preamble, a "nothing to add" or a line too long to draft whole is dropped.
export function parseSteps(text: string): string[] {
  const body = text.replace(/```[a-z]*\n?/gi, '').trim()
  let lines = body.split('\n')
  if (body.startsWith('[') || body.startsWith('{')) {
    try {
      const o = JSON.parse(body) as unknown
      const arr = Array.isArray(o) ? o : Object.values(o as Record<string, unknown>).find(Array.isArray)
      lines = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : []
    } catch {
      // not JSON after all: read it as lines
    }
  }
  const out: string[] = []
  for (const line of lines) {
    const clean = line
      .replace(/\*\*/g, '')
      .replace(/^\s*(?:[-*•]|\d+[.):])\s*/, '')
      .replace(/^["'`]+|["'`,]+$/g, '')
      .replace(/\s*\u2014\s*/g, ', ')
      .replace(/\.$/, '')
      .trim()
    if (clean === '' || clean.endsWith(':') || clean.length > MAX_KEPT) continue
    if (/^(none|no |nothing|here are|here's|sure)/i.test(clean) || /^[[\]{}]$/.test(clean)) continue
    if (!out.some(o => o.toLowerCase() === clean.toLowerCase())) out.push(clean)
    if (out.length === MAX_ITEMS) break
  }
  return out
}
