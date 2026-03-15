import { getRawTransaction } from '../../Common/Transactions.js';
import {
  type ITransaction as ScrapingTransaction,
  TransactionStatuses,
  TransactionTypes,
} from '../../Transactions.js';
import type { ScraperOptions } from '../Base/Interface.js';
import type { IMovement } from './OneZeroTypes.js';

const HEBREW_RE = /[\u0590-\u05FF][\u0590-\u05FF"'\-_ /\\]*[\u0590-\u05FF]/g;

/**
 * Reverse Hebrew substrings within the given ranges.
 * @param plain - Text with LTR control characters stripped.
 * @param ranges - Hebrew substring ranges.
 * @returns Text with Hebrew substrings reversed.
 */
function reverseHebrew(plain: string, ranges: { start: number; end: number }[]): string {
  const out: string[] = [];
  let idx = 0;
  for (const { start, end } of ranges) {
    const before = plain.substring(idx, start);
    out.push(...Array.from(before));
    const slice = plain.substring(start, end);
    out.push(...Array.from(slice).reverse());
    idx = end;
  }
  const tail = plain.substring(idx);
  out.push(...Array.from(tail));
  return out.join('');
}

/**
 * Strip LTR control characters and reverse Hebrew substrings.
 * @param text - The text to sanitize.
 * @returns The sanitized text.
 */
export function sanitize(text: string): string {
  if (!text.includes('\u202d')) return text.trim();
  const plain = text.replaceAll(/\u202d/gi, '').trim();
  const ranges = [...plain.matchAll(HEBREW_RE)].map(m => ({
    start: m.index,
    end: m.index + m[0].length,
  }));
  return reverseHebrew(plain, ranges);
}

/**
 * Compute the fallback balance from the last movement.
 * @param movements - The array of movements.
 * @returns The fallback balance number.
 */
export function fallbackBalance(movements: IMovement[]): number {
  if (!movements.length) return 0;
  return Number.parseFloat(movements[movements.length - 1].runningBalance);
}

/**
 * Sort movements by timestamp ascending (mutates array).
 * @param movements - The movements array.
 * @returns The sorted array.
 */
export function sortByTimestamp(movements: IMovement[]): IMovement[] {
  return movements.sort(
    (a, b) => new Date(a.movementTimestamp).valueOf() - new Date(b.movementTimestamp).valueOf(),
  );
}

/**
 * Build the base transaction fields from a movement.
 * @param mv - The movement to convert.
 * @returns The base transaction without raw data.
 */
function buildTxnBase(mv: IMovement): ScrapingTransaction {
  const recurrences = mv.transaction?.enrichment?.recurrences;
  const hasInstall = recurrences?.some(x => x.isRecurrent);
  const mod = mv.creditDebit === 'DEBIT' ? -1 : 1;
  return {
    identifier: mv.movementId,
    date: mv.valueDate,
    chargedAmount: +mv.movementAmount * mod,
    chargedCurrency: mv.movementCurrency,
    originalAmount: +mv.movementAmount * mod,
    originalCurrency: mv.movementCurrency,
    description: sanitize(mv.description),
    processedDate: mv.movementTimestamp,
    status: TransactionStatuses.Completed,
    type: hasInstall ? TransactionTypes.Installments : TransactionTypes.Normal,
  };
}

/**
 * Map a single movement to standard transaction format.
 * @param mv - The movement to map.
 * @param options - The scraper options.
 * @returns The mapped transaction.
 */
export function mapMovement(mv: IMovement, options: ScraperOptions): ScrapingTransaction {
  const result = buildTxnBase(mv);
  if (options.includeRawTransaction) {
    result.rawTransaction = getRawTransaction(mv);
  }
  return result;
}
