/**
 * Issue #550 — Pepper profiles holding products the OSH resolver cannot serve.
 *
 * <p>A Pepper profile can hold several products. `extractAccounts` returns them
 * all, and `PEPPER_SHAPE` then issues `oshTransactionsNew` — the
 * CURRENT-ACCOUNT-specific resolver — against each in turn. Pepper rejects the
 * non-current products, and because `iterateAccounts` short-circuits on the
 * first failing account the run is discarded before it ever reaches the `Ils`
 * account that `oshTransactionsNew` actually serves.
 *
 * <p>The agreed fix EXCLUDES unsupported products at discovery rather than
 * quarantining failures mid-walk. The two failure classes stay separate:
 *
 * <ul>
 *   <li>KNOWN-UNSUPPORTED product — permanent; never request it at all.</li>
 *   <li>OPERATIONAL failure (500 / dead session / parser) — transient; stays
 *       LOUD. Never silently omit money.</li>
 * </ul>
 *
 * <p>`"Ils"` is production-confirmed. `"Foreign"` / `"SecuritiesAccount"` are
 * attested only by the reporter, which is why the shape carries an ALLOW-list
 * of supported categories rather than a deny-list of reported-bad ones.
 */

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import ScraperError from '../../../../../Scrapers/Base/ScraperError.js';
import { extractAccounts } from '../../../../../Scrapers/Pipeline/Banks/Pepper/scrape/PepperShapeHelpers.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import {
  ACCOUNTS_FILTERED_LOG,
  EXCLUSION_REPORT_FAILED,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapeExclusions.js';
import {
  type ApiDirectScrapeResult,
  buildApiDirectScrapePhase,
  createApiDirectScrapePhase,
} from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IApiDirectScrapeShape } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IActionContext,
  IPipelineContext,
  IScrapeState,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertHas, assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';
import { ONEZERO_CASE, PEPPER_CASE } from './ApiDirectScrapeBankShapes.js';
import { makeRouterBus } from './ApiDirectScrapeRouterBus.js';

/** Pepper's dynamic headers read `ctx.credentials.phoneNumber`. */
const PEPPER_TEST_CREDENTIALS = {
  username: 'pepper-test-user',
  password: 'pepper-test-pass',
  phoneNumber: '972000000001',
} as unknown as IPipelineContext['credentials'];

/**
 * The verbatim message Pepper returns for an `oshTransactionsNew` query issued
 * against a non-current account. Captured in the issue report: the transport is
 * HTTP 200 and this axios string arrives inside the GraphQL `errors` array.
 */
const PEPPER_NON_OSH_REJECTION =
  'graphql errors [Transactions]: Request failed with status code 400';

/** One product inside a Pepper profile. */
interface IPepperProductSpec {
  readonly accountId: string;
  readonly accountNumber: string;
  readonly accountCategory?: string | null;
}

const FX_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-fx',
  accountNumber: 'pep-num-fx',
  accountCategory: 'Foreign',
};
const SECURITIES_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-sec',
  accountNumber: 'pep-num-sec',
  accountCategory: 'SecuritiesAccount',
};
const ILS_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-ils',
  accountNumber: 'pep-num-ils',
  accountCategory: 'Ils',
};
/** A product whose category the payload omits entirely. */
const UNCATEGORISED_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-unk',
  accountNumber: 'pep-num-unk',
};
/**
 * A product whose category arrives as JSON `null`.
 *
 * <p>`accountCategory` is a NULLABLE GraphQL field and the customer payload
 * crosses into the extractor through an unchecked cast, so `null` is a
 * routine wire value the declared `?: string` type cannot exclude.
 */
const NULL_CATEGORY_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-null',
  accountNumber: 'pep-num-null',
  accountCategory: null,
};
/** A product whose category arrives as an empty string. */
const BLANK_CATEGORY_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-blank',
  accountNumber: 'pep-num-blank',
  accountCategory: '',
};
/** A product whose category arrives as whitespace only. */
const WHITESPACE_CATEGORY_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-ws',
  accountNumber: 'pep-num-ws',
  accountCategory: '   ',
};
/** A product whose category is a padded near-miss of a supported value. */
const PADDED_ILS_PRODUCT: IPepperProductSpec = {
  accountId: 'pep-acc-pad',
  accountNumber: 'pep-num-pad',
  accountCategory: ' Ils ',
};

