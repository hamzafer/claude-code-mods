// The routing brain, kept free of the engine so tests can call it directly:
// the model ladders and styles, each picker's request and answer, and the cost of a run.
import type { Tier, Usage } from '../types'

// The models a picker may choose between, cheapest first. A ladder is a setting.
export type Ladder = 'haiku-sonnet-opus' | 'sonnet-opus-fable'
export const LADDERS: Record<Ladder, readonly Tier[]> = {
  'haiku-sonnet-opus': ['haiku', 'sonnet', 'opus'],
  'sonnet-opus-fable': ['sonnet', 'opus', 'fable'],
}

// How a picker weighs cost against quality, a setting too: the question it answers and what each
// model is for. "quality" was tuned against one developer's own model choices (see docs/mods.md).
export type Style = 'saver' | 'quality'
const QUESTION: Record<Style, string> = {
  saver: 'A coding agent is about to hand this task to a subagent. Which model is the cheapest one that will still do the task well?',
  quality: 'Which model would this developer pick for this subagent? They pay for quality on anything they will rely on, and use the cheaper model for routine execution.',
}
const DESCRIBE: Record<Style, Record<Ladder, Partial<Record<Tier, string>>>> = {
  saver: {
    'haiku-sonnet-opus': {
      haiku: 'Lookups and light work: searching or listing files, reading and summarizing code or docs, answering a factual question about the repo, small mechanical edits.',
      sonnet: 'Everyday coding: implementing a feature, fixing an ordinary bug, writing or updating tests, reviewing a diff, editing a few files.',
      opus: 'Hard thinking: planning or architecture, debugging a subtle or intermittent issue, security review, large multi-file refactors, work where a wrong answer is costly.',
    },
    'sonnet-opus-fable': {
      sonnet: 'Everything routine: lookups, reading, summarizing, research, ordinary coding, tests, reviews and verification of ordinary diffs, docs, small refactors, ordinary bug fixes.',
      opus: 'Hard thinking: planning and architecture, subtle or intermittent bugs, security reviews, large multi-file refactors, work where a wrong answer is costly.',
      fable: 'The hardest few: long-horizon autonomous work running for hours, novel research-grade problems, or the highest-stakes calls where even Opus is likely to fall short. Costs 2.5x Opus, so only when clearly needed.',
    },
  },
  quality: {
    'haiku-sonnet-opus': {
      haiku: 'Only trivial lookups: listing or finding files, reading one file, a quick factual check.',
      sonnet: 'Routine execution: implementing or fixing something whose plan is already decided, routine ops and maintenance, searches and summaries, the standard pre-merge review of a pull request, and verifying that review fixes were applied.',
      opus: 'Anything the developer will rely on: audits and quality checks of finished work, independent or fresh-eyes reviews, extra code reviews and regression hunts, planning, design and idea generation, building a new feature end to end on its own, and high-stakes or security-sensitive work.',
    },
    'sonnet-opus-fable': {
      sonnet: 'Routine execution: implementing or fixing something whose plan is already decided, routine ops and maintenance (servers, disk, configs, sweeps, CI chores), lookups, searches and summaries, the standard pre-merge review of a pull request, and verifying that review fixes were applied.',
      opus: 'Anything the developer will rely on: audits and quality checks of finished work (papers, docs, figures, numbers, references), independent or fresh-eyes reviews, code reviews and regression hunts asked for on top of the standard one, planning, design and idea generation, building a new feature end to end on its own, and high-stakes or security-sensitive work.',
      fable: 'Rare: long autonomous runs left alone for hours, or research-grade problems where even Opus is likely to fall short.',
    },
  },
}

// API prices in USD per million tokens, as published on 2026-09-25. Estimates, not plan charges.
export const PRICES_AS_OF = '2026-09-25'
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number }[] = [
  { match: /haiku/i, input: 1, output: 5, cacheRead: 0.1 },
  { match: /sonnet/i, input: 2, output: 10, cacheRead: 0.2 },
  { match: /opus/i, input: 4, output: 20, cacheRead: 0.2 },
  { match: /fable|mythos/i, input: 10, output: 50, cacheRead: 0.25 },
]
// Who picks: Jev, from TypeSafe itself or through Vercel AI Gateway, or OpenAI's Decisions API.
export type Via = 'typesafe' | 'gateway' | 'openai'
export const PICK_URL: Record<Via, string> = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  gateway: 'https://ai-gateway.vercel.sh/v1/evaluate',
  openai: 'https://api.openai.com/v1/decisions',
}
export const PICKER_NAME: Record<Via, 'Jev' | 'OpenAI'> = { typesafe: 'Jev', gateway: 'Jev', openai: 'OpenAI' }
// Input tokens only; none of them bill output.
const USD_PER_TOKEN: Record<Via, number> = { typesafe: 0.042 / 1_000_000, gateway: 0.042 / 1_000_000, openai: 0.1 / 1_000_000 }

