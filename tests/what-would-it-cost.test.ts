import { describe, expect, mock, test } from 'claude-code/testing'

import { addTranscript, emptyTotals } from '../hooks/history'
import { verdict } from '../hooks/quips'
import {
  billOf,
  billingDayFromConfig,
  costOf,
  cycleEnd,
  cycleStart,
  heat,
  planFromAuth,
  planFromConfig,
  priceOf,
  sound,
  sparkline,
  sumOf,
  sumSince,
  usd,
} from '../hooks/pricing'

// 2026-10-07 at noon, local time.
const NOON = new Date(2026, 9, 7, 12).getTime()

const USAGE = {
  model: 'claude-opus-5-5[1m]',
  input_tokens: 1_000,
  output_tokens: 100_000,
  cache_read_input_tokens: 5_000_000,
  cache_creation_input_tokens: 200_000,
}

describe('pricing', () => {
  test('prices each line the way the API bills it; an unsplit write is a 1-hour write', () => {
    // 1k x $4 + 100k x $20 + 5M x $0.20 + 200k x $8 (2 x $4)
    expect(Math.round(costOf('claude-opus-5-5', USAGE) * 1e6)).toBe(4_604_000)
    const split = { ...USAGE, cache_creation: { ephemeral_5m_input_tokens: 200_000, ephemeral_1h_input_tokens: 0 } }
    expect(Math.round(costOf('claude-opus-5-5', split) * 1e6)).toBe(4_004_000)
    const bill = billOf('claude-opus-5-5', {
      input: 0,
      output: 0,
      cacheRead: 1e6,
      cacheWrite5m: 0,
      cacheWrite1h: 0,
      turns: 1,
    })
    expect(Math.round(bill.saved * 1e6)).toBe(3_800_000)
  })

  test('finds the row for dated, 1M and Bedrock ids, most specific first', () => {
    expect(priceOf('claude-opus-5-5[1m]').label).toBe('Opus 5.5')
    expect(priceOf('claude-opus-5').label).toBe('Opus 5')
    expect(priceOf('us.anthropic.claude-sonnet-4-6').label).toBe('Sonnet 4.x')
    expect(priceOf('claude-haiku-4-5-20251001').label).toBe('Haiku 4.5')
    expect(priceOf('claude-fable-5-1').price.cacheRead).toBe(0.25)
    expect(priceOf('some-future-model').isKnown).toBe(false)
  })

  test('names the exact plan from the rate-limit tier, else from claude auth status', () => {
    const config = (tier: string) => JSON.stringify({ oauthAccount: { organizationRateLimitTier: tier } })
    expect(planFromConfig(config('default_claude_max_20x'))?.label).toBe('Max 20x')
    expect(planFromConfig(config('default_claude_max_5x'))?.usd).toBe(100)
    expect(planFromConfig('{}')).toBeNull()
    expect(planFromAuth('{"authMethod":"claude.ai","subscriptionType":"pro"}')?.usd).toBe(20)
    expect(planFromAuth('{"authMethod":"apiKey"}')?.label).toBe('API')
    expect(planFromAuth('not json')).toBeNull()
  })

  test('formats money, draws a sparkline and heats colors', () => {
    expect(usd(4.004)).toBe('$4.00')
    expect(usd(1307.49)).toBe('$1,307')
    expect(sparkline([0, 1, 8])).toBe('·▁█')
    expect(heat(0)).toBe(0x3bc9db)
    expect(heat(1)).toBe(0xff6b2c)
  })
})

describe('billing cycle', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

  test('starts on the last renewal, a short month renewing on its last day', () => {
    expect(cycleStart(at(2026, 10, 7), 28)).toBe(at(2026, 9, 28, 0))
    expect(cycleStart(at(2026, 10, 29), 28)).toBe(at(2026, 10, 28, 0))
    expect(cycleStart(at(2026, 10, 15), 15)).toBe(at(2026, 10, 15, 0))
    expect(cycleStart(at(2026, 3, 5), 31)).toBe(at(2026, 2, 28, 0))
    expect(cycleEnd(at(2026, 9, 28, 0), 28)).toBe(at(2026, 10, 28, 0))
    expect(cycleEnd(at(2026, 1, 31, 0), 31)).toBe(at(2026, 2, 28, 0))
  })

  test('reads the renewal day from when the subscription began', () => {
    const local = new Date(2026, 1, 28, 12).toISOString()
    expect(billingDayFromConfig(JSON.stringify({ oauthAccount: { subscriptionCreatedAt: local } }))).toBe(28)
    expect(billingDayFromConfig('{}')).toBeNull()
  })

  test('sums whole days from the start through today', () => {
    const days = { '2026-09-27': 1, '2026-09-28': 2, '2026-10-07': 4, '2026-10-08': 8 }
    expect(sumSince(days, at(2026, 9, 28, 0), at(2026, 10, 7))).toBe(6)
  })

  test('a tally an older version saved still adds up', () => {
    const old = { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, turns: 1 } as never
    expect(sound(old).cacheWrite1h).toBe(4)
    expect(Number.isNaN(billOf('claude-opus-5-5', old).total)).toBe(false)
  })
})

