/** Tokens one model used, as the API bills them. */
export type Tally = {
  input: number
  output: number
  cacheRead: number
  /** Cache writes at the 5-minute lifetime (1.25x input). */
  cacheWrite5m: number
  /** Cache writes at the 1-hour lifetime (2x input), what Claude Code uses. */
  cacheWrite1h: number
  /** Model requests billed (one turn makes several). */
  turns: number
}

/** What the person pays per month; `usd` null on pay-as-you-go (the bill is real). */
export type Plan = { label: string; usd: number | null }

/** The first-run read of the transcripts already on disk. */
export type History = {
  status: 'reading' | 'done' | 'failed'
  filesDone: number
  files: number
  requests: number
}

/** Tallies by local day, then model. */
export type DayTallies = Record<string, Record<string, Tally>>

/** One model request, kept on its own for the hours a limit window spans. */
export type Recent = { ms: number; model: string; tally: Tally }

/** Which period the invoice shows. */
export type Tab = 'window' | 'week' | 'cycle' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'what-would-it-cost': {
      /** Each model's tally inside the current 5-hour limit window, across every session. */
      models: Record<string, Tally>
      /** When the current 5-hour limit window began, from its reset time; null off a subscription. */
      windowStart: number | null
      /** Tallies by local day, then model: history and live together. */
      dayModels: DayTallies
      plan: Plan | null
      /** Day of the month the plan renews (1-31); null until known. */
      billingDay: number | null
      /** When the current 7-day rate-limit window began, from its reset time; null off a subscription. */
      weekStart: number | null
      history: History | null
      tab: Tab
    }
  }
}