/**
 * Build a Pepper customer payload around an ordered product list.
 * @param accounts - Products the profile holds, in payload order.
 * @returns Customer response body.
 */
function customerOf(accounts: readonly IPepperProductSpec[]): object {
  const customerAndAccounts = [{ customerId: 'pep-cust-1', accounts }];
  return { userDataV2: { getUserDataV2: { customerAndAccounts } } };
}

/**
 * Run Pepper's extractor over a product list, returning the surviving ids.
 * @param accounts - Products the profile holds.
 * @returns Ids of the accounts the extractor kept, in payload order.
 */
function keptIdsOf(accounts: readonly IPepperProductSpec[]): readonly string[] {
  const body = customerOf(accounts);
  const args = { body, secondaryBody: {}, sessionContext: {} };
  const kept = extractAccounts(args as unknown as Parameters<typeof extractAccounts>[0]);
  return kept.map(a => a.accountId);
}

/**
 * Build a queue-ready customer response for a product list.
 * @param accounts - Products the profile holds.
 * @returns Successful procedure carrying the customer body.
 */
function customerResponse(accounts: readonly IPepperProductSpec[]): Procedure<unknown> {
  const body = customerOf(accounts);
  return succeed(body);
}

/**
 * Build an action context bound to a pre-loaded mediator.
 * @param bus - Pre-loaded mediator.
 * @returns Action context.
 */
function pepperContext(bus: IApiMediator): IActionContext {
  const ctx = makeMockContext({
    apiMediator: some(bus),
    credentials: PEPPER_TEST_CREDENTIALS,
  });
  return ctx as unknown as IActionContext;
}

/**
 * Run only the Pepper scrape ACTION (no result guard).
 * @param bus - Pre-loaded mediator.
 * @returns Procedure emitted by the action.
 */
async function runPepperAction(bus: IApiMediator): Promise<Procedure<ApiDirectScrapeResult>> {
  const phase = createApiDirectScrapePhase(PEPPER_CASE.shape);
  const ctx = pepperContext(bus);
  return phase(ctx);
}

/**
 * Run the Pepper phase ACTION and then POST, so the shape's result guard —
 * `zeroAccountsGuard` for Pepper, which declares none of its own — actually
 * runs. `createApiDirectScrapePhase` alone bypasses every guard.
 * @param bus - Pre-loaded mediator.
 * @returns Procedure emitted after the guard stage.
 */
async function runPepperPhase(bus: IApiMediator): Promise<Procedure<IPipelineContext>> {
  const acted = await runPepperAction(bus);
  if (!acted.success) return acted;
  const shape = PEPPER_CASE.shape as unknown as IApiDirectScrapeShape<unknown, unknown>;
  const phase = buildApiDirectScrapePhase(shape);
  const pctx: IPipelineContext = { ...makeMockContext(), scrape: acted.value.scrape };
  return phase.post(pctx, pctx);
}

/**
 * Read a failure message without widening the discriminated union.
 * @param result - Procedure expected to have failed.
 * @returns The error message, or an empty string when it succeeded.
 */
function messageOf(result: Procedure<unknown>): string {
  return result.success ? '' : result.errorMessage;
}

/** The scrape slot of a run that was expected to succeed. */
type ScrapeSlot = IScrapeState;

/**
 * Run the Pepper action and unwrap its populated scrape slot.
 * @param bus - Pre-loaded mediator.
 * @returns The scrape state the driver assembled.
 */
async function scrapeSlotOf(bus: IApiMediator): Promise<ScrapeSlot> {
  const result = await runPepperAction(bus);
  assertOk(result);
  const { scrape } = result.value;
  assertHas(scrape);
  return scrape.value;
}

/**
 * Build a mediator for a single `Ils` account with a chosen balance outcome.
 * @param balance - The queued balance-step response.
 * @returns Pre-loaded mediator.
 */
function ilsBusWithBalance(balance: Procedure<unknown>): IApiMediator {
  const customer = customerResponse([ILS_PRODUCT]);
  const transactions = succeed(PEPPER_CASE.fixtures.transactions);
  return makeRouterBus({
    customer: [customer],
    balance: [balance],
    transactions: [transactions],
  });
}

/** A structured log payload recorded during a run. */
type LogLine = Record<string, unknown>;

