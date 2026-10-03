// A Markdown file Claude changed this session (or one /md <path> opened).
export type MdFile = {
  path: string
  at: number // when it last changed, ms
  marks: number[] // the top-level blocks the last edit changed
}

// One drawing of a file: PNG parts, each at most 250 rows tall, top to bottom.
export type MdFrame = {
  path: string
  at: number // the MdFile.at it was drawn from
  columns: number
  parts: { file: string; rows: number }[]
  n: number
  via: 'GitHub' | 'built-in'
} | null

declare module 'claude-code' {
  interface PluginState {
    'md-preview': {
      files: MdFile[]
      shown: string | null
      frame: MdFrame
      view: 'page' | 'text'
      note: string
    }
  }
}