// Only the agent type and its short label go out: never the task text, which can hold code,
// paths, hostnames or a pasted key.
type Task = { subagentType: string; description: string }
type Ask = { ladder: Ladder; style: Style; zeroRetention?: boolean }
function stateOf(input: Task) {
  return { agent_type: input.subagentType, description: input.description }
}

// The body of one pick: the label, and one choice over the ladder, in each API's own shape.
// Through the gateway, only TypeSafe may serve it; zero data retention is opt-in, since the
// gateway refuses it below the Pro plan.
export function pickRequest(input: Task, via: Via, ask: Ask) {
  const tiers = LADDERS[ask.ladder]
  const describe = DESCRIBE[ask.style][ask.ladder]
  if (via === 'openai') {
    return {
      model: 'gpt-6-luna',
      input: JSON.stringify(stateOf(input)),
      questions: [{ type: 'choice', name: 'tier', instructions: QUESTION[ask.style], choices: tiers.map(t => ({ value: t, description: describe[t] })) }],
    }
  }
  return {
    model: via === 'gateway' ? 'typesafe-ai/jev' : 'jev-latest',
    ...(via === 'gateway' ? { providerOptions: { gateway: { only: ['typesafe-ai'], ...(ask.zeroRetention ? { zeroDataRetention: true } : {}) } } } : {}),
    state: stateOf(input),
    questions: { tier: { type: 'choice', instructions: QUESTION[ask.style], criteria: Object.fromEntries(tiers.map(t => [t, describe[t]])) } },
  }
}

// Reads a picker's answer; null when it is not one we can use.
export function parsePick(text: string, via: Via, tiers: readonly Tier[]): { tier: Tier; confidence: number; probabilities: Partial<Record<Tier, number>>; costUsd: number } | null {
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  // OpenAI lists answers and probabilities; Jev keys them by name.
  const a = via === 'openai' ? (Array.isArray(body?.answers) ? body.answers.find((x: any) => x?.name === 'tier') : undefined) : body?.answers?.tier
  if (!a || !tiers.includes(a.choice)) return null
  const probabilities: Partial<Record<Tier, number>> = Array.isArray(a.probabilities)
    ? Object.fromEntries(a.probabilities.filter((x: any) => tiers.includes(x?.value) && typeof x.probability === 'number').map((x: any) => [x.value, x.probability]))
    : (a.probabilities ?? {})
  // TypeSafe and OpenAI send a confidence; the gateway sends only the probabilities, so the pick's own stands in.
  const confidence = typeof a.confidence === 'number' ? a.confidence : (probabilities[a.choice as Tier] ?? 0)
  const tokens = body.usage?.input_tokens ?? body.usage?.inputTokens
  const raw = body.providerMetadata?.gateway?.cost
  const billed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN // the gateway's billed cost, when it sends one
  const costUsd = Number.isFinite(billed) && billed >= 0 ? billed : typeof tokens === 'number' ? tokens * USD_PER_TOKEN[via] : 0
  return { tier: a.choice, confidence, probabilities, costUsd }
}

// Which tier a model name or id belongs to, if any of ours.
export function tierOf(model: string | undefined): Tier | undefined {
  if (!model) return undefined
  return (['haiku', 'sonnet', 'opus', 'fable'] as const).find(t => model.toLowerCase().includes(t))
}

// What a run cost at API prices; undefined for a model we have no price for.
export function costOf(model: string, u: Usage): number | undefined {
  const p = PRICES.find(x => x.match.test(model))
  if (!p) return undefined
  const write = p.input * 1.25 // 5-minute cache writes
  return (u.input_tokens * p.input + u.output_tokens * p.output + u.cache_read_input_tokens * p.cacheRead + u.cache_creation_input_tokens * write) / 1_000_000
}

export function addUsage(a: Usage | undefined, b: Usage): Usage {
  if (!a) return { ...b }
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  }
}

export function usd(n: number | undefined): string {
  if (n === undefined) return '?'
  if (n === 0) return '$0'
  if (n < 0.01) return '<$0.01'
  return `$${n.toFixed(2)}`
}
