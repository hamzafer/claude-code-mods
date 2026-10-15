// The workflows stay locked down: least privilege, pinned actions, and only the
// publish job may ask GitHub for an npm login, from the main-only npm environment.
// Run from the repo root: node --test test/*.test.mjs
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '.github', 'workflows')
const code = text => text.replace(/(^|\s)#.*$/gm, '$1') // comments may name what the code avoids
const workflows = readdirSync(dir).filter(f => /\.ya?ml$/.test(f)).map(f => ({ name: f, text: code(readFileSync(join(dir, f), 'utf8')) }))
const PUBLISHER = 'publish-cli.yml'
const OIDC = [PUBLISHER, 'pages.yml'] // npm's login, and GitHub Pages' deploy

test('every workflow sets its token permissions at the top', () => {
  for (const w of workflows) assert.match(w.text, /^permissions:/m, `${w.name}: add a top-level permissions block (least privilege)`)
})

test('every action is pinned to a full commit sha', () => {
  for (const w of workflows) {
    for (const [, ref] of w.text.matchAll(/^\s*-?\s*uses:\s*["']?([^\s"']+)/gm)) {
      if (ref.startsWith('./')) continue
      assert.match(ref, /@[0-9a-f]{40}$/, `${w.name}: pin ${ref} to a commit sha (a tag can be moved)`)
    }
  }
})

test('no workflow runs untrusted pull request code with secrets', () => {
  for (const w of workflows) assert.doesNotMatch(w.text, /pull_request_target|workflow_run/, `${w.name}: pull_request_target and workflow_run run with secrets on fork code`)
})

test('only the publish and Pages workflows can mint an OIDC token', () => {
  for (const w of workflows) {
    if (!OIDC.includes(w.name)) assert.doesNotMatch(w.text, /id-token\s*:\s*write/, `${w.name}: only ${OIDC.join(' and ')} may have id-token: write`)
  }
})

test('the publish workflow runs on main only, in the npm environment', { skip: !existsSync(join(dir, PUBLISHER)) }, () => {
  const text = code(readFileSync(join(dir, PUBLISHER), 'utf8'))
  assert.match(text, /^\s+environment:\s*(npm\b|\n\s+name: npm\b)/m, `${PUBLISHER}: the job must use the npm environment`)
  assert.match(text, /branches: \[main\]/, `${PUBLISHER}: publish from main only`)
  assert.doesNotMatch(text, /pull_request|workflow_dispatch|registry-url/, `${PUBLISHER}: no PR or manual triggers, no registry-url`)
})
