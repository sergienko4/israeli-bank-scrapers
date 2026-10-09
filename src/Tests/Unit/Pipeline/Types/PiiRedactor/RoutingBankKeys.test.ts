/**
 * Central log redaction of Mizrahi SkyBL response keys.
 *
 * NetworkDump, FixtureCapture and the trace writers pass every captured
 * body through `redactJsonBody`, which only censors leaves whose key
 * `classifyKey` recognises. The keys below carry the account owner's
 * identity, account numbers, balances, credit lines, transaction text
 * and transaction references in the logon, changeAccount, balance and
 * get428Index responses; each one must keep its value out of the dump.
 * The list is read off the response contract, not copied from the
 * routing table.
 *
 * The committed responses are the oracle for completeness: the fixture
 * sweep replaced every PII value in them with a `[redacted-<kind>]`
 * placeholder, so a placeholder that survives `redactJsonBody` marks a
 * key the runtime table still misses. A whole response hides such a key
 * when a routed sibling collapses its array, so every array element is
 * also dumped on its own, as a single transaction would be.
 */
import type { ApiBody } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { classifyKey, redactJsonBody } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';
import { loadMizrahiResponse } from '../../Banks/Mizrahi/MizrahiBusFactory.js';

/** Alphabetic, so no digit-shaped fallback pattern can hide a routing gap. */
const SENTINEL = 'Zqxsentinelvalue';

const SENSITIVE_KEYS = [
  'UserId',
  'anonymousID',
  'Number',
  'Name',
  'Details',
  'SnifAndNumber',
  'SnifAndNumber400',
  'BankerName',
  'YitraAdkanit',
  'YitraAdkanitLeloChekim',
  'YitraPahak',
  'Ashrai',
  'itra',
  'itraLelo_shekim',
  'misgeret',
  'misgeret_kolel',
  'misgeret_zmani',
  'schum1',
  'schum2',
  'schum3',
  'AccountNumber',
  'AccountName',
  'Yitra',
  'YitraLeloChekim',
  'Remain',
  'MC04Schum1EZ',
  'MC04Schum2EZ',
  'MC04Schum3EZ',
  'Teur',
  'MC02TnuaTeurEZ',
  'NegdiShem',
  'NegdiCheshbon',
  'MC02SchumEZ',
  'MC02YitraEZ',
  'MC02AsmEZ',
  'MC02AsmahtaMekoritEZ',
  'actionGUID',
  'ClientGWIdentifier',
  'Role',
  'ret_input',
] as const;

const OPERATIONAL_KEYS = ['MC02PeulaTaaEZ', 'TransactionType', 'ret_message'] as const;

/** Transaction references must be censored whole, not partly masked. */
const REFERENCE_KEYS = ['MC02AsmEZ', 'MC02AsmahtaMekoritEZ'] as const;

const RESPONSES = ['logon', 'changeAccount', 'balance', 'transactions'] as const;

/** Sweep placeholder; group 1 is its kind without the `-N` suffix. */
const PLACEHOLDER = /\[(redacted-[a-z-]+?)(?:-\d+)?\]/g;

/** Last-login timestamps are not on the PII list; tracked as a follow-up. */
const DEFERRED_KINDS: ReadonlySet<string> = new Set(['redacted-last-login']);

/**
 * Placeholder kinds still present after the runtime redactor ran.
 * @param value - Committed response, or one array element of it.
 * @returns Kinds the dump would leak, deferred kinds excluded.
 */
function survivingKinds(value: ApiBody): string[] {
  const body = JSON.stringify(value);
  const dump = redactJsonBody(body);
  const kinds = [...dump.matchAll(PLACEHOLDER)].map(match => match[1]);
  return kinds.filter(kind => !DEFERRED_KINDS.has(kind));
}

/**
 * Whether a parsed JSON node is a plain object.
 * @param node - Parsed JSON node.
 * @returns True for a non-array object.
 */
function isObject(node: unknown): node is ApiBody {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * Every object held directly in an array, at any depth.
 * @param node - Parsed JSON node.
 * @returns Array elements, each one dumped on its own by the row oracle.
 */
function arrayRows(node: unknown): ApiBody[] {
  if (Array.isArray(node)) {
    const own = node.filter(item => isObject(item));
    return [...own, ...node.flatMap(item => arrayRows(item))];
  }
  if (!isObject(node)) return [];
  return Object.values(node).flatMap(child => arrayRows(child));
}

describe('PiiRedactor routing — Mizrahi SkyBL response keys', () => {
  it.each(SENSITIVE_KEYS)('BANK-KEY %s is censored in a JSON dump', key => {
    const dump = redactJsonBody({ [key]: SENTINEL });
    expect(dump).not.toContain(SENTINEL);
  });

  it.each(REFERENCE_KEYS)('BANK-KEY %s routes as an opaque token', key => {
    const category = classifyKey(key);
    expect(category).toBe('token');
  });

  it.each(OPERATIONAL_KEYS)('BANK-KEY %s stays readable for debugging', key => {
    const dump = redactJsonBody({ [key]: SENTINEL });
    expect(dump).toContain(SENTINEL);
  });

  it.each(RESPONSES)('BANK-RESP %s leaks no swept PII value into a dump', name => {
    const response = loadMizrahiResponse(name);
    const leaked = survivingKinds(response);
    expect(leaked).toEqual([]);
  });

  it.each(RESPONSES)('BANK-ROW %s leaks no swept PII value from a lone row', name => {
    const response = loadMizrahiResponse(name);
    const rows = arrayRows(response);
    const leaked = rows.flatMap(row => survivingKinds(row));
    expect(leaked).toEqual([]);
  });
});
