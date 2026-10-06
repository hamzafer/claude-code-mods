// The cache line, drawn from the status line input's `prompt_cache`.
// Pure: no Node imports, so the mod's tests load it as it is.

const TTL_SECONDS = { '5m': 5 * 60, '1h': 60 * 60 }
const BAR_CELLS = 10
// Under this share of the lifetime left, the line turns yellow.
const WARN_SHARE = 0.2

const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const RESET = '\x1b[0m'

// The line for `input` at `nowSeconds` (epoch seconds); '' when there is nothing to show.
export function render(input, nowSeconds) {
  const cache = input?.prompt_cache
  if (!cache || typeof cache !== 'object') return ''
  if (cache.caching_observed === false) return ''

  const left = typeof cache.expires_at === 'number' ? cache.expires_at - nowSeconds : null
  const isWarm = cache.warm !== false && left !== null && left > 0
  return isWarm ? warmLine(cache, left) : coldLine(cache)
}

function warmLine(cache, left) {
  const ttl = TTL_SECONDS[cache.ttl]
  const color = ttl && left < ttl * WARN_SHARE ? YELLOW : GREEN
  let head = 'cache ●'
  if (ttl) head += ` ${cache.ttl} ${bar(left / ttl)}`
  head += ` ${duration(left)} left`

  const rest = []
  if (typeof cache.hit_ratio === 'number') rest.push(`hit ${Math.round(cache.hit_ratio * 100)}%`)
  if (typeof cache.misses === 'number') rest.push(`misses ${cache.misses}`)
  return [`${color}${head}${RESET}`, ...rest].join(' · ')
}

function coldLine(cache) {
  const rest = []
  if (typeof cache.recache_tokens_if_cold === 'number') {
    rest.push(`next message re-caches ${tokens(cache.recache_tokens_if_cold)} tokens`)
  }
  const cause = missCause(cache.last_miss_cause)
  if (cause) rest.push(cause)
  return [`${RED}cache ○ cold${RESET}`, ...rest].join(' · ')
}

function bar(share) {
  const filled = Math.max(0, Math.min(BAR_CELLS, Math.ceil(share * BAR_CELLS)))
  return '█'.repeat(filled) + '░'.repeat(BAR_CELLS - filled)
}

// 38m, 53s: whole minutes from a minute up.
function duration(seconds) {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m` : `${Math.max(1, Math.floor(seconds))}s`
}

// 82k from 82,400; under a thousand as it is.
function tokens(count) {
  return count >= 1000 ? `${Math.round(count / 1000)}k` : String(count)
}

// `tools_changed` reads "tools changed"; null when the last miss has no known cause.
function missCause(cause) {
  const names = Array.isArray(cause?.causes) ? cause.causes.filter(c => typeof c === 'string' && c) : []
  return names.length ? names.map(n => n.replaceAll('_', ' ')).join(', ') : null
}
