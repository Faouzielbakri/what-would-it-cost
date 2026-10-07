import type { EngineInterface, Register } from 'claude-code'

import type { History, Plan, Tab, Tally } from '../types'
import { addTranscript, emptyTotals } from './history'
import type { DayModels } from './history'
import {
  BARS,
  EMPTY,
  PLANS,
  addDayModels,
  addUsage,
  billOf,
  billingDayFromConfig,
  colorOf,
  cycleEnd,
  cycleStart,
  dayKey,
  dayTotals,
  heat,
  modelsBetween,
  planFromAuth,
  planFromConfig,
  priceOf,
  sound,
  sparkline,
  sumOf,
  sumSince,
  usd,
} from './pricing'
import type { Usage } from './pricing'
import { cacheQuip, emptyQuip, historyToast, readingQuip, verdict } from './quips'

const PANE = 'what-would-it-cost'
const DAYS_KEPT = 400
const DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const STALE_KEYS = ['cutoff', 'history', 'days', 'liveDays', 'historyDays', 'liveModels', 'historyModels']
const READ_LIMIT = 4_000_000
const CHUNK_MB = 3

const ORANGE = '#ff8c5a'
const GOLD = '#fcc419'
const TEAL = '#3bc9db'
const AMBER = '#ffa94d'
const GREEN = '#51cf66'
const GREY = '#868e96'

// The session's drawn values (see types/index.d.ts).
const MODELS = { plugin: 'what-would-it-cost', key: 'models' } as const
const DAY_MODELS = { plugin: 'what-would-it-cost', key: 'dayModels' } as const
const PLAN = { plugin: 'what-would-it-cost', key: 'plan' } as const
const BILLING_DAY = { plugin: 'what-would-it-cost', key: 'billingDay' } as const
const WEEK_START = { plugin: 'what-would-it-cost', key: 'weekStart' } as const
const LEDGER = { plugin: 'what-would-it-cost', key: 'ledgerUsd' } as const
const HISTORY = { plugin: 'what-would-it-cost', key: 'history' } as const
const TAB = { plugin: 'what-would-it-cost', key: 'tab' } as const

type Models = Record<string, Tally>

const lastDays = (byDay: Record<string, number>, now: number, count: number) =>
  Array.from({ length: count }, (_, i) => byDay[dayKey(now - (count - 1 - i) * DAY)] ?? 0)

const short = (ms: number) => `${MONTHS[new Date(ms).getMonth()]} ${new Date(ms).getDate()}`

/** A bar chart `rows` tall, one column per value, colored by how busy the day was (a Raster's cells). */
const chartCells = (values: readonly number[], rows: number): string => {
  const top = Math.max(...values, 0)
  const words = new Uint32Array(values.length * rows * 3)
  for (let row = 0; row < rows; row++) {
    const level = rows - 1 - row
    values.forEach((v, col) => {
      const eighths = top > 0 ? Math.round((v / top) * rows * 8) : 0
      const fill = Math.max(0, Math.min(8, eighths - level * 8))
      const isFloor = level === 0 && v <= 0
      const at = (row * values.length + col) * 3
      words[at] = isFloor ? 0x00b7 : fill === 0 ? 0x20 : BARS.charCodeAt(fill - 1)
      words[at + 1] = isFloor ? 0x495057 : heat(top > 0 ? v / top : 0)
      words[at + 2] = 0x01000000
    })
  }
  return (new Uint8Array(words.buffer) as unknown as { toBase64: () => string }).toBase64()
}

/** Each model's share of `width` cells, the biggest first, every model with a cost getting at least one. */
const shares = (byModel: Models, width: number) => {
  const rows = Object.entries(byModel)
    .map(([model, t]) => ({ model, cost: billOf(model, t).total, t: sound(t) }))
    .filter(row => row.cost > 0)
    .sort((a, b) => b.cost - a.cost)
  const total = rows.reduce((sum, row) => sum + row.cost, 0)
  let left = width
  return rows.map((row, i) => {
    const cells =
      i === rows.length - 1
        ? left
        : Math.max(1, Math.min(left - (rows.length - 1 - i), Math.round((row.cost / total) * width)))
    left -= cells
    return { ...row, cells: Math.max(0, cells), share: total > 0 ? row.cost / total : 0 }
  })
}

