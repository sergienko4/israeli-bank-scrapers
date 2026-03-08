import type { ScraperScrapingResult } from '../Scrapers/Base/Interface.js';
import type { Transaction, TransactionsAccount } from '../Transactions.js';

const MAX_TXN_PREVIEW = 3;
const SEPARATOR = '\u2550'.repeat(40);

export function maskAccount(acct: string): string {
  return acct.length <= 4 ? '****' : '****' + acct.slice(-4);
}

export function maskAmount(amount: number | undefined): string {
  if (amount == null) return '  ***';
  return amount >= 0 ? ' +***' : ' -***';
}

export function maskDesc(desc: string): string {
  if (!desc) return '***';
  return desc.slice(0, 3) + '***';
}

function formatDate(isoDate: string): string {
  return isoDate ? new Date(isoDate).toLocaleDateString('he-IL') : '';
}

// Bank APIs may return null for typed string fields — guard at runtime
function safePad(value: string, width: number): string {
  return (value as string | null)?.padEnd(width) ?? ''.padEnd(width);
}

function formatTransaction(txn: Transaction): string {
  const date = formatDate(txn.date).padEnd(12);
  const amount = maskAmount(txn.originalAmount).padStart(6);
  const currency = safePad(txn.originalCurrency, 4);
  const desc = maskDesc(txn.description);
  return `    - ${date}| ${amount} ${currency}| ${desc}`;
}

function formatAccount(account: TransactionsAccount): string[] {
  const acct = maskAccount(account.accountNumber);
  const balance = maskAmount(account.balance);
  const lines: string[] = [];
  lines.push(`  Account: ${acct} | Balance:${balance} | Transactions: ${account.txns.length}`);
  const preview = account.txns.slice(0, MAX_TXN_PREVIEW);
  for (const txn of preview) {
    lines.push(formatTransaction(txn));
  }
  const remaining = account.txns.length - MAX_TXN_PREVIEW;
  if (remaining > 0) lines.push(`    ... +${remaining} more`);
  return lines;
}

function formatSuccess(result: ScraperScrapingResult): string[] {
  const lines: string[] = ['Result: success=true'];
  for (const account of result.accounts ?? []) {
    lines.push(...formatAccount(account));
  }
  return lines;
}

function formatFailure(result: ScraperScrapingResult): string[] {
  return [`Result: success=false | errorType=${result.errorType ?? 'unknown'}`];
}

export function formatResultSummary(bankName: string, result: ScraperScrapingResult): string[] {
  const header = [SEPARATOR, `  ${bankName}`, SEPARATOR];
  const body = result.success ? formatSuccess(result) : formatFailure(result);
  return [...header, ...body];
}
