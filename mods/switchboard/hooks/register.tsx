// Switchboard: the right Claude model for each subagent, and what each one cost.
//   Before a subagent starts that names no model, a picker chooses one from a ladder (Haiku,
//   Sonnet, Opus, or Sonnet, Opus, Fable) by its short label alone: Jev (TypeSafe's decision
//   model, directly or through Vercel AI Gateway) or OpenAI's Decisions API, each a fraction
//   of a cent a pick. A model the caller named is kept. With no picker, no key, or no answer
//   in time, nothing changes. In auto mode the pick replaces the model the spawn would have run
//   on; in suggest mode it is only shown. /route lists every subagent, its pick and its cost.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Route, Tier } from '../types'
import { LADDERS, PICKER_NAME, PICK_URL, PRICES_AS_OF, addUsage, costOf, parsePick, pickRequest, tierOf, usd } from './route'
import type { Ladder, Style, Via } from './route'

const PANE = 'switchboard'
const PICK_TIMEOUT_MS = 4_000 // the spawn waits this long for the picker at most
const MIN_CONFIDENCE = 0.5 // below this, a picker's pick is shown but not applied
const SHOW_DONE_MS = 30_000 // a finished spawn stays in the band this long
const BAND_ROWS = 3
const PANE_ROWS = 12

// Held by the host, so a hot reload keeps the log.
const routes = atom({ plugin: 'switchboard', key: 'routes' } as const, [] as Route[])
const now = atom({ plugin: 'switchboard', key: 'now' } as const, 0)

