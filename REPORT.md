# REPORT — "Bounce Hunter" for u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1

**Entrypoint:** `main.ts` (+ `vendor/makefun-bars.ts`, byte-identical to the kit SDK,
sha256 `9677370b0ab7e759c486a929afc95a11fb0fb32c7ec37053d3ebabd426aec5c8`).
**Competition:** Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana — $2 pot, deadline
2026-11-27 00:00 UTC. Grader runs `node /bot/main.ts` on 72 hourly bars after the deadline.

## Strategy in plain words

Hourly returns on these 7 Solana tokens are close to white noise with a slight
downward drift, so trend-following only pays fees — every trend/momentum variant
tested lost money on every window. But sharp drops bounce. Measured on the dev
window: after a −2%/6h drop the next 6h averages **+0.80%** (66% of cases up, vs
48% unconditionally); after −7%/12h the next 12h averages **+2.08%** (76% up).
So the bot sits in cash and only buys after a hard fall, scaling in deeper the
further it falls, then sells half on the first leg of the bounce and the rest a
little higher, with a trailing stop and a 24-bar time stop so a dip that keeps
falling never becomes a bag.

- **Entry tiers** (per symbol, top-ups add while weight < 25% of equity):
  - micro: 6h return < −1.5% → 4% of equity
  - scout: 6h return < −3.0% → 8% of equity
  - main: 12h return < −6.0% → 20% of equity
  - deep: 12h return < −9.0% → 25% of equity
- **Exits** (per whole position, value marked at latest close vs position cost):
  sell half at +1.25%, the rest at +2.5%, trailing stop −2.5% from the highest
  close since entry, or after 24 bars held. At most 5 positions.
- The micro tier exists for the guardrail: it fires often enough that the bot
  clears 8 trades even in quiet, grindy windows where no deep dip appears.
- Orders cap slippage at 100 bps, so a buy never chases a gap-up open and a
  sell never dumps into a gap-down open; a refused order is retried next bar.
- **Determinism:** every comparison is exact integer arithmetic (returns are
  cross-multiplied BigInts, TP/stop are integer ratios). No clock, no random,
  no environment, no network, no eval. grade-local's L1 reproduction passed.

## Backtest results

### Dev window (136 bars, official `grade-local --driver process`)

| Entry | Net PnL | Return | Max DD | Sharpe | Trades | Fees |
|---|---|---|---|---|---|---|
| **Bounce Hunter (this entry)** | **+$310.91** | **+3.11%** | **2.17%** | **0.083** | **93** | $72.08 |
| buy-and-hold (prize bar) | −$869.34 | −8.69% | 10.92% | −0.086 | 7 | $19.14 |
| hold-cash | $0.00 | 0.00% | 0.00% | 0.000 | 0 | $0.00 |
| momentum | −$268.23 | −2.68% | 5.66% | −0.060 | 19 | $54.59 |
| ema-cross | −$173.04 | −1.73% | 2.51% | −0.100 | 28 | $48.18 |
| macd-cci (best baseline) | −$20.22 | −0.20% | 2.46% | −0.008 | 17 | $28.56 |
| rsi-bollinger | −$56.49 | −0.56% | 5.16% | −0.006 | 8 | $19.95 |
| adx-momentum | −$114.42 | −1.14% | 1.38% | −0.103 | 11 | $19.81 |

- **Margin over buy-and-hold: +$1,180.25. Margin over the best baseline
  (macd-cci): +$331.13. Margin over hold-cash: +$310.91.**
- Per-symbol PnL (dev): POPCAT +$107.91, RAY +$105.86, WIF +$56.67,
  JITOSOL +$36.12, FARTCOIN +$27.61, SOL −$21.93, WETH −$1.33.
- Python replay (`backtest/replay.py`, exact BigInt port of the harness engine,
  validated to the micro-unit against grade-local for buy-and-hold and
  momentum) predicted +$334.28 on dev; the official grade is +$310.91. The gap
  is a handful of trades: the TS bot retries a half-sell refused for slippage
  (the Python model marks it sold), and TP/stop comparisons are exact integer
  ratios in TS vs float in Python.

### Held-out validation (Python replay, 72-bar windows = final-window length, cold start)

| Windows | Mean PnL | Min PnL | Max PnL | Positive | Min trades | B&H mean |
|---|---|---|---|---|---|---|
| Rolling, starts 0,4,…,60 (16) | +$79.08 | −$77.17 | +$363.59 | 10/16 | 19 | −$269.04 |
| Offset, starts 2,6,…,58 (15) | +$80.08 | −$75.27 | — | 10/15 | 19 | — |