/** Every value the band and the invoice draw from; read while drawing, so a change redraws them. */
async function snapshot($: EngineInterface) {
  const [models, dayModels, plan, billingDay, weekStart, ledger, history, tab] = await Promise.all([
    $.state.get(MODELS),
    $.state.get(DAY_MODELS),
    $.state.get(PLAN),
    $.state.get(BILLING_DAY),
    $.state.get(WEEK_START),
    $.state.get(LEDGER),
    $.state.get(HISTORY),
    $.state.get(TAB),
  ])
  return {
    models: models.value ?? {},
    dayModels: dayModels.value ?? {},
    plan: plan.value ?? null,
    billingDay: billingDay.value ?? null,
    weekStart: weekStart.value ?? null,
    ledger: ledger.value ?? null,
    history: history.value ?? null,
    tab: tab.value ?? 'cycle',
  }
}

/** A day-by-model map kept in the store under `key`, empty when absent. */
async function storedDays($: EngineInterface, key: string): Promise<DayModels> {
  const value = await $.store.get(key)
  return (value as DayModels | undefined) ?? {}
}

/** Where Claude Code keeps its config: $CLAUDE_CONFIG_DIR, else ~/.claude. */
async function configDir($: EngineInterface): Promise<string> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  return custom ?? `${home ?? '~'}/.claude`
}

/** Re-reads history and live tallies from the store into the drawn state. */
async function refresh($: EngineInterface) {
  const past = await storedDays($, 'v2.historyDayModels')
  const live = await storedDays($, 'v2.liveDayModels')
  await $.state.set(DAY_MODELS, addDayModels(past, live))
}

/** The engine's own /cost total (a cross-check) and the 7-day limit window, from the status line's figures. */
async function readUsage($: EngineInterface) {
  let usage
  try {
    usage = await $.session.usage()
  } catch {
    return
  }
  await $.state.set(LEDGER, usage.cost?.usd ?? null)
  const resets = Date.parse(usage.rateLimits.find(limit => limit.kind === 'seven_day')?.resetsAt ?? '')
  if (!Number.isNaN(resets)) await $.state.set(WEEK_START, resets - 7 * DAY)
}

/** One model request's usage onto the session and the day, and the engine's figures re-read. */
async function account($: EngineInterface, usage: Usage & { model: string }) {
  const model = usage.model || 'unknown'
  const today = dayKey(await $.clock.now())

  const session = (await $.state.get(MODELS)).value ?? {}
  await $.state.set(MODELS, { ...session, [model]: addUsage(session[model] ?? EMPTY, usage) })

  // Re-read the store so sessions running side by side add up instead of overwriting.
  const live = await storedDays($, 'v2.liveDayModels')
  const kept: DayModels = Object.fromEntries(
    Object.keys(live)
      .sort()
      .slice(-DAYS_KEPT)
      .map(day => [day, live[day] ?? {}]),
  )
  const byModel = (kept[today] ??= {})
  byModel[model] = addUsage(byModel[model] ?? EMPTY, usage)
  await $.store.set('v2.liveDayModels', kept)
  await refresh($)
  await readUsage($)
}

/** Reads one transcript into `text` pieces that end on whole lines; past the read limit, in `dd` chunks. */
async function* linesOf($: EngineInterface, path: string, size: number): AsyncGenerator<string> {
  if (size <= READ_LIMIT) {
    yield String(await $.fs.read(path))
    return
  }
  let carry = ''
  for (let skip = 0; skip * 1_048_576 < size; skip += CHUNK_MB) {
    const ran = await $.process.run(['dd', `if=${path}`, 'bs=1048576', `skip=${skip}`, `count=${CHUNK_MB}`], {
      timeoutMs: 30_000,
    })
    if (ran.exitCode !== 0) return
    const text = carry + ran.stdout
    const end = text.lastIndexOf('\n')
    carry = end === -1 ? text : text.slice(end + 1)
    if (end !== -1) yield text.slice(0, end)
  }
  if (carry) yield carry
}

/** Every transcript under `dir`: each project's sessions and their subagents. */
async function transcriptsIn($: EngineInterface, dir: string, depth: number): Promise<{ path: string; size: number }[]> {
  let entries
  try {
    entries = await $.fs.list(dir)
  } catch {
    return []
  }
  const files: { path: string; size: number }[] = []
  for (const entry of entries) {
    const path = `${dir}/${entry.name}`
    if (entry.kind === 'file' && entry.name.endsWith('.jsonl')) files.push({ path, size: entry.size })
    else if (entry.kind === 'dir' && depth < 3) files.push(...(await transcriptsIn($, path, depth + 1)))
  }
  return files
}

