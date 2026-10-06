import { describe, expect, test } from 'claude-code/testing'

import { render } from '../statusline/render.mjs'

const NOW = 1_800_000_000
const plain = (s: string) => s.replace(/\x1b\[\d+m/g, '')
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'

function input(cache: Record<string, unknown> | undefined) {
  return { model: { id: 'm' }, ...(cache ? { prompt_cache: cache } : {}) }
}

const warm1h = { warm: true, caching_observed: true, ttl: '1h', expires_at: NOW + 38 * 60, hit_ratio: 0.91, misses: 0 }

describe('cache-clock line', () => {
  test('shows nothing before prompt_cache appears', () => {
    expect(render(input(undefined), NOW)).toBe('')
    expect(render(null, NOW)).toBe('')
  })

  test('shows nothing when the provider reports no caching', () => {
    expect(render(input({ ...warm1h, caching_observed: false }), NOW)).toBe('')
  })

  test('warm: green, bar, time left, hit ratio and misses', () => {
    const line = render(input(warm1h), NOW)
    expect(line.startsWith(GREEN)).toBe(true)
    expect(plain(line)).toBe('cache ● 1h ███████░░░ 38m left · hit 91% · misses 0')
  })

  test('a full cache fills the bar', () => {
    const line = render(input({ ...warm1h, expires_at: NOW + 3599 }), NOW)
    expect(plain(line)).toBe('cache ● 1h ██████████ 59m left · hit 91% · misses 0')
  })

  test('about to expire: yellow under 20% of the lifetime, seconds under a minute', () => {
    const line = render(input({ ...warm1h, ttl: '5m', expires_at: NOW + 53, hit_ratio: 0.36, misses: 1 }), NOW)
    expect(line.startsWith(YELLOW)).toBe(true)
    expect(plain(line)).toBe('cache ● 5m ██░░░░░░░░ 53s left · hit 36% · misses 1')
  })

  test('just above 20% stays green', () => {
    expect(render(input({ ...warm1h, ttl: '5m', expires_at: NOW + 61 }), NOW).startsWith(GREEN)).toBe(true)
  })

  test('cold: red, with the tokens the next message re-caches, rounded to k', () => {
    const line = render(input({ ...warm1h, warm: false, expires_at: NOW - 10, recache_tokens_if_cold: 82_400 }), NOW)
    expect(line.startsWith(RED)).toBe(true)
    expect(plain(line)).toBe('cache ○ cold · next message re-caches 82k tokens')
  })

  test('cold once expires_at passes, even if warm was true when the input was built', () => {
    expect(plain(render(input({ ...warm1h, expires_at: NOW - 1, recache_tokens_if_cold: 900 }), NOW)))
      .toBe('cache ○ cold · next message re-caches 900 tokens')
  })

  test('cold adds the miss cause only when there is one', () => {
    const cold = { ...warm1h, warm: false, expires_at: null, recache_tokens_if_cold: 45_000 }
    expect(plain(render(input({ ...cold, last_miss_cause: { causes: ['tools_changed'], tools_added: 2 } }), NOW)))
      .toBe('cache ○ cold · next message re-caches 45k tokens · tools changed')
    expect(plain(render(input({ ...cold, last_miss_cause: null }), NOW)))
      .toBe('cache ○ cold · next message re-caches 45k tokens')
  })

  test('skips fields an older Claude Code does not send', () => {
    expect(plain(render(input({ warm: true, ttl: '1h', expires_at: NOW + 600 }), NOW)))
      .toBe('cache ● 1h ██░░░░░░░░ 10m left')
    expect(plain(render(input({ warm: false, expires_at: null }), NOW))).toBe('cache ○ cold')
    expect(plain(render(input({ ...warm1h, hit_ratio: null }), NOW))).toBe('cache ● 1h ███████░░░ 38m left · misses 0')
  })
})
