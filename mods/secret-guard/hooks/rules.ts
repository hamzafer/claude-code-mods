// The built-in rules: a small set of high-confidence patterns, so secret-guard works with
// nothing installed. gitleaks, when present, adds its 150+ rules on top (scan.ts).
// Every pattern is linear (no nested quantifiers), so a 4 MB tool output can't stall it.

export type Finding = { kind: string; secret: string }

type Rule = { kind: string; re: RegExp; group?: number }

export const RULES: readonly Rule[] = [
  { kind: 'private key', re: /-----BEGIN[A-Z ]{0,20} PRIVATE KEY(?: BLOCK)?-----[\s\S]{20,8000}?-----END[A-Z ]{0,20} PRIVATE KEY(?: BLOCK)?-----/g },
  { kind: 'AWS access key', re: /\b(?:AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g },
  { kind: 'GitHub token', re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{60,255})\b/g },
  { kind: 'GitLab token', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { kind: 'Anthropic API key', re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9_-]{80,}/g },
  { kind: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}T3BlbkFJ[A-Za-z0-9_-]{20,}/g },
  { kind: 'OpenAI API key', re: /\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_-]{40,}/g },
  { kind: 'OpenRouter API key', re: /\bsk-or-v1-[a-f0-9]{64}\b/g },
  { kind: 'Stripe key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { kind: 'Slack token', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'Slack webhook', re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}/g },
  { kind: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'npm token', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'Hugging Face token', re: /\bhf_[A-Za-z]{34}\b/g },
  { kind: 'SendGrid key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/g },
  { kind: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  // A connection string's password: postgres://user:PASSWORD@host
  { kind: 'password in a URL', re: /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@]{1,64}:([^\s@/]{6,128})@[\w.-]+/g, group: 1 },
  // .env style: SOME_SECRET=value, as `cat .env`, `env` and `printenv` print it.
  {
    kind: 'secret in an env variable',
    re: /^[ \t]*(?:export[ \t]+)?[A-Z0-9_]{0,60}(?:SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY|CREDENTIALS?)[A-Z0-9_]{0,60}[ \t]*=[ \t]*["']?([^\s"'#]{8,})/gm,
    group: 1,
  },
]

// Values that look like secrets but are placeholders or references.
const PLACEHOLDER = /^(?:\$|<|\{\{|%|your[-_]|changeme|example|dummy|placeholder|redacted|xxx|\*\*\*|true$|false$|null$|none$|[0-9.]+$|https?:\/\/[^@]*$)|\[hidden by secret-guard/i

// A value that is code, not a secret: `settings.KEY`, `getenv(...)`, `os.environ[`.
const CODE = /^[A-Za-z_][\w]*(?:\.[A-Za-z_][\w]*)+$|[(\[]/

export function builtin(text: string): Finding[] {
  const out: Finding[] = []
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    for (const m of text.matchAll(rule.re)) {
      const secret = m[rule.group ?? 0]
      if (secret === undefined || PLACEHOLDER.test(secret) || /(.)\1{7,}/.test(secret) || CODE.test(secret)) continue
      out.push({ kind: rule.kind, secret })
    }
  }
  return out
}

export const MARKER = '[hidden by secret-guard'

// Each secret replaced by a label naming its kind. Longest first, so a secret that
// contains another is replaced whole.
export function redact(text: string, findings: readonly Finding[]): string {
  let out = text
  for (const f of [...findings].sort((a, b) => b.secret.length - a.secret.length)) {
    if (f.secret.length < 6) continue
    out = out.split(f.secret).join(`${MARKER}: ${f.kind}]`)
  }
  return out
}

// One finding per distinct secret.
export function unique(findings: readonly Finding[]): Finding[] {
  const seen = new Map<string, Finding>()
  for (const f of findings) if (!seen.has(f.secret)) seen.set(f.secret, f)
  return [...seen.values()]
}

// "a GitHub token", "2 AWS access keys and a JWT": kinds only, never values.
export function describe(findings: readonly Finding[]): string {
  const counts = new Map<string, number>()
  for (const f of findings) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1)
  const parts = [...counts].map(([kind, n]) => (n === 1 ? `${/^[aeiouAEIOU]/.test(kind) ? 'an' : 'a'} ${kind}` : `${n} ${kind}s`))
  return parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`
}

// Every string in a tool's record mapped through f, the shape kept. Image data is skipped.
export function mapStrings<T>(value: T, f: (s: string) => string): T {
  if (typeof value === 'string') return f(value) as T
  if (Array.isArray(value)) return value.map(v => mapStrings(v, f)) as T
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = k === 'base64' ? v : mapStrings(v, f)
    return out as T
  }
  return value
}

// The lines a diff adds, each with the file it lands in.
export function addedLines(diff: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = []
  let file = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '')
    else if (line.startsWith('+')) out.push({ file, text: line.slice(1) })
  }
  return out
}