export const register: Register = (on, options) => {
  const mode = options.mode === 'suggest' ? 'suggest' : 'auto'
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const settings: Settings = {
    picker: options.picker === 'jev' || options.picker === 'openai' ? options.picker : 'off',
    ladder: options.models === 'sonnet-opus-fable' ? 'sonnet-opus-fable' : 'haiku-sonnet-opus',
    style: options.style === 'quality' ? 'quality' : 'saver',
    respectNamed: options.respectNamed !== false,
    jev: text(options.jevApiKey),
    gateway: text(options.gatewayApiKey),
    openai: text(options.openaiApiKey),
    zeroRetention: options.gatewayZeroRetention === true,
  }

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
    const named = settings.respectNamed && !!e.model && e.model !== 'inherit'
    const pick: Pick = named
      ? { by: 'none', reason: 'named by the caller, kept' }
      : await credential($, settings)
          .then(c => decide($, e, c, settings))
          .catch(() => ({ by: 'none' as const, reason: 'picker failed, kept' }))
    const sure = pick.confidence === undefined || pick.confidence >= MIN_CONFIDENCE
    const apply = mode === 'auto' && sure && !!pick.tier && asked !== undefined && pick.tier !== tierOf(asked)
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
      pickerUsd: pick.pickerUsd,
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
        // What it ran on: the API's word, else the switch we made, else what was asked.
        const model = r.usage?.model ?? x.model ?? (x.applied ? x.picked : x.asked) ?? x.picked ?? ''
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
    return { text: `${t.count} subagents, ${t.switched} switched · ${usd(t.cost)} spent, ${usd(t.asked)} at the asked models` }
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
    const keyless = settings.picker !== 'off' && !(await credential($, settings).catch(() => null))
    return (
      <Box flexDirection="column">
        <Text bold>{`${t.count} subagents · ${t.switched} switched · mode: ${mode} · picker: ${settings.picker}${keyless ? ' (no key, nothing changes)' : ''}`}</Text>
        <Text>
          <Text>{`spent ${usd(t.cost)}`}</Text>
          <Text dimColor>{` · at the asked models ${usd(t.asked)} · picker ${usd(t.picker)}`}</Text>
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
            <Text dimColor wrap="truncate-end">{`   ${r.type} · ${r.by === 'none' ? r.reason : `${source(r)} · ${r.reason}`}${r.model ? ` · ran on ${r.model}` : ''}`}</Text>
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

type Pick = { tier?: Tier; by: Route['by']; confidence?: number; reason: string; pickerUsd?: number }
type Settings = { picker: 'off' | 'jev' | 'openai'; ladder: Ladder; style: Style; respectNamed: boolean; jev: string; gateway: string; openai: string; zeroRetention: boolean }
type Credential = { via: Via; key: string } | null

// The picker the settings chose, with its key. A key set in /config wins over one from the
// environment. Jev: a TypeSafe key goes straight to TypeSafe, a gateway key through Vercel AI
// Gateway. OpenAI: the setting, then OPENAI_API_KEY. A key alone never turns a picker on:
// many tools set these variables.
async function credential($: EngineInterface, s: Settings): Promise<Credential> {
  if (s.picker === 'openai') {
    const key = s.openai || ((await $.env.get('OPENAI_API_KEY').catch(() => undefined)) ?? '').trim()
    return key ? { via: 'openai', key } : null
  }
  if (s.picker !== 'jev') return null
  if (s.jev) return { via: 'typesafe', key: s.jev }
  if (s.gateway) return { via: 'gateway', key: s.gateway }
  const typesafe = ((await $.env.get('TYPESAFE_API_KEY').catch(() => undefined)) ?? '').trim()
  if (typesafe) return { via: 'typesafe', key: typesafe }
  const gateway = ((await $.env.get('AI_GATEWAY_API_KEY').catch(() => undefined)) ?? '').trim()
  return gateway ? { via: 'gateway', key: gateway } : null
}

// The picker when there is one and it answers in time; otherwise no pick, and nothing changes.
async function decide($: EngineInterface, e: { subagentType: string; description: string }, c: Credential, s: Settings): Promise<Pick> {
  if (!c) return { by: 'none', reason: s.picker === 'off' ? 'no picker' : `no ${s.picker === 'openai' ? 'OpenAI' : 'Jev'} key` }
  const name = PICKER_NAME[c.via]
  const timeout = $.clock.sleep(PICK_TIMEOUT_MS).then(() => null)
  const asked = $.http
    .fetch(PICK_URL[c.via], {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(pickRequest(e, c.via, { ladder: s.ladder, style: s.style, zeroRetention: s.zeroRetention })),
    })
    .then(r => (r.ok ? parsePick(r.text, c.via, LADDERS[s.ladder]) : null))
    .catch(() => null)
  const got = await Promise.race([asked, timeout])
  if (!got) return { by: 'none', reason: `${name} did not answer` }
  const by: Pick['by'] = c.via === 'openai' ? 'openai' : 'jev'
  return { tier: got.tier, by, confidence: got.confidence, reason: `${name} ${pct(got.probabilities[got.tier] ?? got.confidence)} ${got.tier}`, pickerUsd: got.costUsd }
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

// "opus → sonnet", "sonnet (kept)", "opus · try sonnet" in suggest mode, or, with no pick, the
// model it runs on and why nothing was picked.
export function move(r: Route, mode: 'auto' | 'suggest') {
  const from = r.asked === undefined ? 'own model' : (tierOf(r.asked) ?? r.asked)
  if (!r.picked) return from
  if (r.asked === undefined) return `own model · try ${r.picked}`
  if (r.applied) return `${from} → ${r.picked}`
  if (tierOf(r.asked) === r.picked) return `${r.picked} (kept)`
  return mode === 'suggest' ? `${from} · try ${r.picked}` : `${from} (kept)`
}

export function totals(list: Route[]) {
  const sum = (f: (r: Route) => number | undefined) => list.reduce((n, r) => n + (f(r) ?? 0), 0)
  return {
    count: list.length,
    switched: list.filter(r => r.applied).length,
    cost: sum(r => r.costUsd) + sum(r => r.pickerUsd),
    asked: sum(r => r.askedUsd),
    picker: sum(r => r.pickerUsd),
  }
}

function source(r: Route) {
  return r.by === 'none' ? r.reason : `${r.by} ${pct(r.confidence ?? 0)}`
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
