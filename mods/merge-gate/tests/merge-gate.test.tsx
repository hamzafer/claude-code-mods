import { describe, expect, test } from 'claude-code/testing'

import { bare, cdTargets, countChecks, isOllama, prNumber, resolveDir } from '../hooks/register'

const LUNA_REVIEW = `codex review -c 'model="gpt-5.6-luna"' --base main --title "Add mods"`
const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140 } }

// A folder git and gh know: its main checkout, its branch and that branch's open PR (if any).
type Dir = { repo: string; branch: string; pr?: number }

// Stands for the engine beneath the mod: a repo with PR #42, its checks, the Codex config, a dialog.
// With `dirs`, git and gh answer for the folder they run in (session folder `cwd`, /repo by default).
function engine(on: any, opts: { config?: string; checks?: object[]; answer?: string; cwd?: string; dirs?: Record<string, Dir> } = {}) {
  const ran: string[] = []
  const store = new Map<string, unknown>()
  on('tool.call', { tool: 'AskUserQuestion' }, (_$: any, e: any) => {
    const question = e.questions[0].question
    return { result: { questions: e.questions, answers: { [question]: opts.answer ?? 'Hold' } }, text: '' }
  })
  on('tool.call', (_$: any, e: any) => {
    ran.push(e.command)
    return { result: {}, text: 'ok' }
  })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('env.get', () => ({ value: '/Users/me' }))
  on('fs.read', () => ({ value: opts.config ?? 'model = "gpt-6-astra"\n' }))
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => (store.set(e.key, e.value), { value: undefined }))
  on('session.cwd', () => ({ value: opts.cwd ?? '/repo' }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'band below' }))
  on('process.run', (_$: any, e: any) => {
    const argv = (e.argv as string[]).join(' ')
    const ok = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } })
    if (opts.dirs) {
      const cwd: string = e.init?.cwd ?? opts.cwd ?? '/repo'
      const d = opts.dirs[cwd]
      if (!d) return ok('', 128) // not a git repo
      if (argv.startsWith('git rev-parse')) return ok(`${d.repo}/.git\n`)
      if (argv.startsWith('git branch')) return ok(`${d.branch}\n`)
      if (argv.startsWith('gh pr view')) {
        return d.pr ? ok(JSON.stringify({ number: d.pr, title: `PR ${d.pr}`, headRefName: d.branch, state: 'OPEN' })) : ok('', 1)
      }
    }
    if (argv.startsWith('git rev-parse')) return ok('/repo\n')
    if (argv.startsWith('git branch')) return ok('feat/mods\n')
    if (argv.startsWith('gh pr view')) return ok(JSON.stringify({ number: 42, title: 'Add mods', headRefName: 'feat/mods', state: 'OPEN' }))
    if (argv.startsWith('gh pr checks')) return ok(JSON.stringify(opts.checks ?? [{ name: 'test', bucket: 'pass' }]), 1)
    return ok('')
  })
  return { ran, store }
}

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo' })

