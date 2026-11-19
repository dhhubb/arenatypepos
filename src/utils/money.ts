/**
 * ============================================================================
 * MODULE: utils/money.ts — Deterministic Money Arithmetic
 * ----------------------------------------------------------------------------
 * Every monetary value in the platform is stored in the ZAR base currency as a
 * decimal number. Floating point arithmetic cannot represent most decimal
 * fractions exactly, so naive `a * b` / `toFixed()` chains produce off-by-one
 * cent results (for example 24.5 + 3.67 = 28.170000000000002 which rounds to
 * 28.17 while the till charged 28.18).
 *
 * This module centralises the two primitives required to keep the ledger exact:
 *   - roundMoney(): half-up rounding to 2 decimals, immune to binary drift.
 *   - allocateMoney(): distributes a rounded total across weighted buckets so
 *     that the parts always add back to the whole (largest-remainder method).
 *
 * Journal entries are validated with isEntryBalanced()/entryImbalance() so an
 * unbalanced posting can never reach the general ledger unnoticed.
 * ============================================================================
 */
import type { JournalEntry, TransactionLine } from '../types';

/** Number of minor units in one major currency unit (cents). */
export const MINOR_UNITS = 100;

/**
 * Rounds a monetary amount to 2 decimals using half-up rounding.
 * Uses an epsilon nudge so values such as 1.005 (stored as 1.00499999...) round
 * up predictably instead of down.
 */
export function roundMoney(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  const scaled = amount * MINOR_UNITS;
  const nudged = scaled + Math.sign(scaled) * 1e-7;
  return Math.round(nudged) / MINOR_UNITS;
}

/** Converts a major-unit amount into integer minor units (cents). */
export function toMinorUnits(amount: number): number {
  return Math.round(roundMoney(amount) * MINOR_UNITS);
}

/** Converts integer minor units back into a major-unit amount. */
export function fromMinorUnits(minor: number): number {
  return roundMoney(minor / MINOR_UNITS);
}

/** Sums amounts in minor units so no cent is lost to binary drift. */
export function sumMoney(amounts: number[]): number {
  return fromMinorUnits(amounts.reduce((total, value) => total + toMinorUnits(value), 0));
}

/**
 * Splits `total` across `weights` so that the returned parts sum exactly to the
 * rounded total. Remainders are handed out one cent at a time to the largest
 * fractional parts (largest-remainder / Hamilton method).
 *
 * @example allocateMoney(28.18, [24.5, 3.67]) -> [24.51, 3.67]
 */
export function allocateMoney(total: number, weights: number[]): number[] {
  if (weights.length === 0) return [];
  const totalMinor = toMinorUnits(total);
  const weightMinor = weights.map(toMinorUnits);
  const weightSum = weightMinor.reduce((sum, value) => sum + value, 0);

  // Degenerate input: nothing to apportion, keep the whole amount in slot one.
  if (weightSum === 0) {
    return weights.map((_, index) => (index === 0 ? fromMinorUnits(totalMinor) : 0));
  }

  const exact = weightMinor.map(value => (value * totalMinor) / weightSum);
  const floored = exact.map(Math.floor);
  let remainder = totalMinor - floored.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  const result = [...floored];
  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    result[order[i].index] += 1;
    remainder -= 1;
  }

  return result.map(fromMinorUnits);
}

/** Sums the DEBIT side of a journal entry. */
export function totalDebits(lines: TransactionLine[]): number {
  return sumMoney(lines.filter(line => line.type === 'DEBIT').map(line => line.amount));
}

/** Sums the CREDIT side of a journal entry. */
export function totalCredits(lines: TransactionLine[]): number {
  return sumMoney(lines.filter(line => line.type === 'CREDIT').map(line => line.amount));
}

/** Signed difference between debits and credits (positive = debits exceed). */
export function entryImbalance(entry: Pick<JournalEntry, 'lines'>): number {
  return roundMoney(totalDebits(entry.lines) - totalCredits(entry.lines));
}

/**
 * A double-entry posting is balanced only when both sides match to the cent.
 * A tolerance is deliberately NOT used: a one-cent gap is a real defect.
 */
export function isEntryBalanced(entry: Pick<JournalEntry, 'lines'>): boolean {
  return entry.lines.length >= 2 && entryImbalance(entry) === 0;
}

/**
 * Forces a journal entry to balance by absorbing any rounding residual into the
 * last line of the given account code. Used as a final safety net so that no
 * generated posting can ever be written to the ledger unbalanced.
 */
export function balanceEntry(lines: TransactionLine[], residualAccountCode: string): TransactionLine[] {
  const imbalance = roundMoney(totalDebits(lines) - totalCredits(lines));
  if (imbalance === 0) return lines;

  const targetIndex = [...lines]
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.accountCode === residualAccountCode)
    .pop()?.index;

  if (targetIndex === undefined) return lines;

  const next = lines.map(line => ({ ...line }));
  const target = next[targetIndex];
  // A debit-heavy entry needs a bigger credit and vice versa.
  const delta = target.type === 'DEBIT' ? -imbalance : imbalance;
  target.amount = roundMoney(target.amount + delta);
  return next.filter(line => line.amount > 0);
}
