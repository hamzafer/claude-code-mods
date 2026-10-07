// The routing brain, kept free of the engine so tests can call it directly:
// the rules, each picker's request and answer, and the cost of a run.
import type { Tier, Usage } from '../types'

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus']

// What each tier is for. A picker reads these as the options of one choice question.
export const CRITERIA: Record<Tier, string> = {
  haiku: 'Lookups and light work: searching or listing files, reading and summarizing code or docs, answering a factual question about the repo, small mechanical edits.',
  sonnet: 'Everyday coding: implementing a feature, fixing an ordinary bug, writing or updating tests, reviewing a diff, editing a few files.',
  opus: 'Hard thinking: planning or architecture, debugging a subtle or intermittent issue, security review, large multi-file refactors, work where a wrong answer is costly.',
}

// API prices in USD per million tokens, as published on 2026-09-25. Estimates, not plan charges.
export const PRICES_AS_OF = '2026-09-25'
const PRICES: { match: RegExp; input: number; output: number; cacheRead: number }[] = [
  { match: /haiku/i, input: 1, output: 5, cacheRead: 0.1 },
  { match: /sonnet/i, input: 2, output: 10, cacheRead: 0.2 },
  { match: /opus/i, input: 4, output: 20, cacheRead: 0.2 },
  { match: /fable|mythos/i, input: 10, output: 50, cacheRead: 0.25 },
]
// The fallback when no picker is set, or it does not answer: the agent type first, then words in the
// short description. The prompt is left out: a coding task often says "search" or "list" too.
export function byRules(input: { subagentType: string; description: string }): { tier: Tier; reason: string } {
  const type = input.subagentType.toLowerCase()
  if (type === 'explore') return { tier: 'haiku', reason: 'rule: Explore agent' }
  if (type === 'plan') return { tier: 'opus', reason: 'rule: Plan agent' }
  const text = input.description.toLowerCase()
  if (/\b(architect\w*|design doc|plan the|root cause|race condition|deadlock|security|threat model|refactor across|migrat\w+)\b/.test(text)) return { tier: 'opus', reason: 'rule: hard task words' }
  if (/\b(find|search|locate|list|look up|summari[sz]e|grep|where is|which files|read through)\b/.test(text)) return { tier: 'haiku', reason: 'rule: lookup words' }
  return { tier: 'sonnet', reason: 'rule: default' }
}

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

const STATE_CHARS = 6_000 // enough of the task to judge it, well under every picker's input limit
const QUESTION = 'A coding agent is about to hand this task to a subagent. Which model tier is the cheapest one that will still do the task well?'

type Task = { subagentType: string; description: string; prompt: string }
function stateOf(input: Task) {
  return { agent_type: input.subagentType, description: input.description, task: input.prompt.slice(0, STATE_CHARS) }
}

// The body of one pick: the task, and one choice over the three tiers, in each API's own shape.
// Through the gateway, only TypeSafe may serve it; zero data retention is opt-in, since the
// gateway refuses it below the Pro plan.
export function pickRequest(input: Task, via: Via, opts: { zeroRetention?: boolean } = {}) {
  if (via === 'openai') {
    return {
      model: 'gpt-6-luna',
      input: JSON.stringify(stateOf(input)),
      questions: [{ type: 'choice', name: 'tier', instructions: QUESTION, choices: TIERS.map(t => ({ value: t, description: CRITERIA[t] })) }],
    }
  }
  return {
    model: via === 'gateway' ? 'typesafe-ai/jev' : 'jev-latest',
    ...(via === 'gateway' ? { providerOptions: { gateway: { only: ['typesafe-ai'], ...(opts.zeroRetention ? { zeroDataRetention: true } : {}) } } } : {}),
    state: stateOf(input),
    questions: { tier: { type: 'choice', instructions: QUESTION, criteria: CRITERIA } },
  }
}

// Reads a picker's answer; null when it is not one we can use.
export function parsePick(text: string, via: Via): { tier: Tier; confidence: number; probabilities: Partial<Record<Tier, number>>; costUsd: number } | null {
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  // OpenAI lists answers and probabilities; Jev keys them by name.
  const a = via === 'openai' ? (Array.isArray(body?.answers) ? body.answers.find((x: any) => x?.name === 'tier') : undefined) : body?.answers?.tier
  if (!a || !TIERS.includes(a.choice)) return null
  const probabilities: Partial<Record<Tier, number>> = Array.isArray(a.probabilities)
    ? Object.fromEntries(a.probabilities.filter((x: any) => TIERS.includes(x?.value) && typeof x.probability === 'number').map((x: any) => [x.value, x.probability]))
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
  return TIERS.find(t => model.toLowerCase().includes(t))
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
