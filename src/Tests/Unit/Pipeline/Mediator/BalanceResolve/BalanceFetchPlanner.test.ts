/**
 * BALANCE-RESOLVE.pre planner — v6 unit tests.
 *
 * <p>The planner reads {@link IAccountIdentity} list + {@link
 * IBalanceFetchTemplate} emitted by SCRAPE.post and builds the
 * per-bank-account {@link IBalanceFetchPlanEntry} list (deduplicated
 * by bankAccountUniqueId). Default-deny on missing inputs.
 *
 * <p>Cases live in a single SCENARIOS config array (declarative
 * expectations only) iterated by `it.each`, dispatched through a
 * single {@link assertPlannerScenario} driver. Matches CLAUDE.md
 * "Use config arrays mapped with `.map()` ... no duplication" and
 * the established `asserts` predicate pattern from {@link
 * ../../../../Helpers/AssertProcedure.ts}. Closes CodeRabbit PR #264
 * review #19.
 */

import { buildBalanceFetchPlan } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceFetchPlanner.js';
import type {
  IAccountIdentity,
  IBalanceFetchPlanEntry,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Declarative assertions checked against a built plan by {@link assertPlannerScenario}. */
interface IPlannerExpected {
  readonly length: number;
  readonly bankAccountUniqueIdsSorted?: readonly string[];
  readonly firstEntryUrlContains?: string;
  readonly firstEntryMethod?: 'GET' | 'POST';
  readonly firstEntryBody?: string;
  readonly firstEntryBankAccountUniqueId?: string;
  readonly firstEntryHeaderKV?: readonly [string, string];
  readonly findByBankAccountUniqueId?: IExpectedFoundEntry;
}

/** Sub-shape for {@link IPlannerExpected.findByBankAccountUniqueId}. */
interface IExpectedFoundEntry {
  readonly id: string;
  readonly method: 'GET' | 'POST';
  readonly parsedBody: unknown;
}

/** One row of the planner `it.each` table. */
interface IPlannerScenario {
  readonly name: string;
  readonly idents: Map<string, IAccountIdentity>;
  readonly tmpl: IBalanceFetchTemplate;
  readonly expected: IPlannerExpected;
}

/**
 * Build an identity Map from a list of [card, identity] pairs.
 *
 * @param entries - Card-id to identity tuples.
 * @returns Pre-populated identity Map.
 */
function makeIdents(
  entries: readonly (readonly [string, IAccountIdentity])[],
): Map<string, IAccountIdentity> {
  return new Map<string, IAccountIdentity>(entries);
}

const SCENARIOS: readonly IPlannerScenario[] = [
  {
    name: 'default-deny: empty identity map yields empty plan',
    idents: makeIdents([]),
    tmpl: { url: 'https://x/y', method: 'POST', postBodyKey: 'bankAccountUniqueId' },
    expected: { length: 0 },
  },
  {
    name: 'default-deny: empty template url (sentinel) yields empty plan',
    idents: makeIdents([
      [
        'FAKE-1',
        { cardDisplayId: 'FAKE-1', cardUniqueId: 'FAKE-1', bankAccountUniqueId: 'FAKE-BA-1' },
      ],
    ]),
    tmpl: { url: '', method: 'GET' },
    expected: { length: 0 },
  },
  {
    name: 'POST template: one entry per unique bankAccountUniqueId; body carries the id',
    idents: makeIdents([
      ['CARD-A', { cardDisplayId: 'CARD-A', cardUniqueId: 'UID-A', bankAccountUniqueId: 'BA-1' }],
      ['CARD-B', { cardDisplayId: 'CARD-B', cardUniqueId: 'UID-B', bankAccountUniqueId: 'BA-1' }],
      ['CARD-C', { cardDisplayId: 'CARD-C', cardUniqueId: 'UID-C', bankAccountUniqueId: 'BA-2' }],
    ]),
    tmpl: {
      url: 'https://api/getBigNumberAndDetails',
      method: 'POST',
      postBodyKey: 'bankAccountUniqueId',
      headers: { 'content-type': 'application/json' },
    },
    expected: {
      length: 2,
      bankAccountUniqueIdsSorted: ['BA-1', 'BA-2'],
      findByBankAccountUniqueId: {
        id: 'BA-1',
        method: 'POST',
        parsedBody: { bankAccountUniqueId: 'BA-1' },
      },
    },
  },
  {
    name: 'GET template with urlPathInterpolation: substitutes <ID> in URL path',
    idents: makeIdents([
      ['ACC', { cardDisplayId: 'ACC', cardUniqueId: 'ACC', bankAccountUniqueId: 'ACC' }],
    ]),
    tmpl: {
      url: 'https://api/accountDetails/infoAndBalance/<ID>',
      method: 'GET',
      urlPathInterpolation: true,
    },
    expected: {
      length: 1,
      firstEntryUrlContains: '/infoAndBalance/ACC',
      firstEntryMethod: 'GET',
      firstEntryBody: '',
    },
  },
  {
    name: 'GET template with urlQueryKey: substitutes the id in URL query',
    idents: makeIdents([
      ['Q', { cardDisplayId: 'Q', cardUniqueId: 'Q', bankAccountUniqueId: 'QID' }],
    ]),
    tmpl: {
      url: 'https://api/balance?partyCurrentAccount=PLACEHOLDER&lang=he',
      method: 'GET',
      urlQueryKey: 'partyCurrentAccount',
    },
    expected: { length: 1, firstEntryUrlContains: 'partyCurrentAccount=QID' },
  },
  {
    name: 'bulk template (no key): emits ONE __BULK__ entry covering all cards',
    idents: makeIdents([
      ['A', { cardDisplayId: 'A', cardUniqueId: 'A', bankAccountUniqueId: '__BULK__' }],
      ['B', { cardDisplayId: 'B', cardUniqueId: 'B', bankAccountUniqueId: '__BULK__' }],
    ]),
    tmpl: {
      url: 'https://api/GetCardList',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    },
    expected: { length: 1, firstEntryBankAccountUniqueId: '__BULK__' },
  },
  {
    name: 'headers from template carry through to the request',
    idents: makeIdents([
      ['X', { cardDisplayId: 'X', cardUniqueId: 'X', bankAccountUniqueId: 'BA-X' }],
    ]),
    tmpl: {
      url: 'https://api',
      method: 'POST',
      postBodyKey: 'bankAccountUniqueId',
      headers: { 'x-custom': 'value' },
    },
    expected: { length: 1, firstEntryHeaderKV: ['x-custom', 'value'] },
  },
  {
    name: 'GET urlQueryKey with malformed URL → tryParseUrl fail branch (<ID> replace fallback)',
    idents: makeIdents([
      ['Q', { cardDisplayId: 'Q', cardUniqueId: 'Q', bankAccountUniqueId: 'BAD-Q' }],
    ]),
    tmpl: {
      url: 'malformed-no-protocol-<ID>',
      method: 'GET',
      urlQueryKey: 'partyCurrentAccount',
    },
    expected: { length: 1, firstEntryUrlContains: 'BAD-Q' },
  },
];

/**
 * Dispatch every populated expected field of a scenario against the
 * built plan. Uses the project's `asserts` predicate pattern (see
 * AssertProcedure.ts) so the function neither returns `void` (banned
 * project-wide) nor a constant value (banned by SonarLint S3516).
 *
 * @param plan - Plan built by buildBalanceFetchPlan.
 * @param expected - Declarative expectations.
 */
function assertPlannerScenario(
  plan: readonly IBalanceFetchPlanEntry[],
  expected: IPlannerExpected,
): asserts plan is readonly IBalanceFetchPlanEntry[] {
  expect(plan.length).toBe(expected.length);
  if (expected.bankAccountUniqueIdsSorted) {
    const sorted = [...plan]
      .map((e): string => e.bankAccountUniqueId)
      .sort((a, b): number => a.localeCompare(b));
    expect(sorted).toEqual(expected.bankAccountUniqueIdsSorted);
  }
  if (plan.length > 0) assertFirstEntry(plan[0], expected);
  if (expected.findByBankAccountUniqueId)
    assertFoundEntry(plan, expected.findByBankAccountUniqueId);
}

/**
 * Assert per-field expectations on the plan's first entry.
 *
 * @param first - First plan entry.
 * @param expected - Expectation row.
 */
function assertFirstEntry(
  first: IBalanceFetchPlanEntry,
  expected: IPlannerExpected,
): asserts first is IBalanceFetchPlanEntry {
  if (expected.firstEntryUrlContains !== undefined)
    expect(first.request.url).toContain(expected.firstEntryUrlContains);
  if (expected.firstEntryMethod !== undefined)
    expect(first.request.method).toBe(expected.firstEntryMethod);
  if (expected.firstEntryBody !== undefined)
    expect(first.request.body).toBe(expected.firstEntryBody);
  if (expected.firstEntryBankAccountUniqueId !== undefined)
    expect(first.bankAccountUniqueId).toBe(expected.firstEntryBankAccountUniqueId);
  if (expected.firstEntryHeaderKV)
    expect(first.request.headers[expected.firstEntryHeaderKV[0]]).toBe(
      expected.firstEntryHeaderKV[1],
    );
}

/**
 * Assert a specific entry can be located by bankAccountUniqueId and
 * has the expected method + parsed JSON body.
 *
 * @param plan - Plan built by the planner.
 * @param expected - Find-by-id expectation.
 */
function assertFoundEntry(
  plan: readonly IBalanceFetchPlanEntry[],
  expected: IExpectedFoundEntry,
): asserts plan is readonly IBalanceFetchPlanEntry[] {
  const entry = plan.find((e): boolean => e.bankAccountUniqueId === expected.id);
  expect(entry).toBeDefined();
  expect(entry?.request.method).toBe(expected.method);
  const parsedBody: unknown = entry ? JSON.parse(entry.request.body) : null;
  expect(parsedBody).toEqual(expected.parsedBody);
}

describe('BalanceFetchPlanner — v6 build plan', () => {
  it.each(SCENARIOS)('$name', ({ idents, tmpl, expected }): void => {
    const plan = buildBalanceFetchPlan(idents, tmpl);
    assertPlannerScenario(plan, expected);
  });
});
