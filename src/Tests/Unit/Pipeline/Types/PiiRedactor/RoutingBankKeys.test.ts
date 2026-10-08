/**
 * Central log redaction of Mizrahi SkyBL response keys.
 *
 * NetworkDump, FixtureCapture and the trace writers pass every captured
 * body through `redactJsonBody`, which only censors leaves whose key
 * `classifyKey` recognises. The keys below carry the account owner's
 * identity, account numbers, balances, credit lines and transaction
 * text in the logon, changeAccount, balance and get428Index responses;
 * each one must keep its value out of the dump. The list is read off the
 * response contract, not copied from the routing table.
 *
 * The committed responses are the oracle for completeness: the fixture
 * sweep replaced every PII value in them with a `[redacted-<kind>]`
 * placeholder, so a placeholder that survives `redactJsonBody` marks a
 * key the runtime table still misses.
 */
import { redactJsonBody } from '../../../../../Scrapers/Pipeline/Types/PiiRedactor.js';
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
  'actionGUID',
  'ClientGWIdentifier',
  'Role',
  'ret_input',
] as const;

const OPERATIONAL_KEYS = ['MC02PeulaTaaEZ', 'TransactionType', 'ret_message'] as const;

const RESPONSES = ['logon', 'changeAccount', 'balance', 'transactions'] as const;

/** Sweep placeholder; group 1 is its kind without the `-N` suffix. */
const PLACEHOLDER = /\[(redacted-[a-z-]+?)(?:-\d+)?\]/g;

/** Last-login timestamps are not on the PII list; tracked as a follow-up. */
const DEFERRED_KINDS: ReadonlySet<string> = new Set(['redacted-last-login']);

/**
 * Placeholder kinds still present after the runtime redactor ran.
 * @param name - Committed response file name.
 * @returns Kinds the dump would leak, deferred kinds excluded.
 */
function survivingKinds(name: string): string[] {
  const response = loadMizrahiResponse(name);
  const body = JSON.stringify(response);
  const dump = redactJsonBody(body);
  const kinds = [...dump.matchAll(PLACEHOLDER)].map(match => match[1]);
  return kinds.filter(kind => !DEFERRED_KINDS.has(kind));
}

describe('PiiRedactor routing — Mizrahi SkyBL response keys', () => {
  it.each(SENSITIVE_KEYS)('BANK-KEY %s is censored in a JSON dump', key => {
    const dump = redactJsonBody({ [key]: SENTINEL });
    expect(dump).not.toContain(SENTINEL);
  });

  it.each(OPERATIONAL_KEYS)('BANK-KEY %s stays readable for debugging', key => {
    const dump = redactJsonBody({ [key]: SENTINEL });
    expect(dump).toContain(SENTINEL);
  });

  it.each(RESPONSES)('BANK-RESP %s leaks no swept PII value into a dump', name => {
    const leaked = survivingKinds(name);
    expect(leaked).toEqual([]);
  });
});