/** First run: price every transcript already on disk, so the band has a past from the start. */
async function readPast($: EngineInterface, cutoff: number) {
  const reading = (filesDone: number, files: number): History => ({ status: 'reading', filesDone, files, requests: 0 })
  await $.state.set(HISTORY, reading(0, 0))
  try {
    const files = await transcriptsIn($, `${await configDir($)}/projects`, 0)
    const totals = emptyTotals()
    const seen = new Set<string>()
    let done = 0
    for (const file of files) {
      try {
        for await (const text of linesOf($, file.path, file.size)) addTranscript(text, totals, seen, cutoff)
      } catch {
        // One unreadable transcript costs only itself.
      }
      done += 1
      if (done % 5 === 0 || done === files.length) await $.state.set(HISTORY, reading(done, files.length))
    }

    const finished: History = { status: 'done', filesDone: 0, files: 0, requests: totals.requests }
    await $.store.set('v2.historyDayModels', totals.dayModels)
    await $.store.set('v2.history', finished)
    await $.state.set(HISTORY, finished)
    await refresh($)
    const total = Object.values(dayTotals(totals.dayModels)).reduce((a, b) => a + b, 0)
    $.ui.toast(historyToast(totals.requests, total))
  } catch {
    await $.state.set(HISTORY, { status: 'failed', filesDone: 0, files: 0, requests: 0 })
  }
}

/** The plan and its renewal day: Claude Code's own config names both; else `claude auth status` names the plan. */
async function findAccount($: EngineInterface): Promise<{ plan: Plan | null; day: number | null }> {
  const custom = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = await $.env.get('HOME')
  const path = custom ? `${custom}/.claude.json` : `${home ?? '~'}/.claude.json`
  let text = ''
  try {
    text = String(await $.fs.read(path))
  } catch {
    // No config file: the plan comes from `claude auth status` below.
  }
  const day = billingDayFromConfig(text)
  const fromConfig = planFromConfig(text)
  if (fromConfig) return { plan: fromConfig, day }
  try {
    const ran = await $.process.run(['claude', 'auth', 'status'], { timeoutMs: 15_000 })
    return { plan: ran.exitCode === 0 ? planFromAuth(ran.stdout) : null, day }
  } catch {
    return { plan: null, day }
  }
}

/** Fills in the plan and renewal day the person did not set themselves. */
async function settleAccount($: EngineInterface, isPlanAuto: boolean, isDayAuto: boolean) {
  await readUsage($)
  // Both set in /config: nothing to look up, and ~/.claude.json is never opened.
  if (!isPlanAuto && !isDayAuto) return
  const found = await findAccount($)
  if (isPlanAuto) await $.state.set(PLAN, found.plan)
  if (isDayAuto) await $.state.set(BILLING_DAY, found.day ?? 1)
}

async function openInvoice($: EngineInterface) {
  await $.ui.open({ id: PANE, title: 'Invoice' })
}

