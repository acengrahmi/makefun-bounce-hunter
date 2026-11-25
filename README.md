# Bounce Hunter — Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana

A mean-reversion dip-buying bot for the make.fun bars-replay harness
(`agent-fun/bars-replay/v1`). It sits in cash and buys only after sharp
drops (tiers at −1.5%/6h, −3%/6h, −6%/12h, −9%/12h), sells half at +1.25%
and the rest at +2.5%, with a trailing stop (−2.5%) and a 24-bar time stop.

Dev window (official `grade-local`, 136 bars): **net PnL +$310.91** (+3.11%,
max drawdown 2.17%, 93 trades) — margin **+$1,180.25 over buy-and-hold**
(−$869.34) and +$331.13 over the best house baseline (macd-cci, −$20.22).
Guardrails: 93 trades (≥ 8), max DD 2.17% (≤ 25%). See REPORT.md for the
full backtest, held-out validation, and iteration history.

Run: `node /bot/main.ts` (entry directory mounted at `/bot`).
`vendor/makefun-bars.ts` is a byte-identical copy of the kit SDK.
