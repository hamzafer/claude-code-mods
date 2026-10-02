// The "who" view: main, its subagents and their tool calls, as tree lines.
import type { MissionNode } from '../types'

// A short label and a family for one tool call.
export function label(e: Record<string, unknown>): { label: string; family: string } {
  const tool = String(e.tool)
  const s = (k: string) => (typeof e[k] === 'string' ? (e[k] as string) : '')
  const file = (p: string) => p.split('/').slice(-2).join('/')
  if (tool === 'Bash') return { label: s('description') || s('command').slice(0, 60), family: 'bash' }
  if (tool === 'Edit' || tool === 'Write') return { label: file(s('file_path')), family: 'edit' }
  if (tool === 'Read') return { label: file(s('file_path')), family: 'read' }
  if (tool === 'Grep' || tool === 'Glob') return { label: s('pattern').slice(0, 40), family: 'search' }
  if (tool.startsWith('mcp__')) {
    const [, server = '', action = ''] = tool.split('__')
    if (/playwright/.test(server)) return { label: action.replace(/^browser_/, ''), family: 'browser' }
    return { label: action, family: `mcp:${server.replace(/^(plugin_|claude_ai_)/, '').replace(/_.*$/, '')}` }
  }
  return { label: tool, family: tool.toLowerCase() }
}

const ICON: Record<string, string> = { bash: '$', edit: '✎', read: '◉', search: '⌕', browser: '◎' }
export const icon = (n: MissionNode) =>
  n.kind === 'main' ? '◆' : n.kind === 'agent' ? '●' : (ICON[n.family] ?? (n.family.startsWith('mcp:') ? '⌁' : '·'))

export function took(n: Pick<MissionNode, 'start' | 'end'>, at = Date.now()) {
  const s = Math.max(0, ((n.end ?? at) - n.start) / 1000)
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  return `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`
}

export type Line = { prefix: string; node: MissionNode; text: string; count: number; status: MissionNode['status'] }

// Tree lines, depth first. Runs of the same tool family under one parent fold into one
// line ("◎ browser: navigate → click → screenshot ×3") so a busy agent stays readable.
export function lines(nodes: MissionNode[], at = Date.now()): Line[] {
  const kids = new Map<string | null, MissionNode[]>()
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  const out: Line[] = []
  const walk = (parent: string | null, prefix: string) => {
    const groups: MissionNode[][] = []
    for (const n of kids.get(parent) ?? []) {
      const last = groups.at(-1)
      const head = last?.[0]
      if (last && head && n.kind === 'tool' && head.kind === 'tool' && head.family === n.family) last.push(n)
      else groups.push([n])
    }
    groups.forEach((g, i) => {
      const isLast = i === groups.length - 1
      const n = g[0] as MissionNode
      const branch = parent === null ? '' : isLast ? '└─ ' : '├─ '
      const status = g.some(x => x.status === 'running') ? 'running' : g.some(x => x.status === 'failed') ? 'failed' : 'done'
      const start = Math.min(...g.map(x => x.start))
      const end = status === 'running' ? undefined : Math.max(...g.map(x => x.end ?? x.start))
      let text: string
      if (n.kind === 'tool') {
        const name = n.family.startsWith('mcp:') ? n.family.slice(4) : n.family
        const acts = g.map(x => x.label)
        const shown = acts.length > 4 ? [...acts.slice(0, 3), '…', acts.at(-1)] : acts
        const time = took({ start, end }, at)
        text = `${icon(n)} ${name}: ${shown.join(' → ')}${g.length > 1 ? `  ×${g.length}` : ''}${time === '0.0s' ? '' : `  ${time}`}`
      } else {
        const tools = nodes.filter(x => x.parent === n.id && x.kind === 'tool').length
        text = `${icon(n)} ${n.label}  ${took(n, at)}${n.kind === 'agent' ? ` · ${tools} tools` : ''}`
      }
      out.push({ prefix: prefix + branch, node: n, text, count: g.length, status })
      if (n.kind !== 'tool') walk(n.id, parent === null ? '' : prefix + (isLast ? '   ' : '│  '))
    })
  }
  walk(null, '')
  return out
}

export function summary(nodes: MissionNode[]) {
  const agents = nodes.filter(n => n.kind === 'agent')
  const running = agents.filter(n => n.status === 'running').length
  const tools = nodes.filter(n => n.kind === 'tool').length
  const failed = nodes.filter(n => n.kind === 'tool' && n.status === 'failed').length
  return { agents: agents.length, running, tools, failed }
}
