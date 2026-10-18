// Pure helpers for background Bash commands: labels, output paths and output tails.
// Nothing here touches `$`, so the tests call it directly.

// Where a command starts: after `;`, `&&`, `|`, `(`, then `timeout 900`, `nohup`, `FOO=1` and the like.
const START = String.raw`(?:^|[;&|(])\s*(?:\w+=\S*\s+)*(?:(?:timeout|nohup|nice|env|time|command)(?:\s+[-\w.=:]+)*\s+)?(?:\S*\/)?`
const AGENT = new RegExp(`${START}(?:(codex)\\s+exec|(opencode)\\s+run|(cursor-agent|agy|crush|copilot|qwen|cline|omp|hermes))(?=\\s|$)`)
const MODEL = /(?:^|\s)(?:--model|-m)(?:\s+|=)["']?(\w[\w.:/-]*)/
const CODEX_MODEL = /\s-c\s+["']?model\s*=\s*\\?["']?([\w.:/-]+)/

const MAX_COMMAND = 4096 // the agent CLI and its --model come early; a huge command must not stall the regexes

// The agent CLI a shell command runs and its `--model`, or undefined for any other command.
export function agentOf(full: string): { agent: string; model?: string } | undefined {
  const command = full.slice(0, MAX_COMMAND)
  const m = AGENT.exec(command)
  if (!m) return undefined
  const agent = m[1] ?? m[2] ?? m[3]
  if (!agent) return undefined
  const part = command.slice(m.index).split(/\s*(?:&&|\|\||;|\|(?!&))\s*/)[0]!
  // A quoted prompt may mention --model: look past quoted strings, except as a flag's own value.
  const bare = part.replace(/(?<!(?:--model|-m)[\s=])(["'])(?:(?!\1).)*\1/g, ' _ ')
  const model = MODEL.exec(bare)?.[1] ?? CODEX_MODEL.exec(part)?.[1]
  return { agent, model }
}

// What the band calls a background shell: the agent and model it runs, else the Bash
// description, else the first 50 characters of the command. `detail` is the other one, for the pane.
export function shellLabel(command: string, description?: string): { label: string; detail: string } {
  const flat = clean(command.slice(0, MAX_COMMAND)).replace(/\s+/g, ' ').trim()
  const text = clean(description ?? '').trim().slice(0, 200) || flat.slice(0, 50)
  const a = agentOf(command)
  return a ? { label: a.model ? `${a.agent} ${a.model}` : a.agent, detail: text } : { label: text, detail: flat.slice(0, 200) }
}

// Where Claude Code keeps a background shell's output: `.../tasks/<id>.output` in 2.1.x
// ("Output is being written to: ..."), "written to: ....output" in older text, or the result's own field.
// Only an absolute path with no control characters or `..` is taken: lsof and tail run on it.
export function outputPathOf(text: string | undefined, result?: unknown): string | undefined {
  const ok = (p: unknown): p is string => typeof p === 'string' && /^\/[^\x00-\x20\x7f-\x9f]+\.output$/.test(p) && !p.split('/').includes('..')
  const r = result && typeof result === 'object' ? (result as { backgroundOutputPath?: unknown }) : undefined
  if (ok(r?.backgroundOutputPath)) return r.backgroundOutputPath
  const t = (text ?? '').slice(0, 4096)
  const found = [/(?:written to|output (?:file )?(?:is|at)):?\s+(\/\S+\.output)/i.exec(t)?.[1], /(\/[^\s"'`]*\/tasks\/[\w-]+\.output)/.exec(t)?.[1]]
  return found.find(ok)
}

export function baseName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1)
}

// Text from a command is shown on the terminal: drop every escape sequence (CSI, OSC such as the
// clipboard write, DCS and the like, 7- and 8-bit) and every other control character, keeping tab and line breaks.
const ESCAPES = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[\]PX^_][\s\S]*?(?:\x07|\x1b\\|$)|[@-Z\\-_])|\x9b[0-?]*[ -/]*[@-~]|[\x90\x98\x9d\x9e\x9f][\s\S]*?(?:\x07|\x9c|$)|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f‪-‮⁦-⁩]/g
export function clean(text: string) {
  return text.replace(ESCAPES, '')
}

// The last n non-empty lines of an output tail (carriage-return progress included), each cut short.
export function tailLines(text: string, n = 8): string[] {
  return clean(text)
    .split(/[\r\n]+/)
    .map(l => l.trimEnd())
    .filter(l => l.trim() !== '')
    .slice(-n)
    .map(l => l.slice(0, 200))
}

// The tail of each file named, each after a \001 line with its path: one process for all of them.
export const TAILS_SH = `# radar:tails
for f in "$@"; do printf '\\001%s\\n' "$f"; tail -c 16384 -- "$f" 2>/dev/null | LC_ALL=C tr -d '\\001'; done
exit 0
`

// Splits "\001path\n<body>" blocks.
export function blocks(stdout: string): { path: string; body: string }[] {
  return stdout
    .split('\x01')
    .filter(Boolean)
    .map(b => {
      const nl = b.indexOf('\n')
      return nl < 0 ? { path: b.trim(), body: '' } : { path: b.slice(0, nl).trim(), body: b.slice(nl + 1) }
    })
}

// File names `lsof -Fn` reports open, as base names (the task id is unique; /tmp and /private/tmp agree).
export function parseOpen(stdout: string): Set<string> {
  const open = new Set<string>()
  for (const line of stdout.split('\n')) if (line.startsWith('n')) open.add(baseName(line.slice(1).trim()))
  return open
}
