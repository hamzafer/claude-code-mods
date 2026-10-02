// The parts of OneForm's get_today and get_plan answers the line reads.
export type OneFormToday = {
  logical_date: string
  sleep_hours: number | null
  energy: number | null
  soreness: number | null
  stress: number | null
  meals: { description: string; protein_estimate: number; calories_estimate: number }[]
  totals: { calories_estimate: number; protein_estimate: number }
  targets: { calories_kcal: number; protein_g: number; sleep_hours: number }
  remaining: { calories: number; protein: number }
  activities: { name: string; strava_sport_type: string | null; moving_time_s: number }[]
  workout: { status: string; sets_count: number } | null
}

export type OneFormPlanItem = {
  logical_date: string
  type: string
  status: string
  notes: string | null
  satisfied_by: 'status' | 'outcome' | null
}

export type OneFormDay = {
  today: OneFormToday | null
  plan: OneFormPlanItem[]
  // When the last good answer came in, and what went wrong since, if anything.
  fetchedAt: number
  error: 'key' | 'network' | null
}

declare module 'claude-code' {
  interface PluginState {
    'oneform-line': { day: OneFormDay; triedAt: number }
  }
}
