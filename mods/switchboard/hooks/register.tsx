// Switchboard: the cheapest Claude model that can do each subagent's job.
//   Before a subagent starts, Jev (TypeSafe's routing model, about $0.00003 a call) picks
//   Haiku, Sonnet or Opus for its task; with no key, or no answer in time, simple rules do.
//   In auto mode the pick replaces the model the caller asked for; in suggest mode it is
//   only shown. The band has one line per spawn; /route lists every pick, its reason and
//   what each run cost at API prices, against what the asked model would have cost.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Route, Tier } from '../types'
import { PRICES_AS_OF, addUsage, byRules, costOf, jevRequest, parseJev, tierOf, usd } from './route'

const PANE = 'switchboard'
const JEV_URL = 'https://api.typesafe.ai/v1/systemone'
const JEV_TIMEOUT_MS = 2_500 // the spawn waits this long for Jev at most
const MIN_CONFIDENCE = 0.5 // below this, Jev's pick is shown but not applied
const SHOW_DONE_MS = 30_000 // a finished spawn stays in the band this long
const BAND_ROWS = 3
const PANE_ROWS = 12

// Held by the host, so a hot reload keeps the log.
const routes = atom({ plugin: 'switchboard', key: 'routes' } as const, [] as Route[])
const now = atom({ plugin: 'switchboard', key: 'now' } as const, 0)

