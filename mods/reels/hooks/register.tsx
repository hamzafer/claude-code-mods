// Reels: YouTube Shorts in a pane, mirrored from a hidden Chrome (helper/reels.cjs).
// It plays while Claude works and pauses when Claude is done. Nothing starts until /reels.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ReelsStatus } from '../types'

const PANE = 'reels'
const IMAGE = 'reel'
const FOOTER_ROWS = 2 // the controls and the status line under the picture

const status = atom({ plugin: 'reels', key: 'status' } as const, 'off' as ReelsStatus)
const isMuted = atom({ plugin: 'reels', key: 'isMuted' } as const, false)

// The newest frame, the picture's mounted size and whether Claude is working; a reload starts them over.
const live: { frame: { file: string; n: number } | null; size: { columns: number; rows: number } | null; isWorking: boolean } = {
  frame: null,
  size: null,
  isWorking: false,
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'reels', description: 'Play Shorts in a pane while Claude works; /reels login signs in, /reels stop ends it' })
    return r
  })

  on('command.run', { command: 'reels' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const p = await paths($)
    if (arg === 'stop') {
      await send($, '/quit')
      await update($, status, () => 'off')
      await $.ui.close({ id: PANE })
      return { text: 'Reels stopped.' }
    }
    if (!(await $.fs.exists(`${p.modules}/playwright`))) {
      await update($, status, () => 'missing')
      return { text: `Reels needs Playwright once: npm install --prefix ${p.dir} playwright` }
    }
    if (arg === 'login') {
      await send($, '/quit') // the profile opens in one Chrome at a time
      void drain($.process.spawn({ argv: helperArgv($, p, 'login'), env: { NODE_PATH: p.modules } })).catch(() => {})
      return { text: 'A YouTube window opened. Accept cookies or sign in, close it, then run /reels.' }
    }
    await $.ui.open({ id: PANE, title: 'Reels', focus: true })
    if (!(await send($, '/state'))) await start($, p)
    if (live.isWorking) await send($, '/play')
    return { text: 'Reels is on. It plays while Claude works.' }
  })

  on('turn.start', async ($, e, next) => {
    live.isWorking = true
    if (await send($, '/play')) await update($, status, () => 'playing')
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      live.isWorking = false
      if (await send($, '/pause')) await update($, status, () => 'paused')
    }
    return r
  })

  on('session.end', async ($, e, next) => {
    await send($, '/quit')
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Reels draws pictures in the terminal only.</Text>
    }
    const { Box, Text, Button, Image } = $.ui.resolve(e)
    const now = await read($, status)
    const muted = await read($, isMuted)

    // A 9:16 picture: terminal cells are about twice as tall as wide.
    const rows = Math.max(4, Math.min(255, e.props.scroll.bodyRows - FOOTER_ROWS))
    const columns = Math.max(4, Math.min(255, e.props.bodyColumns, Math.round((rows * 9) / 8)))
    live.size = { columns, rows }

    const line = {
      off: 'Run /reels to start',
      starting: 'Starting Chrome…',
      paused: "⏸ Claude's done, your turn",
      playing: '▶ Playing while Claude works',
      consent: 'YouTube wants cookie consent: run /reels login once',
      missing: 'Needs Playwright: see /reels',
      failed: 'Chrome did not start: run claude --debug',
    }[now]

    return (
      <Box flexDirection="column">
        {live.frame ? (
          <Image key={IMAGE} source={{ file: live.frame.file, format: 'png', generation: live.frame.n }} columns={columns} rows={rows} alt="YouTube Shorts" />
        ) : (
          <Box height={rows}>
            <Text dimColor>{now === 'off' ? ' ' : 'Waiting for the first frame…'}</Text>
          </Box>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="prev" label="Prev" hotkey="k" onPress={() => void send($, '/prev')} />
          <Button key="next" label="Next" hotkey="j" variant="primary" onPress={() => void send($, '/next')} />
          <Button
            key="mute"
            label={muted ? 'Unmute' : 'Mute'}
            hotkey="m"
            onPress={async () => {
              if (await send($, '/mute')) await update($, isMuted, m => !m)
            }}
          />
          <Button key="stop" label="Stop" hotkey="x" role="dismiss" onPress={() => void stopAll($)} />
        </Box>
        <Text dimColor={now !== 'paused'} color={now === 'paused' ? 'yellow' : undefined}>{line}</Text>
      </Box>
    )
  })
}

async function start($: EngineInterface, p: Paths) {
  await update($, status, () => 'starting')
  // A child for the session's life: the loop ends with the helper or with this module.
  void (async () => {
    const child = $.process.spawn({ argv: helperArgv($, p, 'pane'), env: { NODE_PATH: p.modules } })
    let rest = ''
    for await (const piece of child) {
      if (!('stream' in piece)) break
      if (piece.stream === 'stderr') {
        $.ui.log(piece.text, { to: 'debug' })
        continue
      }
      const lines = (rest + piece.text).split('\n')
      rest = lines.pop() ?? ''
      for (const line of lines) await onLine($, line)
    }
    await update($, status, s => (s === 'consent' ? s : 'off'))
  })().catch(async err => {
    $.ui.log(`reels: helper did not start: ${String(err)}`, { to: 'debug' })
    await update($, status, () => 'failed').catch(() => {})
  })
}

async function onLine($: EngineInterface, line: string) {
  if (line.startsWith('F ')) {
    const [, n, file] = line.split(' ')
    if (!file) return
    live.frame = { file, n: Number(n) }
    if (live.size) {
      await $.ui.blit({ requestId: PANE, key: IMAGE, source: { file, format: 'png', generation: live.frame.n }, ...live.size }).catch(() => {})
    }
  } else if (line === 'R ready') {
    await update($, status, () => (live.isWorking ? 'playing' : 'paused'))
  } else if (line === 'C consent') {
    await update($, status, () => 'consent')
  }
}

type Paths = { dir: string; socket: string; profile: string; frames: string; modules: string }

async function paths($: EngineInterface): Promise<Paths> {
  const home = (await $.env.get('HOME')) ?? ''
  const dir = `${home}/.claude-mods/reels`
  return { dir, socket: `${dir}/ctl.sock`, profile: `${dir}/profile`, frames: `${dir}/frames`, modules: `${dir}/node_modules` }
}

function helperArgv($: EngineInterface, p: Paths, mode: 'pane' | 'login') {
  return ['/usr/bin/env', 'node', `${$.plugin.root}/helper/reels.cjs`, p.socket, p.profile, p.frames, mode]
}

// Sends one command to the helper; false when it is not running.
async function send($: EngineInterface, path: string) {
  const { socket } = await paths($)
  try {
    const r = await $.http.fetch(`http://reels${path}`, { method: path === '/state' ? 'GET' : 'POST', socketPath: socket })
    return r.ok
  } catch {
    return false
  }
}

async function stopAll($: EngineInterface) {
  await send($, '/quit')
  await update($, status, () => 'off')
  await $.ui.close({ id: PANE })
}

async function drain(stream: AsyncIterable<unknown>) {
  for await (const _ of stream) {
    // The login window's output is not needed; the loop keeps it alive until it closes.
  }
}
