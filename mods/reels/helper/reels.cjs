// Reels helper: a hidden Chrome on YouTube Shorts whose screen the mod mirrors into a pane.
// Run: node reels.cjs <socket> <profile dir> <frame dir> [pane|login]
//   pane:  headless; writes PNG frames and prints "F <n> <path>" per frame, "C consent" on a consent page
//   login: a visible window to accept cookies or sign in once; exits when closed
// Listens for POST /play, /pause, /next, /prev, /mute, /quit and GET /state: on the Unix socket, or on Windows (where node
// has none) on a loopback port, written with a token to the file `socket` names. Every request must carry that token.
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { chromium } = require('playwright')

const isWindows = process.platform === 'win32'
const token = isWindows ? require('node:crypto').randomUUID() : ''
const [socket, profile, frameDir, mode = 'pane'] = process.argv.slice(2)
const START = 'https://www.youtube.com/shorts'
const WIDTH = 405
const HEIGHT = 720
const FRAME_MS = 66 // about 15 frames a second
const SLOTS = 3 // frames rotate through a few files, so the terminal never reads a half-written one

// Runs in every page: holds videos paused while Claude is done.
const GUARD = `
  window.__claude = window.__claude || { paused: false, muted: false }
  document.addEventListener('play', e => {
    if (window.__claude.paused && e.target instanceof HTMLMediaElement) e.target.pause()
  }, true)
  document.addEventListener('volumechange', e => {
    if (e.target instanceof HTMLMediaElement && e.target.muted !== window.__claude.muted) e.target.muted = window.__claude.muted
  }, true)
`

const SET_PAUSED = paused => {
  window.__claude = window.__claude || { paused: false, muted: false }
  window.__claude.paused = paused
  const id = '__claude_overlay'
  let el = document.getElementById(id)
  if (paused) {
    document.querySelectorAll('video, audio').forEach(v => v.pause())
    if (!el) {
      el = document.createElement('div')
      el.id = id
      el.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(10,10,10,.8);color:#fff;font:700 24px -apple-system,system-ui,sans-serif;text-align:center;pointer-events:none'
      // Plain DOM, not innerHTML: YouTube's Trusted Types policy refuses HTML strings.
      const line = (text, css) => {
        const d = document.createElement('div')
        d.textContent = text
        if (css) d.style.cssText = css
        el.appendChild(d)
      }
      line('⏸', 'font-size:60px')
      line("Claude's done, your turn")
      line('Reels resume when Claude works again', 'font:400 15px -apple-system,system-ui,sans-serif;opacity:.7')
      document.documentElement.appendChild(el)
    }
  } else {
    if (el) el.remove()
    const v = [...document.querySelectorAll('video')].find(x => {
      const r = x.getBoundingClientRect()
      return r.top < innerHeight && r.bottom > 0 && r.width > 0
    })
    if (v) v.play().catch(() => {})
  }
}

async function login() {
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: false,
    viewport: null,
    ignoreDefaultArgs: ['--enable-automation'],
    args: [`--app=${START}`, '--window-size=460,860'],
  })
  context.on('close', () => process.exit(0))
}

async function pane() {
  fs.mkdirSync(frameDir, { recursive: true })
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chrome',
    headless: true,
    viewport: { width: WIDTH, height: HEIGHT },
    ignoreDefaultArgs: ['--enable-automation', '--mute-audio'],
    args: ['--autoplay-policy=no-user-gesture-required'],
  })
  await context.addInitScript(GUARD)
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(START, { waitUntil: 'domcontentloaded' }).catch(() => {})
  let paused = true
  let muted = false
  await page.evaluate(SET_PAUSED, paused).catch(() => {})

  const checkConsent = () => {
    if (page.url().includes('consent.')) console.log('C consent')
  }
  checkConsent()
  page.on('load', () => {
    checkConsent()
    page.evaluate(SET_PAUSED, paused).catch(() => {})
  })

  // Mirror the screen: Chrome pushes frames as they change; keep about 15 a second.
  const cdp = await context.newCDPSession(page)
  let n = 0
  let last = 0
  cdp.on('Page.screencastFrame', async ({ data, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    const now = Date.now()
    if (now - last < FRAME_MS) return
    last = now
    n += 1
    const file = path.join(frameDir, `f-${n % SLOTS}.png`)
    fs.writeFileSync(file, Buffer.from(data, 'base64'))
    console.log(`F ${n} ${file}`)
  })
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: WIDTH, maxHeight: HEIGHT, everyNthFrame: 1 })

  const server = http.createServer(async (req, res) => {
    if (isWindows && req.headers['x-reels-token'] !== token) {
      res.statusCode = 403 // a web page can send a request to a local port, but not this header
      return res.end('forbidden')
    }
    const url = new URL(req.url, 'http://reels')
    try {
      if (url.pathname === '/play' || url.pathname === '/pause') {
        paused = url.pathname === '/pause'
        await page.evaluate(SET_PAUSED, paused)
      } else if (url.pathname === '/next' || url.pathname === '/prev') {
        await page.keyboard.press(url.pathname === '/next' ? 'ArrowDown' : 'ArrowUp')
        await page.waitForTimeout(400)
        await page.evaluate(SET_PAUSED, paused)
      } else if (url.pathname === '/mute') {
        muted = !muted
        await page.evaluate(m => {
          window.__claude.muted = m
          document.querySelectorAll('video, audio').forEach(v => (v.muted = m))
        }, muted)
      } else if (url.pathname === '/state') {
        const state = await page.evaluate(() => ({
          paused: window.__claude?.paused ?? null,
          muted: window.__claude?.muted ?? null,
          videos: [...document.querySelectorAll('video')].map(v => ({ paused: v.paused, muted: v.muted, t: Math.round(v.currentTime * 10) / 10 })),
          url: location.href,
        }))
        return res.end(JSON.stringify({ ...state, frames: n }))
      } else if (url.pathname === '/quit') {
        res.end('bye')
        return shutdown()
      }
      res.end(paused ? 'paused' : 'playing')
    } catch (err) {
      res.statusCode = 500
      res.end(String(err))
    }
  })

  const shutdown = async () => {
    server.close()
    fs.rmSync(socket, { force: true })
    await context.close().catch(() => {})
    process.exit(0)
  }
  const gone = () => {
    fs.rmSync(socket, { force: true })
    process.exit(0)
  }
  context.on('close', gone)
  page.on('close', gone)
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  fs.rmSync(socket, { force: true })
  if (isWindows) {
    server.listen(0, '127.0.0.1', () => {
      fs.writeFileSync(socket, JSON.stringify({ port: server.address().port, token }))
      console.log('R ready')
    })
  } else server.listen(socket, () => console.log('R ready'))
}

;(mode === 'login' ? login() : pane()).catch(err => {
  console.error(err)
  process.exit(1)
})
