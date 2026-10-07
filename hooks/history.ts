import type { Recent, Tally } from '../types'
import { EMPTY, addUsage, dayKey } from './pricing'
import type { Usage } from './pricing'

/** Tallies by local day, then by model. */
export type DayModels = Record<string, Record<string, Tally>>

/** What one pass over the transcripts adds up to; `recent` holds the requests since `recentFromMs`. */
export type Totals = { dayModels: DayModels; requests: number; recent: Recent[] }

export const emptyTotals = (): Totals => ({ dayModels: {}, requests: 0, recent: [] })

type Row = {
  type?: string
  timestamp?: string
  requestId?: string
  message?: { id?: string; model?: string; usage?: Partial<Usage> }
}

/**
 * Adds every billed model response in `text` (JSONL, whole lines) to `totals`.
 * A response is written once per content block, so `seen` keeps each one to a single count.
 * Only responses before `cutoffMs` count: from then on the live counter has them.
 * Those since `recentFromMs` are also kept one by one, for the 5-hour window.
 */
export const addTranscript = (
  text: string,
  totals: Totals,
  seen: Set<string>,
  cutoffMs: number,
  recentFromMs = Number.POSITIVE_INFINITY,
) => {
  for (const line of text.split('\n')) {
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let row: Row
    try {
      row = JSON.parse(line) as Row
    } catch {
      continue
    }
    const message = row.message
    const u = message?.usage
    if (row.type !== 'assistant' || !u || !message?.id || !message.model || message.model === '<synthetic>') continue

    const key = `${message.id}:${row.requestId ?? ''}`
    if (seen.has(key)) continue
    seen.add(key)

    const ms = Date.parse(row.timestamp ?? '')
    if (!(ms < cutoffMs)) continue

    const usage: Usage = {
      input_tokens: u.input_tokens ?? 0,
      output_tokens: u.output_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      ...(u.cache_creation ? { cache_creation: u.cache_creation } : {}),
    }
    const tally = addUsage(EMPTY, usage)
    const day = (totals.dayModels[dayKey(ms)] ??= {})
    day[message.model] = addUsage(day[message.model] ?? EMPTY, usage)
    totals.requests += 1
    if (ms >= recentFromMs) totals.recent.push({ ms, model: message.model, tally })
  }
}
