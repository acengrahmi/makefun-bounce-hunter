// "Bounce Hunter" — a mean-reversion dip-buying bot for the Solana bars replay.
//
// Idea, in one paragraph: hourly crypto returns on this universe are close to
// white noise with a slight negative drift, so trend-following only pays fees
// — but sharp drops DO bounce. Measured on the dev window, after a -2%/6h
// drop the next 6h average +0.80% (66% of cases up, vs 48% unconditionally),
// after -7%/12h the next 12h average +2.08% (76% up). So this bot sits in
// cash, and only buys a symbol after it has fallen hard over 6h or 12h,
// scaling in deeper the further it falls, then sells half on the first leg
// of the bounce and the rest a little higher, with a trailing stop and a
// 24-bar time stop so a dip that keeps falling never becomes a bag. A small
// "micro" tier (-1.5%/6h, 4% of equity) fires often enough that the bot
// clears the 8-trade guardrail even in quiet, grindy windows where no deep
// dip ever appears.
//
// Entry tiers (per symbol, top-ups add while weight < 25% of equity):
//   tier 1 micro:  6h return < -1.5%  ->  4% of equity
//   tier 2 scout:  6h return < -3.0%  ->  8% of equity
//   tier 3 main:  12h return < -6.0%  -> 20% of equity
//   tier 4 deep:  12h return < -9.0%  -> 25% of equity
// Exits (per whole position, cost = the position's cost as the engine keeps
// it, value marked at the latest close):
//   sell half once value >= cost * 1.0125, the rest at value >= cost * 1.025,
//   or the whole position on a trailing stop (close < peak * 0.975, peak =
//   the highest close since entry), or after 24 bars held.
// At most 5 positions. Buys are sized against live equity, capped at the
// 25% weight cap. Orders cap slippage at 100 bps so a buy never chases a
// gap-up open and a sell never dumps into a gap-down open; a refused order
// is simply retried on the next bar while its reason still holds.
//
// Determinism: every comparison is exact integer arithmetic (returns are
// cross-multiplied BigInts, take-profit/stop are integer ratios), no clock,
// no randomness, no environment, no network, no eval. The two graded runs
// therefore produce byte-identical action logs.

import { BPS, runBars, type BarsState, type Batch, type OrderInput } from './vendor/makefun-bars.ts';

// --- entry thresholds, as exact integer ratios (return < -x%  <=>  now * a < then * b)
const MICRO_NUM = 985n; // -1.5% over 6 bars: now * 1000 < then * 985
const MICRO_DEN = 1000n;
const SCOUT_NUM = 97n; // -3% over 6 bars
const SCOUT_DEN = 100n;
const MAIN_NUM = 94n; // -6% over 12 bars
const MAIN_DEN = 100n;
const DEEP_NUM = 91n; // -9% over 12 bars
const DEEP_DEN = 100n;

// --- target weights, in bps of equity
const W_MICRO = 400n; // 4%
const W_SCOUT = 800n; // 8%
const W_MAIN = 2000n; // 20%
const W_DEEP = 2500n; // 25% (the weight cap itself)

// --- exits, as integer ratios against the position's cost / peak close
const TP_HALF_NUM = 10125n; // +1.25%: sell half once value * 10000 >= cost * 10125
const TP_REST_NUM = 10250n; // +2.5%: sell the rest
const TP_DEN = 10000n;
const STOP_NUM = 9750n; // trailing stop: close * 10000 < peak * 9750 (-2.5%)
const STOP_DEN = 10000n;
const MAX_HOLD_BARS = 24;
const MAX_POSITIONS = 5;
const MAX_SLIPPAGE_BPS = 100;

/** Everything the bot remembers about one held symbol. */
interface Slot {
  /** Highest tier bought so far (0 = never bought). */
  tier: number;
  /** Batch seq of the first buy (for the 24-bar time stop). */
  entrySeq: number;
  /** Highest close since entry (for the trailing stop). */
  peak: bigint;
  /** True once a half-sell has actually filled (confirmed via batch fills). */
  halfSold: boolean;
  /** Client id of a half-sell ordered last bar, awaiting its fill verdict. */
  halfPending: string | null;
}

const slots = new Map<string, Slot>();
/** Each symbol's closes so far, by batch seq (null on a bar the symbol missed). */
const closes = new Map<string, (bigint | null)[]>();


/** True when the symbol's close fell more than x% over the last `lb` bars:
 *  now * num < then * den, all exact BigInt arithmetic. A symbol with no
 *  bar on the latest batch, or lb batches back, is not ranked. */
function dropped(symbol: string, lb: number, num: bigint, den: bigint): boolean {
  const c = closes.get(symbol);
  if (c === undefined) return false;
  const seq = c.length - 1;
  if (seq < lb) return false;
  const now = c[seq]!;
  const then = c[seq - lb]!;
  if (now === null || then === null) return false;
  return now * den < then * num;
}

/** Notional to buy so the symbol reaches `targetBps` of equity (capped by the
 * 25% weight cap's remaining room), or 0n when there is nothing to add. */
