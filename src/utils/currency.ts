/**
 * ============================================================================
 * MODULE: utils/currency.ts — Multi-Currency Conversion & Formatting
 * ----------------------------------------------------------------------------
 * Central money helper for the whole platform. All monetary values are stored
 * internally in the ZAR base currency; this module converts and formats them
 * for display in the user's selected currency.
 *   - CURRENCY_MAP: exchange rates and symbols relative to 1 ZAR base unit.
 *   - convertZarToCurrency(): pure math conversion from base ZAR to target.
 *   - formatCurrency(): converts AND prepends the correct currency symbol,
 *     producing the display strings used across POS, reports, and dashboards.
 * Keeping conversion in one place means changing a rate updates the entire app.
 * ============================================================================
 */
import { CurrencyCode, CurrencyConfig } from '../types';

export const CURRENCY_MAP: { [key in CurrencyCode]: CurrencyConfig } = {
  ZAR: { code: 'ZAR', symbol: 'R', rate: 1.0, name: 'South African Rand (Base)' },
  USD: { code: 'USD', symbol: 'US$', rate: 0.053, name: 'United States Dollar' },
  BWP: { code: 'BWP', symbol: 'P', rate: 0.72, name: 'Botswana Pula' },
  EUR: { code: 'EUR', symbol: '€', rate: 0.049, name: 'Euro (Other)' }
};

/**
 * Converts a base ZAR value into the target currency value
 */
export function convertZarToCurrency(amountInZar: number, targetCode: CurrencyCode): number {
  const config = CURRENCY_MAP[targetCode] || CURRENCY_MAP.ZAR;
  return amountInZar * config.rate;
}

/**
 * Formats a base ZAR amount into the display currency with its matching symbol
 */
export function formatCurrency(amountInZar: number, targetCode: CurrencyCode): string {
  const config = CURRENCY_MAP[targetCode] || CURRENCY_MAP.ZAR;
  const converted = convertZarToCurrency(amountInZar, targetCode);
  return `${config.symbol}${converted.toFixed(2)}`;
}
