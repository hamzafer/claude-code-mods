// The shared band helper (hooks/bands.ts, a copy of shared/bands.ts).
import { describe, expect, test } from 'claude-code/testing'

import { bandOrder, resetBandOrder, stackBands } from '../hooks/bands'

const text = (s: string): any => ({ type: 'Text', children: [s] })
const band = (name: string, part?: string): any => ({
  type: 'Box',
  props: { key: `band:${name}` },
  children: [text(name)],
  ...(part ? { part: { plugin: part } } : {}),
})
const column = (children: any[], part?: string): any => ({
  type: 'Box',
  props: { key: 'bands', flexDirection: 'column' },
  children,
  ...(part ? { part: { plugin: part } } : {}),
})
const keys = (el: any) => (el.children as any[]).map(c => (typeof c === 'string' ? c : (c.props?.key ?? c.children?.[0])))

// Stands for the env and files a mod's `$` reaches.
function world(files: Record<string, string>, env: Record<string, string> = { HOME: '/home/me' }) {
  const reads: string[] = []
  const $: any = {
    env: { get: async (name: string) => env[name] },
    fs: {
      exists: async (path: string) => path in files,
      read: async (path: string) => {
        reads.push(path)
        if (!(path in files)) throw new Error('ENOENT')
        return files[path]
      },
    },
  }
  return { $, reads }
}

describe('stackBands', () => {
  test('wraps its own band in a keyed Box inside one keyed column', () => {
    const out: any = stackBands(text('engine'), 'context-bar', text('mine'), 'below', [])
    expect(out.type).toBe('Box')
    expect(out.props).toEqual({ key: 'bands', flexDirection: 'column' })
    expect(keys(out)).toEqual(['engine', 'band:context-bar'])
    expect(out.children[1].children).toEqual([text('mine')])
  })

  test('with no order, keeps where the mod drew its band', () => {
    expect(keys(stackBands(text('engine'), 'a', text('a'), 'below', []))).toEqual(['engine', 'band:a'])
    expect(keys(stackBands(text('engine'), 'a', text('a'), 'above', []))).toEqual(['band:a', 'engine'])
  })

  test("unpacks another band mod's column instead of nesting it", () => {
    const rest = column([text('engine'), band('b')])
    const out: any = stackBands(rest, 'a', text('a'), 'above', [])
    expect(keys(out)).toEqual(['band:a', 'engine', 'band:b'])
    expect(out.children.some((c: any) => c.props?.key === 'bands')).toBe(false)
  })

  test('anything else from next(e) stays one item', () => {
    const other = { type: 'Box', props: { key: 'someone-else' }, children: [band('b')] }
    expect(keys(stackBands(other as any, 'a', text('a'), 'below', ['a', 'b']))).toEqual(['someone-else', 'band:a'])
  })

  test('with an order, untagged items come first, in their order', () => {
    const rest = column([band('b'), text('engine'), text('other')])
    expect(keys(stackBands(rest, 'a', text('a'), 'above', ['a', 'b']))).toEqual(['engine', 'other', 'band:a', 'band:b'])
  })

  test('bands not in the order sit on top in their current order, listed ones follow in file order', () => {
    const rest = column([band('c'), band('b'), band('x'), band('d')])
    expect(keys(stackBands(rest, 'a', text('a'), 'below', ['d', 'a', 'b']))).toEqual(['band:c', 'band:x', 'band:d', 'band:a', 'band:b'])
  })

  test('unknown names in the order are ignored', () => {
    const rest = column([band('b')])
    expect(keys(stackBands(rest, 'a', text('a'), 'above', ['ghost', 'b', 'nope', 'a']))).toEqual(['band:b', 'band:a'])
  })

  test("moves the column's part stamp onto that plugin's band", () => {
    const rest = column([text('engine'), band('b')], 'b')
    const out: any = stackBands(rest, 'a', text('a'), 'below', [])
    expect(out.children.find((c: any) => c.props?.key === 'band:b').part).toEqual({ plugin: 'b' })
    expect(out.part).toBeUndefined() // the engine stamps the new root itself
  })

  test("keeps a band's own part stamp", () => {
    const rest = column([band('b', 'b'), band('c', 'c')], 'c')
    const out: any = stackBands(rest, 'a', text('a'), 'below', [])
    expect(out.children.find((c: any) => c.props?.key === 'band:b').part).toEqual({ plugin: 'b' })
    expect(out.children.find((c: any) => c.props?.key === 'band:c').part).toEqual({ plugin: 'c' })
  })

  test('an empty rest adds nothing', () => {
    expect(keys(stackBands(undefined as any, 'a', text('a'), 'below', []))).toEqual(['band:a'])
  })
})

describe('bandOrder', () => {
  test('reads the order file from the config folder', async () => {
    resetBandOrder()
    const { $ } = world({ '/home/me/.claude/claude-code-mods/bands.json': '{"order":["a","b"]}' })
    expect(await bandOrder($)).toEqual(['a', 'b'])
  })

  test('follows CLAUDE_CONFIG_DIR, trailing slashes removed', async () => {
    resetBandOrder()
    const { $ } = world({ '/cfg/claude-code-mods/bands.json': '{"order":["b"]}' }, { HOME: '/home/me', CLAUDE_CONFIG_DIR: '/cfg//' })
    expect(await bandOrder($)).toEqual(['b'])
  })

  test('reads once per session', async () => {
    resetBandOrder()
    const { $, reads } = world({ '/home/me/.claude/claude-code-mods/bands.json': '{"order":["a"]}' })
    await bandOrder($)
    await bandOrder($)
    expect(reads.length).toBe(1)
  })

  test('a missing file means no order', async () => {
    resetBandOrder()
    const { $ } = world({})
    expect(await bandOrder($)).toEqual([])
  })

  test('broken JSON or a wrong shape means no order', async () => {
    const files: Record<string, string> = {}
    const { $ } = world(files)
    for (const body of ['{not json', '[]', '{"order":"a"}', '{"order":["a",2]}', 'null']) {
      resetBandOrder()
      files['/home/me/.claude/claude-code-mods/bands.json'] = body
      expect(await bandOrder($)).toEqual([])
    }
  })

  test('no HOME and no CLAUDE_CONFIG_DIR means no order', async () => {
    resetBandOrder()
    const { $ } = world({}, {})
    expect(await bandOrder($)).toEqual([])
  })
})
