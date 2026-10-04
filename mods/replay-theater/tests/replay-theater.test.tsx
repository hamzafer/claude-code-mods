import { describe, expect, test } from 'claude-code/testing'

const PANE = { component: 'Pane', requestId: 'replay-theater', props: { title: 'Replay Theater', isFocused: true, bodyColumns: 80, placement: 'dock' } }

describe('replay-theater', () => {
  test('records a turn of edits and steps through them', async ($, on) => {
    // Hooks registered here sit beneath the mod and stand for the engine.
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }) as any)
    on('turn.complete', () => ({ text: '' }) as any)
    on('tool.call', () => ({ result: {}, text: 'ok' }) as any)
    on('fs.read', () => ({ value: 'export const greet = "hi"\n' }) as any)
    on('ui.open', () => ({ value: { isPlaced: true } }) as any)
    on('ui.toast', () => ({ value: undefined }) as any)
    on('command.register', () => ({ value: undefined }) as any)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.turn.start({ text: 'rename greet', turnId: 't1' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'greet()', new_string: 'welcome()' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/work/b.ts', content: 'export const welcome = "hi"\n' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)

    expect((await $.command.run({ command: 'replay', args: '' } as any)).text).toBe('Replaying the last turn')

    const ui = await $.ui.mount({ plugin: 'replay-theater', surface: 'terminal', ...PANE } as any)
    expect(await ui.find({ type: 'Text', text: /Step 1\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^a\.ts$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- greet\(\)$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+ welcome\(\)$/ })).toBeDefined()

    await ui.press({ key: 'next' })
    expect(await ui.find({ type: 'Text', text: /Step 2\/2/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^- export const greet = "hi"$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^\+ export const welcome = "hi"$/ })).toBeDefined()
    await ui.unmount()
  })

  test('toasts once per session, then keeps a count on the status line for the last turn', async ($, on) => {
    const toasts: string[] = []
    const statuses: (string | undefined)[] = []
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('turn.start', (_$, e) => ({ turnId: e.turnId }) as any)
    on('turn.complete', () => ({ text: '' }) as any)
    on('tool.call', () => ({ result: {}, text: 'ok' }) as any)
    on('ui.toast', (_$, e: any) => (toasts.push(e.text), { value: undefined }) as any)
    on('ui.status', (_$, e: any) => (statuses.push(e.text), { value: undefined }) as any)
    on('command.register', () => ({ value: undefined }) as any)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    for (const [i, n] of [1, 2, 3].entries()) {
      await $.turn.start({ text: 'edit', turnId: `t${i}` } as any)
      for (let k = 0; k < n; k++) {
        await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'a', new_string: 'b' } as any)
      }
      await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    }

    expect(toasts).toEqual(['replay-theater: 1 edit last turn. Run /replay'])
    expect(statuses).toEqual(['▶ /replay: 2 edits', undefined, '▶ /replay: 3 edits'])

    // A turn without edits clears the old count.
    await $.turn.start({ text: 'just talk', turnId: 't9' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(statuses).toEqual(['▶ /replay: 2 edits', undefined, '▶ /replay: 3 edits', undefined])
  })

  test('says so when there is nothing to replay', async ($, on) => {
    on('session.start', (_$, e) => ({ sessionId: 's', cwd: e.cwd }) as any)
    on('command.register', () => ({ value: undefined }) as any)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    expect((await $.command.run({ command: 'replay', args: '' } as any)).text).toBe('No edits to replay yet')
  })
})