/**
 * Run a shape's scrape action while recording one log level's payloads.
 *
 * <p>Asserting on the log is the point of the diagnostics channel: excluding a
 * product is a SILENT omission of money unless an operator can see it happened.
 * @param shape - Shape under test.
 * @param bus - Pre-loaded mediator.
 * @param level - Which pino level to capture.
 * @returns Every payload emitted at that level during the run.
 */
async function logLinesOf<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
  bus: IApiMediator,
  level: 'info' | 'warn',
): Promise<readonly LogLine[]> {
  const phase = createApiDirectScrapePhase(shape);
  const base = pepperContext(bus);
  const sink: LogLine[] = [];
  /**
   * Record one payload.
   * @param payload - Structured pino log object.
   * @returns Count of payloads recorded so far.
   */
  const record = (payload: unknown): number => sink.push(payload as LogLine);
  // Prototype-linked so every other pino method still works untouched.
  const recorder = Object.create(base.logger) as IActionContext['logger'];
  recorder[level] = record;
  await phase({ ...base, logger: recorder });
  return sink;
}

/**
 * Run a shape's scrape action while recording every `info` log payload.
 * @param shape - Shape under test.
 * @param bus - Pre-loaded mediator.
 * @returns Every `info` payload emitted during the run.
 */
async function infoLinesOf<TAcct, TCursor>(
  shape: IApiDirectScrapeShape<TAcct, TCursor>,
  bus: IApiMediator,
): Promise<readonly LogLine[]> {
  return logLinesOf(shape, bus, 'info');
}

/**
 * Build a Pepper shape with overridden customer-side hooks.
 * @param over - The customer hooks to replace.
 * @returns A shape identical to Pepper's but for those hooks.
 */
function pepperShapeWith(
  over: Partial<IApiDirectScrapeShape<unknown, unknown>['customer']>,
): IApiDirectScrapeShape<unknown, unknown> {
  const shape = PEPPER_CASE.shape as unknown as IApiDirectScrapeShape<unknown, unknown>;
  return { ...shape, customer: { ...shape.customer, ...over } };
}

/**
 * Pick the exclusion-report line out of recorded log output.
 * @param lines - Every recorded `info` payload.
 * @returns The exclusion lines only.
 */
function exclusionLinesOf(lines: readonly LogLine[]): readonly LogLine[] {
  return lines.filter(line => line.message === ACCOUNTS_FILTERED_LOG);
}

/**
 * Pick the reporting-FAILURE line out of recorded log output.
 * @param lines - Every recorded `warn` payload.
 * @returns The reporting-failure lines only.
 */
function failureLinesOf(lines: readonly LogLine[]): readonly LogLine[] {
  return lines.filter(line => line.message === EXCLUSION_REPORT_FAILED);
}

