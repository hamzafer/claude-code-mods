// What glance keeps per source: the items that need you, ranked, and how the last fetch went.
export type Meeting = { title: string; start: number; end: number; url: string }
export type Pr = { repo: string; number: number; title: string; url: string; reason: 'review' | 'ci' | 'changes' }
export type Issue = { id: string; title: string; status: string; url: string; updatedAt: number }
export type Dm = { from: string; text: string; at: number; url: string }

export type Source<T> = {
  items: T[]
  // When the last good answer came in (0: never), and whether the latest try failed.
  fetchedAt: number
  isFailed: boolean
}

declare module 'claude-code' {
  interface PluginState {
    glance: {
      meetings: Source<Meeting>
      prs: Source<Pr>
      issues: Source<Issue>
      dms: Source<Dm>
      triedAt: number
      minute: number
    }
  }
}
