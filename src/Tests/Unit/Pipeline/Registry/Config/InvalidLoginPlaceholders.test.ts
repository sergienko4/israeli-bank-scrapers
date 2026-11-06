/**
 * The invalid-login live tests send placeholder credentials to the real bank.
 * An api-direct bank checks credential shape before its first request, so a
 * placeholder of the wrong shape fails locally and the live test proves
 * nothing about the bank's answer. Each placeholder must pass its bank's
 * check, so the run reaches the bank — and every id it sends carries a wrong
 * check digit, so it can never name (or lock out) a real person.
 *
 * Uses dynamic imports for `Registry/Config/*` per the project's test rule
 * (Pipeline tests don't statically import from Registry/Config).
 */

import type { IApiDirectCallConfig } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { checkRequiredCreds } from '../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RequiredCreds.js';
import {
  INVALID_CREDS_DISCOUNT,
  INVALID_CREDS_HAPOALIM,
  INVALID_CREDS_ISRACARD_AMEX,
  INVALID_CREDS_USERNAME_PASSWORD,
  INVALID_CREDS_YAHAV,
} from '../../../../TestConstants.js';

const CONFIG_DIR = '../../../../../Scrapers/Pipeline/Registry/Config/';

/** One api-direct bank and the placeholder its invalid-login test sends. */
interface IPlaceholderRow {
  readonly bank: string;
  readonly creds: Readonly<Record<string, string>>;
}

const ROWS: readonly IPlaceholderRow[] = [
  { bank: 'Amex', creds: INVALID_CREDS_ISRACARD_AMEX },
  { bank: 'Isracard', creds: INVALID_CREDS_ISRACARD_AMEX },
  { bank: 'Yahav', creds: INVALID_CREDS_YAHAV },
  { bank: 'Beinleumi', creds: INVALID_CREDS_USERNAME_PASSWORD },
  { bank: 'Discount', creds: INVALID_CREDS_DISCOUNT },
  { bank: 'Hapoalim', creds: INVALID_CREDS_HAPOALIM },
  { bank: 'Max', creds: INVALID_CREDS_USERNAME_PASSWORD },
  { bank: 'Mercantile', creds: INVALID_CREDS_DISCOUNT },
  { bank: 'Mizrahi', creds: INVALID_CREDS_USERNAME_PASSWORD },
  { bank: 'VisaCal', creds: INVALID_CREDS_USERNAME_PASSWORD },
];

/**
 * A bank's api-direct login config.
 * @param bank - Config module suffix.
 * @returns The module's default export.
 */
async function loadCall(bank: string): Promise<IApiDirectCallConfig> {
  const path = `${CONFIG_DIR}PipelineBankConfig${bank}.js`;
  const loaded = (await import(path)) as { readonly default: IApiDirectCallConfig };
  return loaded.default;
}

describe('invalid-login placeholders reach the bank', () => {
  it.each(ROWS)('$bank placeholder passes the local shape check', async ({ bank, creds }) => {
    const call = await loadCall(bank);
    const checked = checkRequiredCreds(call, creds);
    expect(checked).toEqual({ success: true, value: true });
  });
});

/**
 * Whether a nine-digit id carries a valid Israeli check digit.
 * @param id - Nine digits.
 * @returns True when the check digit is right.
 */
function hasValidCheckDigit(id: string): boolean {
  const digits = Array.from(id, Number);
  const weighted = digits.map((digit, at) => digit * ((at % 2) + 1));
  const folded = weighted.map(value => (value > 9 ? value - 9 : value));
  const sum = folded.reduce((total, value) => total + value, 0);
  return sum % 10 === 0;
}

const SENT_IDS = [
  { field: 'Discount/Mercantile id', sentId: INVALID_CREDS_DISCOUNT.id },
  { field: 'Isracard/Amex id', sentId: INVALID_CREDS_ISRACARD_AMEX.id },
  { field: 'Yahav nationalID', sentId: INVALID_CREDS_YAHAV.nationalID },
];

describe('invalid-login placeholders never name a real person', () => {
  it('reads a known check digit as valid', () => {
    const isValid = hasValidCheckDigit('000000018');
    expect(isValid).toBe(true);
  });

  it.each(SENT_IDS)('$field carries a wrong check digit', ({ sentId }) => {
    const isValid = hasValidCheckDigit(sentId);
    expect(isValid).toBe(false);
  });
});
