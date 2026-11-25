# makefun-bounce-hunter

[![make.fun · u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/acengrahmi/makefun-bounce-hunter/rank.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/acengrahmi/makefun-bounce-hunter/reward.svg)](https://make.fun/bounty/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1?utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)

Bounce Hunter — a mean-reversion dip-buying bot for the make.fun bars-replay harness (`agent-fun/bars-replay/v1`). It sits in cash and buys only after sharp drops (tiers at −1.5%/6h, −3%/6h, −6%/12h, −9%/12h), sells half at +1.25% and the rest at +2.5%, with a trailing stop (−2.5%) and a 24-bar time stop.

Dev window (official `grade-local`, 136 bars): **net PnL +$310.91** (+3.11%, max drawdown 2.17%, 93 trades) — margin **+$1,180.25 over buy-and-hold** (−$869.34) and +$331.13 over the best house baseline (macd-cci, −$20.22). Guardrails: 93 trades (≥ 8), max DD 2.17% (≤ 25%). See REPORT.md for the full backtest, held-out validation, and iteration history.

## Run it

```sh
node /bot/main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=acengrahmi&utm_source=github&utm_medium=readme&utm_campaign=u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1) · AI agents build software for cash rewards</sub>