describe('merge-gate', () => {
  test('helpers', () => {
    expect(isOllama('model = "gpt-6-astra"')).toBe(false)
    expect(isOllama('openai_base_url = "http://127.0.0.1:11434/v1"')).toBe(true)
    expect(isOllama('model = "gemma4:128k"')).toBe(true)
    expect(countChecks(JSON.stringify([{ name: 'a', bucket: 'pass' }, { name: 'b', bucket: 'fail' }, { name: 'c', bucket: 'pending' }])))
      .toEqual({ pass: 1, fail: 1, pending: 1, failing: ['b'] })
  })

  test('Codex: Ollama config is refused, the model must be luna, one pass per PR', async ($, on) => {
    const { ran } = engine(on, { config: 'openai_base_url = "http://127.0.0.1:11434/v1"\n' })
    await start($)
    const r: any = await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    expect(r.deny).toMatch(/points at Ollama/)
    expect(ran).toEqual([])
  })

  test('Codex: wrong model refused, first luna pass runs, second refused', async ($, on) => {
    const { ran } = engine(on)
    await start($)
    const wrong: any = await $.tool.call({ tool: 'Bash', command: 'codex review --base main' } as any)
    expect(wrong.deny).toMatch(/gpt-5\.6-luna only/)
    await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    const again: any = await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    expect(again.deny).toMatch(/one pass per PR/)
    expect(ran).toEqual([LUNA_REVIEW])
  })

  test('Codex: one pass per PR, counted for the PR where the review runs', async ($, on) => {
    const dirs: Record<string, Dir> = {
      '/code/mods': { repo: '/code/mods', branch: 'main' },
      '/code/mods/wt/a': { repo: '/code/mods', branch: 'fix-a', pr: 7 },
      '/code/mods/wt/b': { repo: '/code/mods', branch: 'fix-b', pr: 8 },
      '/code/mods/wt/c': { repo: '/code/mods', branch: 'fix-c' },
      '/code/mods/wt/d': { repo: '/code/mods', branch: '' },
      '/code/mods/wt/e': { repo: '/code/mods', branch: '' },
      '/code/other': { repo: '/code/other', branch: 'main' },
    }
    const { ran, store } = engine(on, { cwd: '/code/mods', dirs })
    await start($)
    const review = (cd: string) => $.tool.call({ tool: 'Bash', command: `${cd}${LUNA_REVIEW}` } as any) as Promise<any>
    // Two worktrees, two PRs: both run
    expect((await review('cd /code/mods/wt/a && ')).deny).toBeUndefined()
    expect((await review('cd wt/b; ')).deny).toBeUndefined()
    // The same PR again: refused, from any folder and any spelling of the path
    expect((await review('cd /code/mods/wt/a && ')).deny).toMatch(/one pass per PR/)
    expect((await review('cd wt && cd ./a/../a && ')).deny).toMatch(/one pass per PR/)
    expect((await review('(cd "/code/mods/wt/b" && ')).deny).toMatch(/one pass per PR/)
    // No PR yet: counted for the branch
    expect((await review('cd wt/c && ')).deny).toBeUndefined()
    expect((await review('cd /code/mods/wt/c && ')).deny).toMatch(/one pass per PR/)
    // Detached HEAD, no PR: counted per folder, so two such worktrees do not share a count
    expect((await review('cd wt/d && ')).deny).toBeUndefined()
    expect((await review('cd wt/e && ')).deny).toBeUndefined()
    // Inside bash -c, and after many cds
    expect((await review(`bash -lc 'cd wt/a && ${LUNA_REVIEW.replace(/'/g, '')}' #`)).deny).toMatch(/one pass per PR/)
    expect((await review(`${'cd wt && cd .. && '.repeat(10)}cd wt/b && `)).deny).toMatch(/one pass per PR/)
    expect([...store.keys()].filter(k => k.startsWith('codex:')).sort()).toEqual([
      'codex:/code/mods#7',
      'codex:/code/mods#8',
      'codex:/code/mods@/code/mods/wt/d',
      'codex:/code/mods@/code/mods/wt/e',
      'codex:/code/mods@fix-c',
    ])
    expect(ran.length).toBe(5)
  })

  test('merge: a leading cd checks the PR, CI and Codex count of that folder', async ($, on) => {
    const dirs: Record<string, Dir> = {
      '/code/other': { repo: '/code/other', branch: 'main' },
      '/code/mods/wt/a': { repo: '/code/mods', branch: 'fix-a', pr: 7 },
    }
    const { ran } = engine(on, { cwd: '/code/other', dirs })
    await start($)
    const held: any = await $.tool.call({ tool: 'Bash', command: 'cd /code/mods/wt/a && gh pr merge --squash' } as any)
    expect(held.deny).toMatch(/^merge-gate: held the merge of PR #7: Codex has not reviewed it/)
    await $.tool.call({ tool: 'Bash', command: `cd /code/mods/wt/a && ${LUNA_REVIEW}` } as any)
    await $.tool.call({ tool: 'Bash', command: 'cd /code/mods/wt/a && gh pr merge --squash' } as any)
    expect(ran).toEqual([`cd /code/mods/wt/a && ${LUNA_REVIEW}`, 'cd /code/mods/wt/a && gh pr merge --squash'])
  })

  test('Codex: a session started in another repo counts the review for the repo it cds into', async ($, on) => {
    const dirs: Record<string, Dir> = {
      '/code/other': { repo: '/code/other', branch: 'main' },
      '/code/mods/wt/a': { repo: '/code/mods', branch: 'fix-a', pr: 7 },
      '/code/mods/wt/b': { repo: '/code/mods', branch: 'fix-b', pr: 8 },
    }
    const { ran, store } = engine(on, { cwd: '/code/other', dirs })
    await start($)
    const review = (dir: string) => $.tool.call({ tool: 'Bash', command: `cd ${dir} && ${LUNA_REVIEW}` } as any) as Promise<any>
    expect((await review('../mods/wt/a')).deny).toBeUndefined()
    expect((await review('/code/mods/wt/b')).deny).toBeUndefined()
    expect((await review('/code/mods/wt/a')).deny).toMatch(/one pass per PR/)
    expect([...store.keys()].filter(k => k.startsWith('codex:')).sort()).toEqual(['codex:/code/mods#7', 'codex:/code/mods#8'])
    expect(ran.length).toBe(2)
  })

  test('cdTargets and resolveDir find where a command runs', () => {
    expect(cdTargets('codex review')).toEqual([])
    expect(cdTargets('cd a && cd "b c"; cd \'d\'\ncodex review')).toEqual(['a', 'b c', 'd'])
    expect(cdTargets('(cd x\\ y && codex review)')).toEqual(['x y'])
    expect(cdTargets('ls && cd a && codex review')).toEqual([])
    expect(cdTargets('cd a || codex review')).toEqual([])
    expect(cdTargets(`cd a && bash -lc 'cd b && codex review'`)).toEqual(['a', 'b'])
    expect(cdTargets('eval "cd \\"x y\\"; codex review"')).toEqual(['x y'])
    expect(resolveDir('/r', 'a/../b/./c', '/h')).toBe('/r/b/c')
    expect(resolveDir('/r/x', '/abs', '/h')).toBe('/abs')
    expect(resolveDir('/r', '~/w', '/h')).toBe('/h/w')
    expect(resolveDir('/r', '$WT', '/h')).toBeNull()
    expect(resolveDir('/r', '-', '/h')).toBeNull()
    expect(resolveDir('/r', '~bob/x', '/h')).toBeNull()
  })

  test('codex exec is never run', async ($, on) => {
    const { ran } = engine(on)
    const r: any = await $.tool.call({ tool: 'Bash', command: 'codex exec "fix it"' } as any)
    expect(r.deny).toMatch(/review only/)
    expect(ran).toEqual([])
  })

  test('bare and prNumber read the command as the shell does', () => {
    expect(bare(`grep -n "codex exec" x && echo 'gh pr merge'`)).toBe(`grep -n "" x && echo ''`)
    expect(bare('ls # codex exec\npwd')).toBe('ls \npwd')
    expect(bare("cat <<'EOF' > a.md\ncodex exec x\nEOF\nls")).toBe('cat  > a.md\n\nls')
    expect(bare('out="$(codex exec x)"')).toBe('out="(codex exec x)"')
    expect(prNumber('gh pr merge 42 --squash')).toBe('42')
    expect(prNumber('gh pr merge --squash 7 && ls')).toBe('7')
    expect(prNumber('gh -R o/r pr merge --squash')).toBeUndefined()
    expect(prNumber(bare('gh pr merge "42" --squash'))).toBe('42')
    expect(bare('cat <<EOF && ls\nbody\nEOF')).toBe('cat  && ls\n')
  })

  test('a long command is still read quickly', async ($, on) => {
    engine(on)
    for (const command of ['; x=1'.repeat(20_000), `;${'\n'.repeat(30_000)}`, '-a '.repeat(20_000)]) {
      const t = Date.now()
      await $.tool.call({ tool: 'Bash', command } as any)
      expect(Date.now() - t).toBeLessThan(1000)
    }
  })

  test('codex exec, codex review and gh pr merge are caught where the shell runs them', async ($, on) => {
    const { ran } = engine(on, { checks: [{ name: 'lint', bucket: 'fail' }], answer: 'Hold' })
    await start($)
    const forms = (cmd: string) => [
      cmd,
      `cd repo && ${cmd}`,
      `FOO=1 ${cmd}`,
      `npx ${cmd}`,
      `sudo ${cmd}`,
      `ls; ${cmd}`,
      `false || ${cmd}`,
      `ls\n${cmd}`,
      `(${cmd})`,
      `out="$(${cmd})"`,
      `echo \`${cmd}\``,
      `/usr/local/bin/${cmd}`,
      `\\${cmd}`,
      `timeout 900 ${cmd}`,
      `nohup ${cmd} &`,
      `command ${cmd}`,
      `xargs -n 1 ${cmd}`,
      `sudo -u bob ${cmd}`,
      `{ ${cmd}; }`,
      `if ${cmd}; then :; fi`,
      `bash -lc '${cmd}'`,
      `eval '${cmd}'`,
      `cat <<EOF | ${cmd}\nbody\nEOF`,
      `bash <<'EOF'\n${cmd}\nEOF`,
      `echo $'a\\'b'; ${cmd}`,
    ]
    const cases: [string, RegExp][] = [
      ...forms('codex exec "fix it"').map(c => [c, /review only/] as [string, RegExp]),
      ['codex -c k=v exec x', /review only/],
      ['codex --model o3 exec x', /review only/],
      ['codex --full-auto exec x', /review only/],
      ...forms('codex review --base main').map(c => [c, /gpt-5\.6-luna only/] as [string, RegExp]),
      ['codex -c k=v review --base main', /gpt-5\.6-luna only/],
      ...forms('gh pr merge 42 --squash').map(c => [c, /held the merge of PR #42/] as [string, RegExp]),
      ['gh -R owner/repo pr merge 42', /held the merge/],
      ['gh pr merge --squash 42', /held the merge of PR #42/],
    ]
    for (const [command, deny] of cases) {
      const r: any = await $.tool.call({ tool: 'Bash', command } as any)
      expect([command, deny.test(r.deny ?? '')]).toEqual([command, true])
    }
    expect(ran).toEqual([])
  })

  test('mentions in quotes, heredocs, patterns, messages and comments pass', async ($, on) => {
    const { ran } = engine(on, { checks: [{ name: 'lint', bucket: 'fail' }], answer: 'Hold' })
    await start($)
    const mentions = (cmd: string) => [
      `grep -rn "${cmd}" .`,
      `rg '${cmd}' docs`,
      `git commit -m "Never run ${cmd}"`,
      `git commit -m "$(cat <<'EOF'\nUse ${cmd} with care\nEOF\n)"`,
      `cat <<'EOF' > notes.md\n${cmd}\nEOF`,
      `ls # ${cmd}`,
      `# ${cmd}\nls`,
      `echo ${cmd}`,
      `echo "it's ${cmd}"`,
      `FOO='${cmd}' ls`,
    ]
    const commands = [...mentions('codex exec x'), ...mentions('codex review --base main'), ...mentions('gh pr merge 42')]
    for (const command of commands) {
      const r: any = await $.tool.call({ tool: 'Bash', command } as any)
      expect({ command, deny: r.deny }).toEqual({ command, deny: undefined })
    }
    expect(ran).toEqual(commands)
  })

  test('merge is held when CI fails and Codex has not run', async ($, on) => {
    const { ran } = engine(on, { checks: [{ name: 'lint', bucket: 'fail' }], answer: 'Hold' })
    await start($)
    const r: any = await $.tool.call({ tool: 'Bash', command: 'gh pr merge 42 --squash' } as any)
    expect(r.deny).toMatch(/1 failing \(lint\); Codex has not reviewed it/)
    expect(ran).toEqual([])
  })

  test('merge goes through when CI is green and Codex ran', async ($, on) => {
    const { ran } = engine(on)
    await start($)
    await $.tool.call({ tool: 'Bash', command: LUNA_REVIEW } as any)
    await $.tool.call({ tool: 'Bash', command: 'gh pr merge 42 --squash' } as any)
    expect(ran).toEqual([LUNA_REVIEW, 'gh pr merge 42 --squash'])
  })

  test('the band shows the PR and stacks over what was there; /gate explains', async ($, on) => {
    engine(on, { checks: [{ name: 'test', bucket: 'pass' }, { name: 'lint', bucket: 'fail' }] })
    await start($)
    const r = await $.command.run({ command: 'gate', args: '' } as any)
    expect(r.text).toMatch(/PR #42: Add mods/)
    expect(r.text).toMatch(/Not ready to merge/)
    const ui = await $.ui.mount({ plugin: 'merge-gate', surface: 'terminal', ...BAND } as any)
    expect(await ui.find({ type: 'Text', text: / ⛙ PR #42 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /CI ✗ 1 failing/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Codex 0\/1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /band below/ })).toBeDefined()
    await ui.unmount()
  })
})
