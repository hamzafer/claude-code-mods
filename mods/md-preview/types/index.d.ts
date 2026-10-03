// A Markdown file Claude changed this session (or one /md <path> opened).
export type MdFile = {
  path: string
  at: number // when it last changed, ms
  marks: number[] // the top-level blocks the last edit changed
  before?: string // the text before the last edit; absent for a new file
}

// One drawing: PNG parts, each at most 250 rows tall, top to bottom.
export type MdFrame = {
  key: string // what was drawn: which files, which versions, single or compare
  columns: number
  parts: { file: string; rows: number }[]
  n: number
  via: 'GitHub' | 'built-in'
} | null

// Two files side by side, from /md compare <a> <b>.
export type MdPair = { a: string; b: string } | null

declare module 'claude-code' {
  interface PluginState {
    'md-preview': {
      files: MdFile[]
      shown: string | null
      pair: MdPair
      compare: boolean
      frame: MdFrame
      view: 'page' | 'text'
      note: string
    }
  }
}
