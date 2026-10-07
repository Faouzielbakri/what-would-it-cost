import type { Plan, Tally } from '../types'

/** US dollars per million tokens. Cache writes bill at 1.25x input (5-minute) or 2x (1-hour). */
export type Price = { input: number; output: number; cacheRead: number }

// Anthropic first-party list prices, checked 2026-10. Most specific id first.
export const PRICES: ReadonlyArray<readonly [RegExp, string, Price]> = [
  [/fable-5-1|mythos-5-1/, 'Fable 5.1', { input: 10, output: 50, cacheRead: 0.25 }],
  [/fable-5|mythos-5/, 'Fable 5', { input: 10, output: 50, cacheRead: 1 }],
  [/opus-5-5/, 'Opus 5.5', { input: 4, output: 20, cacheRead: 0.2 }],
  [/opus-5/, 'Opus 5', { input: 5, output: 25, cacheRead: 0.5 }],
  [/opus-4-[5-8]/, 'Opus 4.x', { input: 5, output: 25, cacheRead: 0.5 }],
  [/opus-4/, 'Opus 4', { input: 15, output: 75, cacheRead: 1.5 }],
  [/sonnet-5/, 'Sonnet 5.x', { input: 2, output: 10, cacheRead: 0.2 }],
  [/sonnet-4|sonnet-3-7/, 'Sonnet 4.x', { input: 3, output: 15, cacheRead: 0.3 }],
  [/haiku-4/, 'Haiku 4.5', { input: 1, output: 5, cacheRead: 0.1 }],
  [/haiku-3-5/, 'Haiku 3.5', { input: 0.8, output: 4, cacheRead: 0.08 }],
]

const OPUS_5_5: Price = { input: 4, output: 20, cacheRead: 0.2 }

export const WRITE_5M = 1.25
export const WRITE_1H = 2

/** The price row for a model id as the API reports it (`claude-opus-5-5[1m]`, a Bedrock id, a dated id). */
export const priceOf = (model: string): { label: string; price: Price; isKnown: boolean } => {
  const row = PRICES.find(([pattern]) => pattern.test(model))
  // An id this table does not know yet is billed as the current Opus, and marked.
  return row ? { label: row[1], price: row[2], isKnown: true } : { label: model, price: OPUS_5_5, isKnown: false }
}

/** The model family's color, for bars and labels. */
export const colorOf = (model: string): string =>
  /fable|mythos/.test(model)
    ? '#b197fc'
    : /opus/.test(model)
      ? '#ff8c5a'
      : /sonnet/.test(model)
        ? '#4dabf7'
        : /haiku/.test(model)
          ? '#69db7c'
          : '#adb5bd'

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  /** The write split by cache lifetime, where the record has it (transcripts do; live usage does not). */
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

export const EMPTY: Tally = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, turns: 0 }

/** A tally as stored, every count a number: one saved by an older version reads as zeros where it lacks a field. */
export const sound = (t: Partial<Tally> | undefined): Tally => ({
  input: Number(t?.input) || 0,
  output: Number(t?.output) || 0,
  cacheRead: Number(t?.cacheRead) || 0,
  cacheWrite5m: Number(t?.cacheWrite5m) || 0,
  cacheWrite1h: (Number(t?.cacheWrite1h) || 0) + (Number((t as { cacheWrite?: number } | undefined)?.cacheWrite) || 0),
  turns: Number(t?.turns) || 0,
})

export const addUsage = (stored: Tally, usage: Usage): Tally => {
  const tally = sound(stored)
  const split = usage.cache_creation
  // Claude Code writes its prompt cache with the 1-hour lifetime, so an unsplit write counts as one.
  const write5m = split ? (split.ephemeral_5m_input_tokens ?? 0) : 0
  const write1h = split ? (split.ephemeral_1h_input_tokens ?? 0) : usage.cache_creation_input_tokens
  return {
    input: tally.input + usage.input_tokens,
    output: tally.output + usage.output_tokens,
    cacheRead: tally.cacheRead + usage.cache_read_input_tokens,
    cacheWrite5m: tally.cacheWrite5m + write5m,
    cacheWrite1h: tally.cacheWrite1h + write1h,
    turns: tally.turns + 1,
  }
}

export const addTallies = (x: Tally, y: Tally): Tally => {
  const [a, b] = [sound(x), sound(y)]
  return {
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
  cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
    turns: a.turns + b.turns,
  }
}

export const mergeModels = (...maps: Record<string, Tally>[]): Record<string, Tally> => {
  const merged: Record<string, Tally> = {}
  for (const map of maps) {
    for (const [model, t] of Object.entries(map)) merged[model] = addTallies(merged[model] ?? EMPTY, t)
  }
  return merged
}

/** Each line of the bill for one model, in dollars. */
export const billOf = (model: string, stored: Tally) => {
  const { price } = priceOf(model)
  const t = sound(stored)
  const input = (t.input * price.input) / 1e6
  const output = (t.output * price.output) / 1e6
  const cacheWrite = ((t.cacheWrite5m * WRITE_5M + t.cacheWrite1h * WRITE_1H) * price.input) / 1e6
  const cacheRead = (t.cacheRead * price.cacheRead) / 1e6
  const saved = (t.cacheRead * (price.input - price.cacheRead)) / 1e6
  return { input, output, cacheWrite, cacheRead, total: input + output + cacheWrite + cacheRead, saved }
}

export const costOf = (model: string, usage: Usage) => billOf(model, addUsage(EMPTY, usage)).total

export const sumOf = (byModel: Record<string, Tally>) =>
  Object.entries(byModel).reduce((sum, [model, t]) => sum + billOf(model, t).total, 0)