export const register: Register = (on, options) => {
  const mode = options.mode === 'suggest' ? 'suggest' : 'auto'
  const key = typeof options.jevApiKey === 'string' ? options.jevApiKey.trim() : ''

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'route', description: 'Show which model Switchboard picked for each subagent, and what it cost' }).catch(() => {}) // a name Claude Code already has is refused: start anyway
    // Redraws the band so a finished line leaves after 30 s; quiet when nothing is shown.
    $.clock.every(5_000, () => {
      void (async () => {
        if ((await read($, routes)).some(r => isShown(r, Date.now() - 5_000))) await update($, now, () => Date.now())
      })().catch(() => {})
    })
    return r
  })

  on('agent.spawn', async ($, e, next) => {
    if (e.fork || e.isTeammate) return next(e) // a fork runs on its parent's model; a teammate keeps the one it was given
    const asked = baseline(e)
    const pick = await decide($, e, key || ((await $.env.get('TYPESAFE_API_KEY').catch(() => undefined)) ?? '').trim()).catch(() => null)
    if (!pick) return next(e) // routing broke: the spawn goes ahead as asked
    const sure = pick.confidence === undefined || pick.confidence >= MIN_CONFIDENCE
    const apply = mode === 'auto' && sure && asked !== undefined && pick.tier !== tierOf(asked)
    const r = await next(apply ? { ...e, model: pick.tier } : e)
    if (r.deny !== undefined) return r
    const one: Route = {
      id: e.tool_use_id,
      agentId: r.agentId,
      description: e.description || e.name || e.subagentType,
      type: e.subagentType,
      asked,
      picked: pick.tier,
      by: pick.by,
      confidence: pick.confidence,
      reason: sure ? pick.reason : `${pick.reason}, too unsure to switch`,
      applied: apply,
      status: 'running',
      startedAt: Date.now(),
      model: r.model,
      jevUsd: pick.jevUsd,
    }
    await update($, routes, list => trim([one, ...list.filter(x => x.id !== one.id)])).catch(() => {})
    return r
  })

  // Each subagent turn's tokens, counted once: a turn.complete is one turn.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) return r
    const id = e.agentId
    const failed = e.reason === 'error' || e.reason === 'aborted'
    await update($, routes, list =>
      list.map(x => {
        if (x.agentId !== id) return x
        const usage = r.usage ? addUsage(x.usage, r.usage) : x.usage
        const model = r.usage?.model ?? x.model ?? x.picked
        return {
          ...x,
          status: failed ? 'failed' : 'done',
          endedAt: Date.now(),
          model,
          usage,
          costUsd: usage ? costOf(model, usage) : x.costUsd,
          // Not switched, it ran on what was asked; switched, the same tokens at the asked model's prices.
          askedUsd: !usage ? x.askedUsd : x.applied && x.asked ? costOf(x.asked, usage) : costOf(model, usage),
        }
      }),
    )
    return r
  })

  on('command.run', { command: 'route' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Switchboard', focus: true })
    const t = totals(await read($, routes))
    return { text: `${t.count} routed, ${t.switched} switched · ${usd(t.cost)} spent, ${usd(t.asked)} at the asked models` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    await read($, now) // subscribes the band to the clock
    const shown = (await read($, routes)).filter(r => isShown(r))
    if (e.props.hasSurvey || shown.length === 0) return rest
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {shown.slice(0, BAND_ROWS).map(r => (
          <Text wrap="truncate-end">
            <Text color={color(r)} bold>{` ⇄ ${r.description}`}</Text>
            <Text>{`  ${move(r, mode)}`}</Text>
            <Text dimColor>{`  ${source(r)}${r.status === 'running' ? '' : ` · ${usd(r.costUsd)}`}`}</Text>
          </Text>
        ))}
        {shown.length > BAND_ROWS && <Text dimColor>{`   +${shown.length - BAND_ROWS} more · /route`}</Text>}
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const list = await read($, routes)
    const t = totals(list)
    return (
      <Box flexDirection="column">
        <Text bold>{`${t.count} routed · ${t.switched} switched · mode: ${mode}`}</Text>
        <Text>
          <Text>{`spent ${usd(t.cost)}`}</Text>
          <Text dimColor>{` · at the asked models ${usd(t.asked)} · Jev ${usd(t.jev)}`}</Text>
        </Text>
        <Text dimColor>{`API price estimates as of ${PRICES_AS_OF}, not plan charges. ? = not known yet.`}</Text>
        <Text dimColor>{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
        {list.length === 0 && <Text dimColor>No subagents yet this session.</Text>}
        {list.slice(0, PANE_ROWS).map(r => (
          <Box flexDirection="column">
            <Text wrap="truncate-end">
              <Text color={color(r)} bold>{`${icon(r)} ${r.description}`}</Text>
              <Text>{`  ${move(r, mode)}`}</Text>
              <Text dimColor>{`  ${r.status === 'running' ? 'running' : `${usd(r.costUsd)} (asked ${usd(r.askedUsd)})`}`}</Text>
            </Text>
            <Text dimColor wrap="truncate-end">{`   ${r.type} · ${source(r)} · ${r.reason}${r.model ? ` · ran on ${r.model}` : ''}`}</Text>
          </Box>
        ))}
        {list.length > PANE_ROWS && <Text dimColor>{`… ${list.length - PANE_ROWS} older`}</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="clear" label="Clear finished" hotkey="c" onPress={() => update($, routes, all => all.filter(x => x.status === 'running'))} />
          <Button key="close" label="Close" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

type Pick = { tier: Tier; by: 'jev' | 'rules'; confidence?: number; reason: string; jevUsd?: number }

// Jev when there is a key and it answers in time; the rules otherwise.
async function decide($: EngineInterface, e: { subagentType: string; description: string; prompt: string }, key: string): Promise<Pick> {
  const rules = byRules(e)
  if (!key) return { ...rules, by: 'rules' }
  const timeout = $.clock.sleep(JEV_TIMEOUT_MS).then(() => null)
  const asked = $.http
    .fetch(JEV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(jevRequest(e)),
    })
    .then(r => (r.ok ? parseJev(r.text) : null))
    .catch(() => null)
  const jev = await Promise.race([asked, timeout])
  if (!jev) return { ...rules, by: 'rules', reason: `${rules.reason} (Jev did not answer)` }
  return { tier: jev.tier, by: 'jev', confidence: jev.confidence, reason: `Jev ${pct(jev.probabilities[jev.tier] ?? jev.confidence)} ${jev.tier}`, jevUsd: jev.costUsd }
}

// The model the spawn would run on without us, when we can know it: what the caller named,
// or the parent's for an agent that inherits. Undefined when the agent's own definition
// decides, which a hook can't see; such a spawn gets a suggestion, never a switch.
export function baseline(e: { model?: string; parentModel: string; subagentType: string }): string | undefined {
  if (e.model && e.model !== 'inherit') return e.model
  if (e.model === 'inherit' || e.subagentType === 'general-purpose') return e.parentModel
  return undefined
}

// The newest 50, but never a running one: its cost and status are still to come.
export function trim(list: Route[]) {
  return list.filter((r, i) => i < 50 || r.status === 'running')
}

// Running, or finished in the last 30 s.
export function isShown(r: Route, at = Date.now()) {
  return r.status === 'running' || (r.endedAt !== undefined && at - r.endedAt < SHOW_DONE_MS)
}

// "opus → haiku", "haiku (kept)" or, in suggest mode, "opus · try haiku".
export function move(r: Route, mode: 'auto' | 'suggest') {
  if (r.asked === undefined) return `own model · try ${r.picked}`
  const from = tierOf(r.asked) ?? r.asked
  if (r.applied) return `${from} → ${r.picked}`
  if (tierOf(r.asked) === r.picked) return `${r.picked} (kept)`
  return mode === 'suggest' ? `${from} · try ${r.picked}` : `${from} (kept)`
}

export function totals(list: Route[]) {
  const sum = (f: (r: Route) => number | undefined) => list.reduce((n, r) => n + (f(r) ?? 0), 0)
  return {
    count: list.length,
    switched: list.filter(r => r.applied).length,
    cost: sum(r => r.costUsd) + sum(r => r.jevUsd),
    asked: sum(r => r.askedUsd),
    jev: sum(r => r.jevUsd),
  }
}

function source(r: Route) {
  return r.by === 'jev' ? `jev ${pct(r.confidence ?? 0)}` : 'rules'
}

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function icon(r: Route) {
  return r.status === 'running' ? '●' : r.status === 'done' ? '✓' : '✗'
}

function color(r: Route) {
  return r.status === 'running' ? 'yellow' : r.status === 'done' ? 'green' : 'red'
}