const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['session', 'Session'],
  ['week', '7 days'],
  ['cycle', 'Cycle'],
  ['all', 'All time'],
]

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    // Responses before the first run belong to history; from then on, to the live counter.
    let cutoff = (await $.store.get('v2.cutoff')) as number | undefined
    if (cutoff === undefined) {
      cutoff = await $.clock.now()
      await $.store.set('v2.cutoff', cutoff)
      for (const key of STALE_KEYS) await $.store.delete(key)
    }
    await refresh($)

    const past = (await $.store.get('v2.history')) as History | undefined
    const from = cutoff
    if (past?.status === 'done') await $.state.set(HISTORY, past)
    else $.clock.after(100, () => void readPast($, from))

    // Other Claude Code sessions add to the same store: pick their requests up as they land.
    $.clock.every(30_000, () => void refresh($))

    const chosen = String(options.plan ?? 'auto')
    const day = Math.round(Number(options.billingDay ?? 0))
    const isDayAuto = !(day >= 1 && day <= 31)
    if (chosen !== 'auto') await $.state.set(PLAN, PLANS[chosen] ?? null)
    if (!isDayAuto) await $.state.set(BILLING_DAY, day)
    $.clock.after(100, () => void settleAccount($, chosen === 'auto', isDayAuto))

    return next(e)
  })

  // Every model request, subagents' included, the moment it ends: the band moves while Claude works.
  on('turn.step', async function* ($, e, next) {
    const step = yield* next(e)
    if (step.usage) await account($, step.usage)

    return step
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const drawn = await snapshot($)
    const sessionModels = drawn.models
    const byDay = dayTotals(drawn.dayModels)
    const p = drawn.plan
    const past = drawn.history
    const start = cycleStart(now, drawn.billingDay ?? 1)
    const cycle = sumSince(byDay, start, now)
    const week = sumSince(byDay, drawn.weekStart ?? now - 6 * DAY, now)
    const ratio = p?.usd ? cycle / p.usd : null
    const fortnight = lastDays(byDay, now, 14)
    const mix = shares(sessionModels, 6)

    let trend
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      trend = <Raster key="trend" columns={fortnight.length} rows={1} cells={chartCells(fortnight, 1)} />
    } else {
      trend = <Text color={TEAL}>{sparkline(fortnight)}</Text>
    }

    return (
      <Box key="band" flexDirection="row">
        <Text wrap="truncate-end">
          <Text color={e.props.isWorking ? ORANGE : GREY} bold>
            {e.props.isWorking ? '◉ ' : '◎ '}
          </Text>
          <Text color={ORANGE} bold>
            {usd(sumOf(sessionModels))}
          </Text>
          <Text dimColor> session </Text>
          {mix.map(row => (
            <Text color={colorOf(row.model)}>{'▮'.repeat(row.cells)}</Text>
          ))}
          <Text dimColor>{mix.length > 0 ? ' │ ' : '│ '}</Text>
          <Text color={GOLD} bold>
            {usd(byDay[dayKey(now)] ?? 0)}
          </Text>
          <Text dimColor> today │ </Text>
          <Text color={AMBER} bold>
            {usd(week)}
          </Text>
          <Text dimColor> 7d │ </Text>
          <Text color={TEAL} bold>
            {usd(cycle)}
          </Text>
          <Text dimColor> since {short(start)} </Text>
          {ratio !== null && (
            <Text color={ratio >= 1 ? GREEN : GOLD} bold>
              {ratio.toFixed(ratio < 10 ? 1 : 0)}x{' '}
            </Text>
          )}
          {p?.usd != null && <Text dimColor>{p.label} </Text>}
          <Text dimColor>│ </Text>
        </Text>
        {trend}
        <Text> </Text>
        <Button key="invoice" label="≡ invoice" plain hover={{ color: ORANGE }} onPress={() => void openInvoice($)} />
        <Box flexShrink={1}>
          {past?.status === 'reading' ? (
            <Text color={TEAL} wrap="truncate-end">
              {'  '}⟳ {readingQuip(now)} {past.filesDone}/{past.files || '…'}
            </Text>
          ) : (
            <Text dimColor italic wrap="truncate-end">
              {'  '}
              {verdict(cycle, p, now)}
            </Text>
          )}
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const outer = Math.max(40, Math.min(72, (e.props.bodyColumns ?? 72) - 1))
    const inner = outer - 4
    const now = await $.clock.now()
    const today = dayKey(now)
    const drawn = await snapshot($)
    const sessionModels = drawn.models
    const allDays = drawn.dayModels
    const byDay = dayTotals(allDays)
    const p = drawn.plan
    const ledger = drawn.ledger
    const past = drawn.history
    const chosen = drawn.tab
    const renews = drawn.billingDay ?? 1
    const start = cycleStart(now, renews)
    const end = cycleEnd(start, renews)
    const limitWeek = drawn.weekStart
    const firstDay = Object.keys(allDays).sort()[0] ?? today

    const scope: Models =
      chosen === 'session'
        ? sessionModels
        : chosen === 'week'
          ? modelsBetween(allDays, dayKey(limitWeek ?? now - 6 * DAY), today)
          : chosen === 'cycle'
            ? modelsBetween(allDays, dayKey(start), today)
            : modelsBetween(allDays, firstDay, today)
    const rows = shares(scope, inner)
    const total = rows.reduce((sum, row) => sum + row.cost, 0)
    const requests = rows.reduce((sum, row) => sum + row.t.turns, 0)
    const lines = rows.reduce(
      (sum, row) => {
        const bill = billOf(row.model, row.t)
        return {
          input: sum.input + bill.input,
          output: sum.output + bill.output,
          write: sum.write + bill.cacheWrite,
          read: sum.read + bill.cacheRead,
          saved: sum.saved + bill.saved,
        }
      },
      { input: 0, output: 0, write: 0, read: 0, saved: 0 },
    )

    const elapsed = Math.max(1, Math.ceil((now - start) / DAY))
    const length = Math.round((end - start) / DAY)
    const ratio = chosen === 'cycle' && p?.usd ? total / p.usd : null
    const subtitle =
      chosen === 'session'
        ? `this session · ${requests.toLocaleString('en-US')} requests`
        : chosen === 'week'
          ? limitWeek === null
            ? `last 7 days · ${requests.toLocaleString('en-US')} requests`
            : `weekly limit window · ${short(limitWeek)} → ${short(limitWeek + 7 * DAY)}`
          : chosen === 'cycle'
            ? `${short(start)} → ${short(end)} · day ${elapsed} of ${length} · on pace for ${usd((total / elapsed) * length)}`
            : `since ${short(new Date(`${firstDay}T12:00`).getTime())} · ${requests.toLocaleString('en-US')} requests`

    const span = Math.min(inner, 60)
    const chartDays = lastDays(byDay, now, span)
    let chart
    if (e.surface === 'terminal') {
      const { Raster } = $.ui.resolve(e)
      chart = <Raster key="chart" columns={span} rows={4} cells={chartCells(chartDays, 4)} />
    } else {
      chart = <Text color={TEAL}>{sparkline(chartDays)}</Text>
    }

    const split = (label: string, value: number) => (
      <Box width={Math.floor(inner / 2)} justifyContent="space-between" paddingRight={2}>
        <Text dimColor>{label}</Text>
        <Text>{usd(value)}</Text>
      </Box>
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={ORANGE} paddingX={1} width={outer}>
          <Box justifyContent="space-between">
            <Text>
              <Text color={ORANGE} bold>
                ≡ INVOICE
              </Text>
              <Text dimColor> at API prices</Text>
            </Text>
            <Text dimColor>{p ? (p.usd ? `${p.label} · $${p.usd}/mo` : p.label) : ''}</Text>
          </Box>
          <Text> </Text>

          <Box flexDirection="row" gap={2}>
            {TABS.map(([id, label]) =>
              id === chosen ? (
                <Button key={`tab-${id}`} label={label} variant="primary" onPress={() => void $.state.set(TAB, id)} />
              ) : (
                <Button key={`tab-${id}`} label={label} plain dimColor onPress={() => void $.state.set(TAB, id)} />
              ),
            )}
          </Box>
          <Text> </Text>

          <Box justifyContent="space-between">
            <Text color={ORANGE} bold>
              {usd(total)}
            </Text>
            {ratio !== null && (
              <Text color={ratio >= 1 ? GREEN : GOLD} bold>
                {ratio.toFixed(2)}x your plan
              </Text>
            )}
          </Box>
          <Text dimColor>{subtitle}</Text>
          {past?.status === 'reading' && chosen !== 'session' && (
            <Text color={TEAL}>
              ⟳ {readingQuip(now)} {past.filesDone}/{past.files || '…'}
            </Text>
          )}
          <Text> </Text>

          {rows.length === 0 ? (
            <Text dimColor>{emptyQuip(now)}</Text>
          ) : (
            <Text>
              {rows.map(row => (
                <Text color={colorOf(row.model)}>{'█'.repeat(row.cells)}</Text>
              ))}
            </Text>
          )}
          {rows.map(row => (
            <Box key={row.model} justifyContent="space-between">
              <Text>
                <Text color={colorOf(row.model)}>● </Text>
                <Text bold>{priceOf(row.model).label}</Text>
                <Text dimColor>
                  {'  '}
                  {row.t.turns.toLocaleString('en-US')} req
                </Text>
              </Text>
              <Text>
                <Text dimColor>{Math.round(row.share * 100)}% </Text>
                <Text bold>{usd(row.cost)}</Text>
              </Text>
            </Box>
          ))}
          <Text> </Text>

          <Box flexDirection="row">
            {split('input', lines.input)}
            {split('output', lines.output)}
          </Box>
          <Box flexDirection="row">
            {split('cache write', lines.write)}
            {split('cache read', lines.read)}
          </Box>
          {lines.saved > 0 && <Text color={GREEN}>{cacheQuip(lines.saved, now)}</Text>}
          {chosen === 'session' && ledger !== null && (
            <Text dimColor>Claude Code's own /cost says {usd(ledger)}. We checked.</Text>
          )}
          <Text> </Text>

          <Box justifyContent="space-between" width={span}>
            <Text dimColor>last {span} days</Text>
            <Text dimColor>peak {usd(Math.max(...chartDays, 0))}</Text>
          </Box>
          {chart}
          <Box justifyContent="space-between" width={span}>
            <Text dimColor>{short(now - (span - 1) * DAY)}</Text>
            <Text dimColor>today</Text>
          </Box>
          <Text> </Text>
          <Text italic color={GOLD}>
            {verdict(sumSince(byDay, start, now), p, now)}
          </Text>
        </Box>
        <Box justifyContent="flex-end" width={outer}>
          <Button key="close" label="close" role="dismiss" plain dimColor onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
