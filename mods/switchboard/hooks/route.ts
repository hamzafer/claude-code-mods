// The routing brain, kept free of the engine so tests can call it directly:
// the rules, the Jev request and its answer, and the cost of a run.
import type { Tier, Usage } from '../types'

export const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus']

// What each tier is for. Jev reads these as the options of one Choice question.
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
const JEV_USD_PER_TOKEN = 0.042 / 1_000_000 // input only; Jev's output tokens are free

const STATE_CHARS = 6_000 // enough of the task for Jev to judge it, well under its 32k state limit

// The fallback when Jev has no key or does not answer: the agent type first, then words in the
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

// Where a Jev call goes: TypeSafe itself, or Vercel AI Gateway, which serves the same model.
export type Via = 'typesafe' | 'gateway'
export const JEV_URL: Record<Via, string> = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  gateway: 'https://ai-gateway.vercel.sh/v1/evaluate',
}

// The body of one Jev call: the task as state, and one Choice over the three tiers. Through
// the gateway it also asks for zero data retention.
export function jevRequest(input: { subagentType: string; description: string; prompt: string }, via: Via = 'typesafe') {
  return {
    model: via === 'gateway' ? 'typesafe-ai/jev' : 'jev-latest',
    ...(via === 'gateway' ? { providerOptions: { gateway: { zeroDataRetention: true } } } : {}),
    state: {
      agent_type: input.subagentType,
      description: input.description,
      task: input.prompt.slice(0, STATE_CHARS),
    },
    questions: {
      tier: {
        type: 'choice',
        instructions: 'A coding agent is about to hand this task to a subagent. Which model tier is the cheapest one that will still do the task well?',
        criteria: CRITERIA,
      },
    },
  }
}

// Reads Jev's answer; null when it is not one we can use.
export function parseJev(text: string): { tier: Tier; confidence: number; probabilities: Partial<Record<Tier, number>>; costUsd: number } | null {
  let body: any
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const a = body?.answers?.tier
  if (!a || !TIERS.includes(a.choice)) return null
  const probabilities = a.probabilities ?? {}
  // TypeSafe sends a confidence; the gateway sends only the probabilities, so the pick's own stands in.
  const confidence = typeof a.confidence === 'number' ? a.confidence : typeof probabilities[a.choice] === 'number' ? probabilities[a.choice] : 0
  const tokens = body.usage?.input_tokens ?? body.usage?.inputTokens
  const raw = body.providerMetadata?.gateway?.cost
  const billed = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN // the gateway's billed cost, when it sends one
  const costUsd = Number.isFinite(billed) && billed >= 0 ? billed : typeof tokens === 'number' ? tokens * JEV_USD_PER_TOKEN : 0
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