describe('Pepper #550 — unsupported products are excluded at discovery', () => {
  it('P550-EX-1 keeps only supported categories from a multi-product profile', () => {
    const kept = keptIdsOf([FX_PRODUCT, SECURITIES_PRODUCT, ILS_PRODUCT]);

    expect(kept).toEqual(['pep-acc-ils']);
  });

  it('P550-EX-2 keeps a product whose category is absent — a schema change must fail loudly, not vanish', () => {
    const kept = keptIdsOf([UNCATEGORISED_PRODUCT]);

    expect(kept).toEqual(['pep-acc-unk']);
  });

  it('P550-EX-4 keeps a product whose category arrives as JSON null', () => {
    // `null` is what a nullable GraphQL field sends when it has no value, so
    // it means UNKNOWN exactly like an omitted field — never "unsupported".
    // Treating it as unsupported would silently drop a money-holding account.
    const kept = keptIdsOf([NULL_CATEGORY_PRODUCT]);

    expect(kept).toEqual(['pep-acc-null']);
  });

  it('P550-EX-5 keeps a product whose category is blank or whitespace-only', () => {
    // A blank value is a string SYNTACTICALLY but not a usable category
    // SEMANTICALLY, so it carries no information and means UNKNOWN — exactly
    // like an omitted or null field. Excluding it would silently drop a
    // money-holding account on nothing more than a blank server value.
    const kept = keptIdsOf([BLANK_CATEGORY_PRODUCT, WHITESPACE_CATEGORY_PRODUCT]);

    expect(kept).toEqual(['pep-acc-blank', 'pep-acc-ws']);
  });

  it('P550-EX-6 does NOT normalise a padded near-miss into a supported category', () => {
    // Guards the other side of P550-EX-5: blankness is checked with `trim()`,
    // but the allow-list comparison must stay EXACT. Trimming before the
    // comparison would silently promote ' Ils ' to a supported category and
    // let an unverified product through. A non-blank unrecognised value is a
    // normal allow-list miss and stays excluded.
    const kept = keptIdsOf([PADDED_ILS_PRODUCT]);

    expect(kept).toEqual([]);
  });

  it('P550-EX-3 never issues oshTransactionsNew against an unsupported product', async () => {
    // Exactly ONE balance + ONE transactions response is queued. If the driver
    // walks any unsupported product it exhausts a queue and the run fails, so
    // this proves the unsupported products were never requested at all.
    const customer = customerResponse([FX_PRODUCT, SECURITIES_PRODUCT, ILS_PRODUCT]);
    const bus = makeRouterBus({
      customer: [customer],
      balance: [succeed(PEPPER_CASE.fixtures.balance)],
      transactions: [succeed(PEPPER_CASE.fixtures.transactions)],
    });

    const scrape = await scrapeSlotOf(bus);

    const numbers = scrape.accounts.map(a => a.accountNumber);
    expect(numbers).toEqual(['pep-num-ils']);
    // Asserting the assembled balance (not a txn count) proves the surviving
    // account completed BOTH its balance and transactions steps. The shared
    // fixtures' txn rows are deliberately minimal stubs that carry no date and
    // so never survive mapping — every sibling spec asserts accountNumber +
    // balance for the same reason.
    expect(scrape.accounts[0].balance).toBe(PEPPER_CASE.fixtures.expectedBalance);
  });
});

describe('Pepper #550 — failure semantics are preserved (no silent partial success)', () => {
  it('P550-FAIL-1 a profile of only unsupported products fails LOUDLY as zero accounts', async () => {
    const customer = customerResponse([FX_PRODUCT, SECURITIES_PRODUCT]);
    const bus = makeRouterBus({ customer: [customer], balance: [], transactions: [] });

    const result = await runPepperPhase(bus);

    expect(result.success).toBe(false);
    // Must fail as ZERO ACCOUNTS, not as a leaked GraphQL 400 — proving the
    // products were filtered out rather than attempted and rejected.
    const message = messageOf(result);
    expect(message).toContain('zero accounts');
  });

  it('P550-FAIL-2 an OPERATIONAL failure on a supported account still aborts the whole run', async () => {
    // Guards the redesign: quarantine was rejected because it converts loud
    // operational failures into silent partial successes.
    const txnsFail = fail(ScraperErrorTypes.Generic, PEPPER_NON_OSH_REJECTION);
    const customer = customerResponse([ILS_PRODUCT]);
    const bus = makeRouterBus({
      customer: [customer],
      balance: [succeed(PEPPER_CASE.fixtures.balance)],
      transactions: [txnsFail],
    });

    const result = await runPepperAction(bus);

    expect(result.success).toBe(false);
    const message = messageOf(result);
    expect(message).toContain('Request failed with status code 400');
  });
});

describe('Pepper #550 — an unknown balance is reported as unknown, never as zero', () => {
  it('P550-BAL-1 a failed balance call no longer discards the run — the balance is OMITTED', async () => {
    // Second defect in the issue: `fetchAccountBalance` had no fallback, so a
    // single rejected balance call propagated and killed a run whose
    // transactions were already in hand.
    const balFail = fail(ScraperErrorTypes.Generic, 'balance call rejected');
    const bus = ilsBusWithBalance(balFail);

    const scrape = await scrapeSlotOf(bus);

    const numbers = scrape.accounts.map(a => a.accountNumber);
    expect(numbers).toEqual(['pep-num-ils']);
    // Key ABSENT, not `0` and not `undefined`: `ITransactionsAccount.balance`
    // is optional precisely so "we do not know" can be said truthfully.
    expect('balance' in scrape.accounts[0]).toBe(false);
    expect(scrape.balanceDegraded).toBe(true);
  });

  it('P550-BAL-2 a SUCCESSFUL response missing currentBalance yields no balance, not a fabricated 0', async () => {
    // `balanceExtract` answers `?? 0`, so before `isAbsent` existed a
    // malformed-but-successful payload produced a real-looking zero with
    // `degraded` never set — a figure indistinguishable from an empty account.
    const emptyBalance = succeed({ accounts: { balance: {} } });
    const bus = ilsBusWithBalance(emptyBalance);

    const scrape = await scrapeSlotOf(bus);

    expect('balance' in scrape.accounts[0]).toBe(false);
    expect(scrape.balanceDegraded).toBe(true);
  });

  it('P550-BAL-3 a healthy balance response still yields the live figure', async () => {
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);

    const scrape = await scrapeSlotOf(bus);

    expect(scrape.accounts[0].balance).toBe(PEPPER_CASE.fixtures.expectedBalance);
    expect(scrape.balanceDegraded).toBe(false);
  });
});