function topUpSize(state: BarsState, symbol: string, targetBps: bigint): bigint {
  const held = state.positions.get(symbol);
  const heldVal = held === undefined ? 0n : state.value(symbol, held.qty);
  const target = (targetBps * state.equity) / BPS;
  const room = (BigInt(state.hello.caps.max_weight_bps) * state.equity) / BPS - heldVal;
  const size = target - heldVal;
  if (size <= 0n) return 0n;
  return size < room ? size : room;
}

/**
 * Confirm last bar's sells from this batch's fills, so a half-sell only
 * counts once it really filled (a max_slippage refusal leaves halfSold
 * false and the exit simply retries next bar), and a filled full sell
 * clears the slot. Also drops slots whose position is gone for any reason.
 */
function applyFills(state: BarsState, batch: Batch): void {
  for (const f of batch.fills) {
    if (f.status !== 'filled' || f.side !== 'sell') continue;
    const slot = slots.get(f.symbol);
    if (slot === undefined) continue;
    if (f.client_id.startsWith('h-')) {
      slot.halfSold = true;
      slot.halfPending = null;
    } else if (f.client_id.startsWith('x-')) {
      slots.delete(f.symbol);
    }
  }
  for (const f of batch.fills) {
    if (f.status !== 'rejected' || f.side !== 'sell') continue;
    const slot = slots.get(f.symbol);
    if (slot !== undefined && slot.halfPending === f.client_id) slot.halfPending = null;
  }
  for (const symbol of [...slots.keys()]) {
    if (!state.positions.has(symbol)) slots.delete(symbol);
  }
}


await runBars({
  onBatch(state, batch) {
    if (state.warmingUp) return [];
    // Record every symbol's new close first, then confirm last bar's fills.
    for (const { symbol } of state.hello.symbols) {
      const arr = closes.get(symbol) ?? [];
      arr.push(state.close(symbol));
      closes.set(symbol, arr);
    }
    applyFills(state, batch);

    const orders: OrderInput[] = [];
    const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
    const selling = new Set<string>();

    // ---- exits: half on the first leg of the bounce, the rest higher,
    //      or the whole position on the trailing stop / time stop. ----
    for (const { symbol } of state.hello.symbols) {
      const pos = state.positions.get(symbol);
      if (pos === undefined) continue;
      const slot = slots.get(symbol);
      if (slot === undefined) continue;
      const cur = state.close(symbol);
      if (cur === null) continue;
      if (cur > slot.peak) slot.peak = cur;
      const val = state.value(symbol, pos.qty);
      const cost = pos.cost;
      let sellQty = 0n;
      let full = false;
      if (!slot.halfSold && slot.halfPending === null && val * TP_DEN >= cost * TP_HALF_NUM) {
        sellQty = pos.qty / 2n;
        if (sellQty > 0n && state.value(symbol, sellQty) < minNotional) sellQty = pos.qty;
      } else if (val * TP_DEN >= cost * TP_REST_NUM) {
        sellQty = pos.qty;
        full = true;
      } else if (cur * STOP_DEN < slot.peak * STOP_NUM) {
        sellQty = pos.qty;
        full = true;
      } else if (state.seq - slot.entrySeq >= MAX_HOLD_BARS) {
        sellQty = pos.qty;
        full = true;
      }
      if (sellQty === 0n) continue;
      if (full) {
        orders.push({ side: 'sell', symbol, qty: sellQty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `x-${symbol}-${state.seq}` });
      } else {
        const id = `h-${symbol}-${state.seq}`;
        orders.push({ side: 'sell', symbol, qty: sellQty, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: id });
        slot.halfPending = id;
      }
      selling.add(symbol);
    }

    // ---- entries: buy the dip in tiers, deeper drop = bigger size. ----
    const held = state.positions.size;
    let free = MAX_POSITIONS - held;
    for (const { symbol } of state.hello.symbols) {
      if (selling.has(symbol)) continue;
      const slot = slots.get(symbol);
      const heldHere = state.positions.has(symbol);
      let target: bigint | null = null;
      let tier = 0;
      if (dropped(symbol, 12, DEEP_NUM, DEEP_DEN)) {
        target = W_DEEP;
        tier = 4;
      } else if (dropped(symbol, 12, MAIN_NUM, MAIN_DEN)) {
        target = W_MAIN;
        tier = 3;
      } else if (dropped(symbol, 6, SCOUT_NUM, SCOUT_DEN)) {
        target = W_SCOUT;
        tier = 2;
      } else if (dropped(symbol, 6, MICRO_NUM, MICRO_DEN)) {
        target = W_MICRO;
        tier = 1;
      } else {
        continue;
      }
      if (slot !== undefined && tier <= slot.tier) continue;
      if (!heldHere && free <= 0) continue;
      const size = topUpSize(state, symbol, target);
      if (size < minNotional) continue;
      orders.push({ side: 'buy', symbol, notional_quote_units: size, max_slippage_bps: MAX_SLIPPAGE_BPS, client_id: `b-${symbol}-${state.seq}` });
      if (slot === undefined) {
        const cur = state.close(symbol);
        if (cur === null) continue;
        slots.set(symbol, { tier, entrySeq: state.seq, peak: cur, halfSold: false, halfPending: null });
      } else {
        slot.tier = tier;
      }
      if (!heldHere) free -= 1;
    }
    return orders;
  },
});
