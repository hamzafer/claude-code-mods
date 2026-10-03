export type CacheTtl = '5m' | '1h'
export type TokenWeatherReading = { tokens: number; window: number; percent: number }

declare module 'claude-code' {
  interface PluginState {
    'token-weather': {
      readings: TokenWeatherReading[]
      // When the last main-thread model request finished, in ms since the epoch; null before the first.
      lastRequestAt: number | null
      // The cache lifetime Claude's responses last showed; null until one wrote to the cache.
      detectedTtl: CacheTtl | null
    }
  }
}
