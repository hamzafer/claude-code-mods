import { describe, expect, test } from 'claude-code/testing'

import { ago, kebab } from '../hooks/register'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } }
const wait = () => new Promise(done => (globalThis as any).setTimeout(done, 10))

// Stands for the engine beneath the mod: a store, unpause, Haiku, the transcript.
function engine(on: any, opts: { title?: string; reply?: string; turns?: number; store?: [string, unknown][] } = {}) {
  const store = new Map<string, unknown>(opts.store ?? [])
  const runs: string[] = []
  const toasts: string[] = []
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('classic.SessionStart', () => ({}))
  on('command.register', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.turns', () => ({ value: opts.turns ?? 2 }))
  on('session.messages', () => ({ value: [{ role: 'user', text: 'build three mods', toolUses: [] }] }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('prompt.submit', () => ({ text: '' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.toast', (_$: any, e: any) => (toasts.push(e.text), { value: undefined }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('model.complete', () => ({ value: { isAnswered: true, text: opts.reply ?? 'Ship-Mods', usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('process.run', (_$: any, e: any) => {
    runs.push(e.argv.join(' '))
    const stdout = e.argv[1] === 'list' ? JSON.stringify([{ id: 'sess-1', custom_title: opts.title ?? '' }]) : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  })
  return { store, runs, toasts }
}

describe('session-saver', () => {
  test('helpers', () => {
    expect(kebab('"Ship Mods Today Now Please"')).toBe('ship-mods-today-now')
    expect(ago(0, 30 * 60_000)).toBe('30m ago')
    expect(ago(0, 3 * 3_600_000)).toBe('3h ago')
  })

  test('names an untitled session through unpause after the second turn', async ($, on) => {
    const { runs, toasts } = engine(on)
    await $.prompt.submit({ text: 'build three mods' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await wait()
    expect(runs).toContain('unpause rename sess-1 ship-mods')
    expect(toasts[0]).toMatch(/Session named "ship-mods"/)
  })

  test('leaves a named session alone', async ($, on) => {
    const { runs } = engine(on, { title: 'mods-org' })
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await wait()
    expect(runs.some(r => r.startsWith('unpause rename'))).toBe(false)
  })

  test('loading into a session that already has messages shows the parked note once', async ($, on) => {
    const { toasts } = engine(on, { store: [['park:sess-1', { leftOff: 'tested 7 mods', next: 'install', note: '', at: Date.now() }]] })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await wait()
    expect(toasts).toEqual(['Last time (just now): tested 7 mods · next: install'])
    await $.classic.SessionStart({ source: 'resume' } as any) // the engine's own signal after: not twice
    expect(toasts).toHaveLength(1)
  })

  test('a task notification after a typed prompt leaves the typed one as "you asked"', async ($, on) => {
    const { store } = engine(on, { turns: 1 })
    const notice = '<task-notification> <task-id>b03z186zb</task-id> <tool-use-id>t1</tool-use-id> done </task-notification>'
    await $.prompt.submit({ text: 'fix the login test', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    await $.prompt.submit({ text: notice, origin: { kind: 'task-notification' } } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect((store.get('last:sess-1') as any).leftOff).toBe('you asked: fix the login test')

    // Other sessions, schedules and wrapped commands do not count either.
    await $.prompt.submit({ text: 'Another Claude session sent a message: hi', origin: { kind: 'peer' } } as any)
    await $.prompt.submit({ text: 'run the nightly sweep', origin: { kind: 'scheduled-trigger' } } as any)
    await $.prompt.submit({ text: '<local-command-caveat>Caveat</local-command-caveat>', origin: { kind: 'composer' } } as any)
    await $.prompt.submit({ text: '<command-name>/clear</command-name>' } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect((store.get('last:sess-1') as any).leftOff).toBe('you asked: fix the login test')

    // A mod sending the person's words as theirs counts.
    await $.prompt.submit({ text: 'open a draft PR', origin: { kind: 'plugin', name: 'next-steps', asUser: true } } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect((store.get('last:sess-1') as any).leftOff).toBe('you asked: open a draft PR')
  })

  test('a notification before anything typed saves no "you asked"', async ($, on) => {
    const { store } = engine(on, { turns: 1 })
    await $.prompt.submit({ text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' } } as any)
    await $.turn.complete({ reason: 'answer', answer: 'ok', durationMs: 1 } as any)
    expect(store.has('last:sess-1')).toBe(false)
  })

  test('/park saves a summary, and a resume shows it until you type', async ($, on) => {
    const { store, toasts } = engine(on, { reply: '{"leftOff":"3 mods tested, Merge Gate needs a PR repo","next":"install"}' })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const r = await $.command.run({ command: 'park', args: 'check CI first' } as any)
    expect(r.text).toMatch(/Left off: 3 mods tested/)
    expect((store.get('park:sess-1') as any).note).toBe('check CI first')

    await $.classic.SessionStart({ source: 'resume' } as any)
    expect(toasts.at(-1)).toMatch(/^Last time \(just now\): 3 mods tested, Merge Gate needs a PR repo · next: install$/)
    const ui = await $.ui.mount({ plugin: 'session-saver', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: /3 mods tested/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /note: check CI first/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()

    await $.prompt.submit({ text: 'install' } as any)
    expect(await ui.find({ type: 'Text', text: /3 mods tested/ })).toBeUndefined()
    await ui.unmount()
  })
})
