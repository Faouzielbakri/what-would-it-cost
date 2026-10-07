# what-would-it-cost

**What your Claude Code subscription would cost at API prices.**

A [Claude Code mod](https://claude.dev/blog/getting-started-with-claude-code-mods/) that prices every token your session uses at Anthropic's public API rates. The total sits above your prompt the whole time, so you can see what your plan is saving you.

```
◉ $4.12 session ▮▮▮▮▮▮ │ $18.40 today │ $190 7d │ $260 since Sep 28 1.3x Max 20x │ ▂▃▅█▇▄▁▂▅▆▇▃▂▁ ≡ invoice  plan paid off…
```

In color: the little bar after the session total is this session's model mix, and the sparkline is the last 14 days. It updates after every model request while Claude works. Click **≡ invoice** for the full bill:

```
╭──────────────────────────────────────────────────────────────────────╮
│ ≡ INVOICE at API prices                          Max 20x · $200/mo │
│                                                                      │
│ Session  7 days  [ Cycle ]  All time                                 │
│                                                                      │
│ $260                                                1.30x your plan │
│ Sep 28 → Oct 28 · day 10 of 30 · on pace for $780                    │
│                                                                      │
│ ██████████████████████████████████████████████████████████████████ │
│ ● Opus 5.5  1,204 req                                      58% $150 │
│ ● Fable 5.1  402 req                                        35% $90 │
│ ● Opus 5  88 req                                             7% $20 │
│                                                                      │
│ input              $0.40   output                            $41.20 │
│ cache write      $120.10   cache read                        $98.30 │
│ ✓ prompt caching saved you $1,180                                    │
│                                                                      │
│ last 60 days                                            peak $127 │
│ ▁▂▅█▃▁▁▂▄▆▇▂▃▅▁▂▅█▃▁▁▂▄▆▇▂▃▅▁▂▅█▃▁▁▂▄▆▇▂▃▅▁▂▅█▃▁▁▂▄▆▇▂▃▅▁▂▅█▃ │
│ Aug 9                                                         today │
│                                                                      │
│ plan paid off. The rest is on Anthropic.                             │
╰──────────────────────────────────────────────────────────────────────╯
```

The tabs switch the whole card between this **session**, your **7-day** limit window, your **billing cycle** and **all time**, each broken down by model.

**It has your history from the first minute.** On first run it prices every Claude Code transcript already on your disk (`~/.claude/projects`), so you see your past month right away instead of starting from $0. A toast tells you the total when it's done.

```
INVOICE
what this would cost on the API
────────────────────────────────────────────────────────
● Opus 5.5 · 41 requests ··························· $4.12
  input        12.3k x $4/M ························ $0.05
  output       88.1k x $20/M ······················· $1.76
  cache write 210.0k x $5/M ························ $1.05
  cache read    6.3M x $0.2/M ······················ $1.26
────────────────────────────────────────────────────────
SESSION TOTAL ······································ $4.12
prompt caching saved you ·························· $23.10
Claude Code's own /cost ···························· $4.10
────────────────────────────────────────────────────────
today ············································· $18.40
Oct so far ········································· $212
you pay (Max 20x) ································ $200/mo
value multiplier ··································· 1.06x
plan paid off. The rest is on Anthropic.
────────────────────────────────────────────────────────
last 30 days ··▁▂·▅█▃··▁▂▄▆▇▂▃▅·▂▃▁▄▆▅▇█▆▅
```

## Install

In a Claude Code terminal session:

```
/plugin install what-would-it-cost --marketplace Faouzielbakri/what-would-it-cost
```

Answer `y` to add the marketplace, then pick the **user** scope so it runs in every session.

## What it counts

| | |
|---|---|
| **session** | this session's tokens, priced per model, subagents included |
| **today** | every session on this machine, past transcripts included |
| **7d** | your current weekly limit window, from Claude Code's own reset time (else the last 7 days) |
| **since …** | your billing cycle so far, from the day your plan renews |
| **all time** | everything since your oldest transcript, in the invoice |
| **value multiplier** | the billing cycle so far divided by what your plan costs, plus the pace for the full cycle |
| **caching saved you** | what the cache reads would have cost as fresh input |
| **/cost** | Claude Code's own total, as a sanity check |

The dot at the start of the band turns orange while Claude is working. Each invoice line is `tokens x price`, so you can check the math yourself.

## Your plan

It reads your exact plan (Pro, Max 5x or Max 20x) from the rate-limit tier in Claude Code's own config (`~/.claude.json`), falling back to `claude auth status`. To set it yourself, go to `/config` → **what-would-it-cost › Your plan** and pick `pro`, `max-5x`, `max-20x` or `api`.

The multiplier runs over your **billing cycle**, not the calendar month: if you subscribed on the 15th, the cycle runs from the 15th to the 15th. The renewal day is read from when your subscription began; set **Billing day** in `/config` if yours differs (say, after a plan change).

If you're on an API key, the bill is real money. The band shows anyway.

## Prices

List prices per million tokens, from [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (October 2026):

| Model | Input | Output | Cache read | Cache write (5m / 1h) |
|---|---|---|---|---|
| Fable 5.1 | $10 | $50 | $0.25 | $12.50 / $20 |
| Fable 5 | $10 | $50 | $1.00 | $12.50 / $20 |
| Opus 5.5 | $4 | $20 | $0.20 | $5 / $8 |
| Opus 5 / 4.5–4.8 | $5 | $25 | $0.50 | $6.25 / $10 |
| Sonnet 5 / 5.5 | $2 | $10 | $0.20 | $2.50 / $4 |
| Sonnet 4.x | $3 | $15 | $0.30 | $3.75 / $6 |
| Haiku 4.5 | $1 | $5 | $0.10 | $1.25 / $2 |

Caveats:

- History is priced exactly, cache writes split into 5-minute (1.25x input) and 1-hour (2x) as each transcript records them. Live usage doesn't carry that split, so live writes count as 1-hour, which is what Claude Code uses.
- Claude Code deletes transcripts after 30 days by default (`cleanupPeriodDays`), so history only goes back as far as your transcripts do.
- Fast mode isn't detected and is priced as standard.
- A model id the table doesn't know is priced as Opus 5.5 and marked with `?`. PRs that add new models to [`hooks/pricing.ts`](hooks/pricing.ts) are welcome.
- Days are counted in your local time zone.

## Develop

```
claude --plugin-dir ./what-would-it-cost     # run it from a checkout; saving a file hot-reloads it
claude plugin validate ./what-would-it-cost
claude plugin test ./what-would-it-cost
```

## License

MIT
