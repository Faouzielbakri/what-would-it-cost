import type { Plan } from '../types'
import { usd } from './pricing'

// `{over}` what Anthropic covers past the plan, `{left}` what is left to break even, `{x}` the multiple.
const VERDICTS = {
  realMoney: [
    'this one is real money. Breathe.',
    'every token here is a tiny invoice.',
    'your accountant just felt a chill.',
    'no plan, no mercy. Pay-as-you-go hits different.',
  ],
  idle: [
    'paying for a gym you never visit.',
    'the buffet is open. You ordered water.',
    'Anthropic thanks you for your generous donation.',
    'your plan is bored. Give it something to do.',
  ],
  warming: [
    'warming up. {left} until the plan pays for itself.',
    'Anthropic is winning this round. For now.',
    '{left} of plan left on the table. Eat up.',
    'still in the shallow end of the pool.',
  ],
  close: [
    '{left} away from free food.',
    'almost broke even. The plan is sweating.',
    'so close you can smell the free tokens.',
    'one big refactor from break-even.',
  ],
  paidOff: [
    'plan paid off. Anthropic is now covering {over}.',
    'break-even achieved. Everything else is on the house.',
    "{x}x what you paid. The chef is getting nervous.",
    'Anthropic is picking up the tab: {over} so far.',
    "you've made your money back. Now it's just showing off.",
  ],
  heavy: [
    'Anthropic is quietly funding your startup ({over} and counting).',
    'a VC would call this a {x}x return.',
    'somewhere, a GPU is filing a complaint.',
    '{over} on the house. Someone in finance just sighed.',
    'this plan is the best deal since free refills.',
  ],
  absurd: [
    'you are why they have weekly limits.',
    "{x}x. Anthropic's finance team knows your name.",
    "this isn't a subscription, it's a heist.",
    '{over} of compute, $200 of guilt. Fair trade.',
    'the datacenter dims the lights when you log in.',
  ],
} as const

const CACHE = [
  '♻ caching spared you {s} of déjà vu',
  '♻ {s} of tokens Claude remembered instead of rereading',
  '♻ the cache knocked {s} off. Rereading is cheap, apparently.',
  '♻ {s} saved by not reading the same files again',
]

const EMPTY = ['Nothing billed yet. Suspiciously frugal.', 'Nothing here yet. Ask Claude something expensive.']

const READING = ['digging through your receipts', 'adding up your past sins', 'pricing your history']

/** A stable pick from `options`: the same for ten minutes, then the next, so a redraw never flickers. */
export const pick = (options: readonly string[], now: number, salt = 0): string => {
  let seed = Math.floor(now / 600_000) * 31 + salt
  seed = (seed ^ (seed >>> 13)) * 1_274_126_177
  return options[Math.abs(seed ^ (seed >>> 16)) % options.length] ?? options[0] ?? ''
}

const fill = (line: string, values: Record<string, string>) =>
  line.replace(/\{(\w+)\}/g, (all, name: string) => values[name] ?? all)

/** How the billing cycle compares with the plan, in one line of opinion. */
export const verdict = (cycleUsd: number, plan: Plan | null, now: number): string => {
  if (plan === null || plan.usd === null) {
    return plan?.label === 'API' ? pick(VERDICTS.realMoney, now) : 'the meter is running.'
  }
  const ratio = cycleUsd / plan.usd
  const tier =
    ratio < 0.1
      ? VERDICTS.idle
      : ratio < 0.5
        ? VERDICTS.warming
        : ratio < 1
          ? VERDICTS.close
          : ratio < 3
            ? VERDICTS.paidOff
            : ratio < 10
              ? VERDICTS.heavy
              : VERDICTS.absurd
  return fill(pick(tier, now, 1), {
    over: usd(Math.max(0, cycleUsd - plan.usd)),
    left: usd(Math.max(0, plan.usd - cycleUsd)),
    x: ratio.toFixed(ratio < 10 ? 1 : 0),
  }).replace('$200', usd(plan.usd))
}

export const cacheQuip = (saved: number, now: number) => fill(pick(CACHE, now, 2), { s: usd(saved) })

export const emptyQuip = (now: number) => pick(EMPTY, now, 3)

export const readingQuip = (now: number) => pick(READING, now, 4)

export const historyToast = (requests: number, total: number) =>
  `what-would-it-cost: found ${requests.toLocaleString('en-US')} past requests. At API prices you'd owe ${usd(total)}. You don't. Enjoy.`
