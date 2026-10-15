// Band order: every band mod ships this same file (canonical copy: shared/bands.ts in the repo).
//   The order file, <configDir>/claude-code-mods/bands.json, lists mod names top to bottom
//   (the last sits right above the prompt). Each band mod wraps its band in a Box keyed
//   `band:<name>` and returns one column keyed `bands`; the next band mod unpacks that
//   column, adds its own band and sorts again, so the last one to draw sorts them all.
//   Edit shared/bands.ts, then copy it over every mod's hooks/bands.ts (a repo test checks).
import type { EngineInterface, RenderElement, RenderNode } from 'claude-code'

const COLUMN = 'bands'
const PREFIX = 'band:'

let cached: Promise<string[]> | undefined

// The order from the file, read once per session (restart to apply); [] on any error.
export function bandOrder($: EngineInterface): Promise<string[]> {
  cached ??= readOrder($).catch(() => [])
  return cached
}

// Forgets the cached order, for tests.
export function resetBandOrder() {
  cached = undefined
}

async function readOrder($: EngineInterface): Promise<string[]> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const dir = custom ? custom.replace(/\/+$/, '') : home ? `${home}/.claude` : ''
  if (!dir) return []
  const file = `${dir}/claude-code-mods/bands.json`
  if (!(await $.fs.exists(file))) return []
  const order = (JSON.parse(await $.fs.read(file)) as { order?: unknown } | null)?.order
  return Array.isArray(order) && order.every(n => typeof n === 'string') ? order : []
}

/**
 * One column of bands: `mine` wrapped in a Box keyed `band:<name>`, placed
 * `at` (above or below) what `next(e)` returned, then sorted by `order`.
 * With an order, items that are no band come first, then bands not in the
 * order (in their current order), then the listed ones in file order. With
 * no order nothing moves, so the screen looks as it did before.
 */
export function stackBands(rest: RenderElement | null | undefined, name: string, mine: RenderNode, at: 'above' | 'below', order: string[]): RenderElement {
  const own: RenderElement = { type: 'Box', props: { key: PREFIX + name, flexDirection: 'column' }, children: [mine] }
  const others = unpack(rest)
  const items = at === 'above' ? [own, ...others] : [...others, own]
  return { type: 'Box', props: { key: COLUMN, flexDirection: 'column' }, children: order.length ? sorted(items, order) : items }
}

// Another band mod's column gives up its items; anything else is one item.
function unpack(rest: RenderElement | null | undefined): RenderNode[] {
  if (!rest) return []
  if (!isColumn(rest)) return [rest]
  const kids = rest.children ?? []
  const owner = rest.part?.plugin
  // The engine stamped the column with its owner: that stamp belongs on the owner's own band.
  return kids.map(k => (owner && typeof k !== 'string' && bandName(k) === owner && !('part' in k && k.part) ? { ...k, part: rest.part } : k))
}

function isColumn(el: RenderElement): el is RenderElement & { type: 'Box' } {
  return el.type === 'Box' && el.props?.key === COLUMN
}

function bandName(node: RenderNode): string | undefined {
  if (typeof node === 'string' || node.type !== 'Box') return undefined
  const key = node.props?.key
  return typeof key === 'string' && key.startsWith(PREFIX) ? key.slice(PREFIX.length) : undefined
}

function sorted(items: RenderNode[], order: string[]): RenderNode[] {
  const rank = (n: RenderNode) => {
    const name = bandName(n)
    if (name === undefined) return -2 // not a band: first
    const i = order.indexOf(name)
    return i < 0 ? -1 : i // a band not in the order: on top of the listed ones
  }
  return items.map((n, i) => ({ n, i, r: rank(n) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.n)
}