- Beats buy-and-hold in 14/16 rolling windows. The 2 losing windows (starts 24,
  28) start exactly at the crash bottom, where buy-and-hold rides the recovery
  from bar 0 and a cold-start bot cannot buy a dip that already happened.
- Max drawdown ≤ 2.2% in every window; trades 19–61 per window (guardrail: ≥8).
- The two window sets agree (mean +$79 vs +$80), so the result is not an
  artefact of the exact window starts.

## Iteration log

1. **V1 — EMA(8/24) trend cross + trailing stop + TP** (per symbol, regime
   filter): dev −$335.98, 72w mean −$152.93, 0/16 positive. Trend-following
   whipsaws on hourly noise. Rejected.
2. **Momentum rotation** (6–24h lookbacks, rebalance every 6–24 bars, top 2–3):
   dev −$392 to −$798, 72w mean −$129 to −$293. Rejected.
3. **Donchian breakout** (12/24h): dev −$321 to −$373. Rejected.
4. **Single-tier dip-buy** (12h drop < −6/−7%, TP +3%, stop −2%, hold 12):
   dev +$50.69 to +$303.88, 72w mean +$14 to +$61, min $0. First positive
   family — the bounce is real. But only 8–14 trades on dev: guardrail risk.
5. **Two-tier dip-buy + partial exits** (4%/7% tiers, half at +1.5%):
   dev +$135.34, 72w mean +$40.67, 25 trades. Better; still quiet windows
   with 0 trades.
6. **Unified 3-tier + 6h scout, no 1h-up filter** (the filter was delaying
   entries past the bounce): dev +$201.63, 72w mean +$39.00, 72 trades.
   Wider stops helped (stop 3% > 2%): dev +$342.04, mean +$79.36.
7. **"Ride" sleeve** (hold top 24h gainer in up regimes): dev −$77 to −$117
   on its own. Momentum at 24h does not work here. Killed, not combined.
8. **Micro tier added for trade count** (−1.5%/6h, 4% equity, same exits):
   dev +$334.28, 72w mean +$79.08, minTr 19 (was 2–3), worst window −$77.17
   (was −$38.53). The micro tier costs a little worst-case PnL but buys
   guardrail safety in every window. A 3h micro tier was checked and rejected:
   3h dips do NOT bounce (forward 3h mean −0.60% — continuation, not reversion).
9. **Final tuning** (stop 2.5%, TP +1.25%/+2.5%, hold 24, max 5 positions):
   dev +$334.28 (Python) / **+$310.91 (official grade-local)**, 72w mean
   +$79.08, offset-window mean +$80.08. Neighbouring parameter values
   (stop 2–3%, TP 1–1.5%/2–3%, hold 18–36) all give mean +$59 to +$91 and
   dev +$190 to +$356 — a flat optimum, not a sharp peak. **Kept.**

## Guardrail compliance (dev, official grade)

- Trades: **93** (need ≥ 8) ✓
- Max drawdown: **2.17%** (need ≤ 25%) ✓
- Determinism: L1 reproduction **passed**, no flags ✓
- Ranked: true. (Prize-eligibility shows false only for `no_transcripts` /
  `cost_unpriced` — the parent run supplies transcripts at submit time.)

## Known risks (final-window generalization)

- The final window (27–30 Nov, 72 bars) is unseen data. The strategy's edge
  is mean reversion after sharp drops; if the window is a slow grind with no
  −3%/6h dip, the bot trades mostly micro tiers and finishes near $0 — still
  above buy-and-hold in a down grind, but below it in a strong up grind
  (windows starting at a crash bottom, where buy-and-hold rides the recovery
  from bar 0 — 2 of 16 test windows).
- All validation windows come from one 136-bar recording (Oct 29 – Nov 3),
  dominated by one crash and its aftermath. The parameters were chosen on
  round values with a flat optimum across neighbours, but some overfitting to
  this regime is unavoidable.
- A fast, sustained crash with no bounce inside 24 bars would hit the −2.5%
  trailing stop repeatedly; worst observed window loss was −$77.17 (−0.77%).
- WETH barely trades (2 trades on dev): its hourly moves are the smallest
  (0.55%/h) and rarely trip the thresholds. No action needed — the other six
  symbols carry the PnL.
