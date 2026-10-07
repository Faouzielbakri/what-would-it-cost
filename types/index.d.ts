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

/** Which period the invoice shows. */
export type Tab = 'session' | 'week' | 'cycle' | 'all'

declare module 'claude-code' {
  interface PluginState {
    'what-would-it-cost': {
      /** This session's models, live. */
      models: Record<string, Tally>
      /** Tallies by local day, then model: history and live together. */
      dayModels: DayTallies
      plan: Plan | null
      /** Day of the month the plan renews (1-31); null until known. */
      billingDay: number | null
      /** When the current 7-day rate-limit window began, from its reset time; null off a subscription. */
      weekStart: number | null
      ledgerUsd: number | null
      history: History | null
      tab: Tab
    }
  }
}