export const PLANS: Record<string, Plan> = {
  pro: { label: 'Pro', usd: 20 },
  'max-5x': { label: 'Max 5x', usd: 100 },
  'max-20x': { label: 'Max 20x', usd: 200 },
  api: { label: 'API', usd: null },
}

/** The plan from Claude Code's own config (`~/.claude.json`): its rate-limit tier names it exactly. */
export const planFromConfig = (json: string): Plan | null => {
  try {
    const account = (JSON.parse(json) as { oauthAccount?: Record<string, unknown> }).oauthAccount
    if (!account) return null
    const tier = String(account.userRateLimitTier ?? account.organizationRateLimitTier ?? '').toLowerCase()
    if (tier.includes('max_20x')) return PLANS['max-20x'] ?? null
    if (tier.includes('max_5x')) return PLANS['max-5x'] ?? null
    if (tier.includes('pro')) return PLANS.pro ?? null
    return null
  } catch {
    return null
  }
}

/** The day of the month the subscription renews, from when it began (`oauthAccount.subscriptionCreatedAt`). */
export const billingDayFromConfig = (json: string): number | null => {
  try {
    const began = (JSON.parse(json) as { oauthAccount?: { subscriptionCreatedAt?: string } }).oauthAccount
      ?.subscriptionCreatedAt
    const ms = Date.parse(began ?? '')
    return Number.isNaN(ms) ? null : new Date(ms).getDate()
  } catch {
    return null
  }
}

/** When the billing cycle holding `now` began: the last renewal on `day`, a short month renewing on its last day. */
export const cycleStart = (now: number, day: number): number => {
  const at = (year: number, month: number) =>
    new Date(year, month, Math.min(day, new Date(year, month + 1, 0).getDate())).getTime()
  const d = new Date(now)
  const thisMonth = at(d.getFullYear(), d.getMonth())
  return thisMonth <= now ? thisMonth : at(d.getFullYear(), d.getMonth() - 1)
}

/** When that cycle ends: the next renewal. */
export const cycleEnd = (start: number, day: number): number => {
  const d = new Date(start)
  return new Date(d.getFullYear(), d.getMonth() + 1, Math.min(day, new Date(d.getFullYear(), d.getMonth() + 2, 0).getDate())).getTime()
}

/** Dollars from the day holding `startMs` through the day holding `now`. */
export const sumSince = (byDay: Record<string, number>, startMs: number, now: number): number => {
  const [from, to] = [dayKey(startMs), dayKey(now)]
  return Object.entries(byDay).reduce((sum, [day, v]) => (day >= from && day <= to ? sum + v : sum), 0)
}

/** The plan `claude auth status` reports, from its JSON (it says `max`, not which Max). */
export const planFromAuth = (json: string): Plan | null => {
  try {
    const auth = JSON.parse(json) as { authMethod?: string; subscriptionType?: string | null }
    if (auth.authMethod !== 'claude.ai') return PLANS.api ?? null
    const kind = (auth.subscriptionType ?? '').toLowerCase()
    if (kind === 'max') return PLANS['max-20x'] ?? null
    return PLANS[kind] ?? (kind === '' ? null : { label: kind.charAt(0).toUpperCase() + kind.slice(1), usd: null })
  } catch {
    return null
  }
}

export const usd = (n: number): string =>
  n >= 10_000
    ? `$${(n / 1000).toFixed(1)}k`
    : n >= 100
      ? `$${Math.round(n).toLocaleString('en-US')}`
      : `$${n.toFixed(2)}`

export const tokens = (n: number): string =>
  n >= 1e9
    ? `${(n / 1e9).toFixed(1)}B`
    : n >= 1e6
      ? `${(n / 1e6).toFixed(1)}M`
      : n >= 1e3
        ? `${(n / 1e3).toFixed(1)}k`
        : String(n)

export const dayKey = (ms: number): string => {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const BARS = '▁▂▃▄▅▆▇█'

/** One width-1 glyph per day, oldest first, scaled to the busiest day. */
export const sparkline = (values: readonly number[]): string => {
  const top = Math.max(...values, 0)
  return values.map(v => (v <= 0 ? '·' : BARS.charAt(Math.min(7, Math.floor((v / top) * 7.999))))).join('')
}

/** Teal for a quiet day through gold to hot orange for the busiest, as 0xRRGGBB. */
export const heat = (share: number): number => {
  const stops = [
    [0x3b, 0xc9, 0xdb],
    [0xfc, 0xc4, 0x19],
    [0xff, 0x6b, 0x2c],
  ] as const
  const t = Math.max(0, Math.min(1, share)) * 2
  const [a, b] = t < 1 ? [stops[0], stops[1]] : [stops[1], stops[2]]
  const f = t < 1 ? t : t - 1
  const mix = (i: 0 | 1 | 2) => Math.round(a[i] + (b[i] - a[i]) * f)
  return (mix(0) << 16) | (mix(1) << 8) | mix(2)
}

export const hex = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`

type DayModels = Record<string, Record<string, Tally>>

/** Each model's tally over the days from `from` through `to` (day keys, inclusive). */
export const modelsBetween = (dayModels: DayModels, from: string, to: string): Record<string, Tally> =>
  mergeModels(...Object.entries(dayModels).flatMap(([day, byModel]) => (day >= from && day <= to ? [byModel] : [])))

/** Dollars per day. */
export const dayTotals = (dayModels: DayModels): Record<string, number> =>
  Object.fromEntries(Object.entries(dayModels).map(([day, byModel]) => [day, sumOf(byModel)]))

/** Two day-by-model maps added together. */
export const addDayModels = (a: DayModels, b: DayModels): DayModels => {
  const sum: DayModels = { ...a }
  for (const [day, byModel] of Object.entries(b)) sum[day] = mergeModels(sum[day] ?? {}, byModel)
  return sum
}