describe('Pepper #550 — excluded products are reported, never silently dropped', () => {
  it('P550-DIAG-1 reports how many products were discovered, kept and excluded', async () => {
    const customer = customerResponse([FX_PRODUCT, SECURITIES_PRODUCT, ILS_PRODUCT]);
    const bus = makeRouterBus({
      customer: [customer],
      balance: [succeed(PEPPER_CASE.fixtures.balance)],
      transactions: [succeed(PEPPER_CASE.fixtures.transactions)],
    });

    const lines = await infoLinesOf(PEPPER_CASE.shape, bus);

    const reported = exclusionLinesOf(lines);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ discovered: 3, selected: 1, excluded: 2 });
  });

  it('P550-DIAG-2 reports NOTHING when every discovered product is supported', async () => {
    // A line on every clean run would train operators to ignore it.
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);

    const lines = await infoLinesOf(PEPPER_CASE.shape, bus);

    const reported = exclusionLinesOf(lines);
    expect(reported).toHaveLength(0);
  });

  it('P550-DIAG-3 carries counts ONLY — never an account id, number or category', async () => {
    // `logging-pii-guidlines.md`: diagnostics must not leak account identity.
    const customer = customerResponse([FX_PRODUCT, SECURITIES_PRODUCT, ILS_PRODUCT]);
    const bus = makeRouterBus({
      customer: [customer],
      balance: [succeed(PEPPER_CASE.fixtures.balance)],
      transactions: [succeed(PEPPER_CASE.fixtures.transactions)],
    });

    const lines = await infoLinesOf(PEPPER_CASE.shape, bus);

    const reported = exclusionLinesOf(lines);
    expect(reported).toHaveLength(1);
    const serialised = JSON.stringify(reported);
    expect(serialised).not.toContain('pep-acc-fx');
    expect(serialised).not.toContain('pep-num-fx');
    expect(serialised).not.toContain('Foreign');
    expect(serialised).not.toContain('SecuritiesAccount');
  });

  it('P550-DIAG-4 a shape that declares no product filter reports nothing', async () => {
    // The other 15 api-direct banks share `iterateAccounts`; the hook is
    // optional so their runs must be byte-identical to before.
    const bus = makeRouterBus({
      customer: [succeed(ONEZERO_CASE.fixtures.customer)],
      balance: [succeed(ONEZERO_CASE.fixtures.balance)],
      transactions: [succeed(ONEZERO_CASE.fixtures.transactions)],
    });

    const lines = await infoLinesOf(ONEZERO_CASE.shape, bus);

    const reported = exclusionLinesOf(lines);
    expect(reported).toHaveLength(0);
  });
});

/**
 * Run any shape's scrape ACTION against a pre-loaded bus.
 * @param shape - Shape under test.
 * @param bus - Pre-loaded mediator.
 * @returns The procedure the action emitted.
 */
async function runShape(
  shape: IApiDirectScrapeShape<unknown, unknown>,
  bus: IApiMediator,
): Promise<Procedure<ApiDirectScrapeResult>> {
  const phase = createApiDirectScrapePhase(shape);
  const ctx = pepperContext(bus);
  return phase(ctx);
}

/**
 * A hook that always throws, used to prove WHERE a failure is attributed.
 * @returns Never — it always throws.
 */
const EXPLODE = (): never => {
  throw new ScraperError('hook exploded');
};

