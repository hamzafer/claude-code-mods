#!/usr/bin/env node
// The status line command /cache-clock setup installs: runs the status line the
// person had, unchanged, then prints the cache line under it.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { render } from './render.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const stdin = await readStdin()
const lines = []

const wrapped = readWrapped()
if (wrapped) {
  // The same input the original command would have read, in the same directory.
  const run = spawnSync(wrapped, { shell: true, input: stdin, encoding: 'utf8', timeout: 5000 })
  const out = (run.stdout ?? '').replace(/\n+$/, '')
  if (out) lines.push(out)
}

let input = null
try {
  input = JSON.parse(stdin)
} catch {
  // Not JSON: the original line alone.
}
const cache = render(input, Date.now() / 1000)
if (cache) lines.push(cache)

if (lines.length) process.stdout.write(lines.join('\n') + '\n')

// Read as a stream: a sync read of a non-blocking pipe can fail with EAGAIN.
async function readStdin() {
  let text = ''
  process.stdin.setEncoding('utf8')
  for await (const chunk of process.stdin) text += chunk
  return text
}

// The command this one wraps, saved by setup under the key it was given; null when there was none.
function readWrapped() {
  const key = process.argv[2]
  if (!key || !/^[0-9a-f]{8}$/.test(key)) return null
  try {
    const saved = JSON.parse(readFileSync(join(here, `setup-${key}.json`), 'utf8'))
    return typeof saved.wrapped === 'string' && saved.wrapped.trim() ? saved.wrapped : null
  } catch {
    return null
  }
}
