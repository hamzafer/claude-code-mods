export type SnakeScores = { score: number; best: number }

declare module 'claude-code' {
  interface PluginState {
    'snake': { isPlaying: boolean; score: number; best: number; isOn: boolean }
  }
}