describe('Pepper #550 — diagnostics never decide the outcome of a scrape', () => {
  it('P550-DIAG-5 a throwing exclusion counter cannot fail a healthy scrape', async () => {
    // `countDiscovered` exists ONLY to log. A scrape that fetched real money
    // must not be thrown away because the thing counting it misbehaved.
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);
    const shape = pepperShapeWith({ countDiscovered: EXPLODE });

    const result = await runShape(shape, bus);

    assertOk(result);
    const { scrape } = result.value;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(1);
  });

  it('P550-DIAG-6 a real extractAccounts throw is still blamed on extractAccounts', async () => {
    // The other half of the contract: narrowing the try/catch must not make
    // a genuine parse failure quieter or mis-attributed.
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);
    const shape = pepperShapeWith({ extractAccounts: EXPLODE });

    const result = await runShape(shape, bus);

    const message = messageOf(result);
    expect(result.success).toBe(false);
    expect(message).toContain('extractAccounts threw');
  });

  it('P550-DIAG-7 a swallowed reporting failure is still surfaced as a warning', async () => {
    // Contained is not the same as hidden: a broken diagnostics channel is
    // itself an operational fact an operator has to be able to see.
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);
    const shape = pepperShapeWith({ countDiscovered: EXPLODE });

    const lines = await logLinesOf(shape, bus, 'warn');

    const warned = failureLinesOf(lines);
    expect(warned).toHaveLength(1);
  });
});

/**
 * Counts a shape could return that no honest counter ever would.
 *
 * <p>`0` is in the list because it is BELOW the number of accounts the
 * extractor kept — a counter that under-counts is exactly as broken as one
 * that returns `NaN`, and its old failure mode was the quieter of the two.
 */
const UNUSABLE_COUNTS: readonly (readonly [string, number])[] = [
  ['NaN', Number.NaN],
  ['an infinite', Number.POSITIVE_INFINITY],
  ['a negative', -5],
  ['a fractional', 2.5],
  ['a below-kept', 0],
];

/**
 * Build a `countDiscovered` stand-in that always returns one number.
 * @param discovered - The number the counter will return.
 * @returns A counter returning exactly that number.
 */
function counterReturning(discovered: number): () => number {
  return () => discovered;
}

/**
 * Run Pepper with a chosen `countDiscovered` and collect one log level.
 * @param discovered - What the shape's counter will return.
 * @param level - Which pino level to capture.
 * @returns Every payload emitted at that level.
 */
async function linesForCount(
  discovered: number,
  level: 'info' | 'warn',
): Promise<readonly LogLine[]> {
  const healthy = succeed(PEPPER_CASE.fixtures.balance);
  const bus = ilsBusWithBalance(healthy);
  const countDiscovered = counterReturning(discovered);
  const shape = pepperShapeWith({ countDiscovered });
  return logLinesOf(shape, bus, level);
}

describe('Pepper #550 — an unusable count is a reporting failure, never a lie', () => {
  it.each(UNUSABLE_COUNTS)(
    'P550-DIAG-8 %s count never reaches the exclusion log',
    async (_label, discovered) => {
      // A payload such as `excluded: NaN` is worse than no payload: it looks
      // like a measurement.
      const lines = await linesForCount(discovered, 'info');

      const reported = exclusionLinesOf(lines);
      expect(reported).toHaveLength(0);
    },
  );

  it.each(UNUSABLE_COUNTS)(
    'P550-DIAG-9 %s count is surfaced through the reporting-failure warning',
    async (_label, discovered) => {
      // Rejecting the number must not make it silent — that is the same
      // silent-omission defect this issue is about, one level down.
      const lines = await linesForCount(discovered, 'warn');

      const warned = failureLinesOf(lines);
      expect(warned).toHaveLength(1);
    },
  );

  it('P550-DIAG-10 an unusable count still cannot fail the scrape', async () => {
    const healthy = succeed(PEPPER_CASE.fixtures.balance);
    const bus = ilsBusWithBalance(healthy);
    const countDiscovered = counterReturning(Number.NaN);
    const shape = pepperShapeWith({ countDiscovered });

    const result = await runShape(shape, bus);

    assertOk(result);
    const { scrape } = result.value;
    assertHas(scrape);
    expect(scrape.value.accounts).toHaveLength(1);
  });

  it('P550-DIAG-11 a count equal to the kept total is not a failure', async () => {
    // Validation must not become over-eager: discovered === selected is the
    // ordinary "nothing was excluded" case, not a broken counter.
    const lines = await linesForCount(1, 'warn');

    const warned = failureLinesOf(lines);
    expect(warned).toHaveLength(0);
  });
});