describe('quips', () => {
  const max = { label: 'Max 20x', usd: 200 }

  test('a line holds for ten minutes, then rotates, and fills in the numbers', () => {
    expect(verdict(260, max, NOON)).toBe(verdict(260, max, NOON + 60_000))
    const lines = new Set(Array.from({ length: 40 }, (_, i) => verdict(260, max, NOON + i * 600_000)))
    expect(lines.size).toBeGreaterThan(2)
    for (const line of lines) expect(line).not.toMatch(/\{\w+\}/)
    expect(Array.from(lines).some(line => line.includes('$60') || line.includes('1.3x'))).toBe(true)
  })

  test('every tier has something to say', () => {
    for (const spent of [0, 50, 150, 300, 1000, 5000]) expect(verdict(spent, max, NOON).length).toBeGreaterThan(10)
    expect(verdict(5, { label: 'API', usd: null }, NOON).length).toBeGreaterThan(10)
  })
})

describe('history', () => {
  const line = (id: string, ts: string, usage: object, model = 'claude-opus-5-5') =>
    JSON.stringify({ type: 'assistant', timestamp: ts, requestId: `req_${id}`, message: { id, model, usage } })
  const usage = {
    input_tokens: 10,
    output_tokens: 1_000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  }

  test('counts each response once, skips what the live counter owns, and junk', () => {
    const before = new Date(2026, 9, 6, 9).toISOString()
    const after = new Date(2026, 9, 7, 13).toISOString()
    const text = [
      line('a', before, usage),
      line('a', before, usage), // the same response, written for its second content block
      line('b', before, usage, 'claude-fable-5-1'),
      line('c', after, usage), // after the cutoff: live
      line('d', before, usage, '<synthetic>'),
      '{"type":"user","message":{"content":"usage"}}',
      'not json "usage" "assistant"',
    ].join('\n')

    const totals = emptyTotals()
    addTranscript(text, totals, new Set(), NOON)

    expect(totals.requests).toBe(2)
    const day = totals.dayModels['2026-10-06'] ?? {}
    expect(Object.keys(day).sort()).toEqual(['claude-fable-5-1', 'claude-opus-5-5'])
    // opus: 10 x $4 + 1k x $20; fable: 10 x $10 + 1k x $50
    expect(Math.round(sumOf(day) * 1e6)).toBe(20_040 + 50_100)
  })
})

test('history and each request land on the band; the invoice opens', { options: { plan: 'max-20x', billingDay: 28 } }, async ($, on) => {
  mock.clock(on, { now: NOON })
  mock.env(on, { HOME: '/home/test' })
  // $150 of Fable on Oct 1: 3M output tokens at $50/M.
  const fable = { input: 0, output: 3_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, turns: 3 }
  mock.store(on, {
    'v2.cutoff': NOON - 1,
    'v2.history': { status: 'done', filesDone: 0, files: 0, requests: 3 },
    'v2.historyDayModels': { '2026-10-01': { 'claude-fable-5-1': fable } },
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const resetsAt = new Date(NOON + 2 * 86_400_000).toISOString()
  on(
    'session.usage',
    () => ({ value: { startedAt: NOON, context: {}, rateLimits: [{ kind: 'seven_day', percentUsed: 40, resetsAt }], cost: { usd: 4.6 } } }) as never,
  )
  on('turn.step', async function* () {
    return { turnId: 't1', answer: 'done', toolUses: [], stopReason: 'end_turn', usage: USAGE } as never
  })
  const opened: string[] = []
  on('ui.open', (_, e) => (opened.push(e.id), { value: { isOpen: true } }) as never)

  await $.session.start({ cwd: '/tmp', source: 'startup' } as never)
  for await (const _ of $.turn.step({ turnId: 't1', model: 'claude-opus-5-5' } as never)) {
    // the stream's pieces are not what this test reads
  }

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'what-would-it-cost',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true, maxRows: 10, bodyColumns: 140 } as never,
    })
    expect(await band.find({ type: 'Text', text: /^\$4\.60$/ })).toBeDefined()
    // The cycle since Sep 28: $150 of history + $4.60 now, against $200; the limit week began Oct 2.
    expect(await band.find({ type: 'Text', text: /^\$155$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /since Sep 28/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /0\.8x/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^\$4\.60$/ })).toBeDefined()
    await band.press({ key: 'invoice' })
    await band.unmount()

    const pane = await $.ui.mount({
      plugin: 'what-would-it-cost',
      surface,
      component: 'Pane',
      requestId: 'what-would-it-cost',
      props: { bodyColumns: 72 } as never,
    })
    // The cycle tab first: both models, Fable the bigger.
    expect(await pane.find({ type: 'Text', text: /^\$155$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /0\.77x your plan/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /Sep 28 → Oct 28 · day 10 of 30/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Fable 5\.1$/ })).toBeDefined()

    await pane.press({ key: 'tab-session' })
    expect(await pane.find({ type: 'Text', text: /this session · 1 requests/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^Fable 5\.1$/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /\/cost says \$4\.60\. We checked\./ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /♻ .*\$19\.00/ })).toBeDefined()

    await pane.press({ key: 'tab-week' })
    expect(await pane.find({ type: 'Text', text: /weekly limit window · Oct 2 → Oct 9/ })).toBeDefined()
    await pane.press({ key: 'tab-cycle' })
    await pane.unmount()
  }
  expect(opened).toEqual(['what-would-it-cost', 'what-would-it-cost'])
})
