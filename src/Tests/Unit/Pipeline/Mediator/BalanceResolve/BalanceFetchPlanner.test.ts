/**
 * BALANCE-RESOLVE.pre planner — v6 unit tests.
 *
 * <p>The planner reads {@link IAccountIdentity} list + {@link
 * IBalanceFetchTemplate} emitted by SCRAPE.post and builds the
 * per-bank-account {@link IBalanceFetchPlanEntry} list (deduplicated
 * by bankAccountUniqueId). Default-deny on missing inputs.
 */

import { buildBalanceFetchPlan } from '../../../../../Scrapers/Pipeline/Mediator/BalanceResolve/BalanceFetchPlanner.js';
import type {
  IAccountIdentity,
  IBalanceFetchTemplate,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

describe('BalanceFetchPlanner — v6 build plan', () => {
  it('default-deny: returns empty plan when identities map is empty', () => {
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://x/y',
      method: 'POST',
      postBodyKey: 'bankAccountUniqueId',
    };
    const result = buildBalanceFetchPlan(new Map(), tmpl);
    expect(result.length).toBe(0);
  });

  it('default-deny: returns empty plan when template has empty url (sentinel)', () => {
    const idents = new Map<string, IAccountIdentity>([
      [
        'FAKE-1',
        { cardDisplayId: 'FAKE-1', cardUniqueId: 'FAKE-1', bankAccountUniqueId: 'FAKE-BA-1' },
      ],
    ]);
    const emptyTemplate: IBalanceFetchTemplate = { url: '', method: 'GET' };
    const result = buildBalanceFetchPlan(idents, emptyTemplate);
    expect(result.length).toBe(0);
  });

  it('POST template: one entry per unique bankAccountUniqueId; body carries the id', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['CARD-A', { cardDisplayId: 'CARD-A', cardUniqueId: 'UID-A', bankAccountUniqueId: 'BA-1' }],
      ['CARD-B', { cardDisplayId: 'CARD-B', cardUniqueId: 'UID-B', bankAccountUniqueId: 'BA-1' }],
      ['CARD-C', { cardDisplayId: 'CARD-C', cardUniqueId: 'UID-C', bankAccountUniqueId: 'BA-2' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://api/getBigNumberAndDetails',
      method: 'POST',
      postBodyKey: 'bankAccountUniqueId',
      headers: { 'content-type': 'application/json' },
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan.length).toBe(2);
    const ids = [...plan]
      .map((e): string => e.bankAccountUniqueId)
      .sort((a, b): number => a.localeCompare(b));
    expect(ids).toEqual(['BA-1', 'BA-2']);
    const entry1 = plan.find((e): boolean => e.bankAccountUniqueId === 'BA-1');
    expect(entry1).toBeDefined();
    expect(entry1?.request.method).toBe('POST');
    const parsedBody: unknown = entry1 ? JSON.parse(entry1.request.body) : null;
    expect(parsedBody).toEqual({ bankAccountUniqueId: 'BA-1' });
  });

  it('GET template with urlPathInterpolation: substitutes <ID> in URL path', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['ACC', { cardDisplayId: 'ACC', cardUniqueId: 'ACC', bankAccountUniqueId: 'ACC' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://api/accountDetails/infoAndBalance/<ID>',
      method: 'GET',
      urlPathInterpolation: true,
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan.length).toBe(1);
    expect(plan[0].request.url).toContain('/infoAndBalance/ACC');
    expect(plan[0].request.method).toBe('GET');
    expect(plan[0].request.body).toBe('');
  });

  it('GET template with urlQueryKey: substitutes the id in URL query', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['Q', { cardDisplayId: 'Q', cardUniqueId: 'Q', bankAccountUniqueId: 'QID' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://api/balance?partyCurrentAccount=PLACEHOLDER&lang=he',
      method: 'GET',
      urlQueryKey: 'partyCurrentAccount',
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan[0].request.url).toContain('partyCurrentAccount=QID');
  });

  it('bulk template (no key): emits ONE __BULK__ entry covering all cards', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['A', { cardDisplayId: 'A', cardUniqueId: 'A', bankAccountUniqueId: '__BULK__' }],
      ['B', { cardDisplayId: 'B', cardUniqueId: 'B', bankAccountUniqueId: '__BULK__' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://api/GetCardList',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan.length).toBe(1);
    expect(plan[0].bankAccountUniqueId).toBe('__BULK__');
  });

  it('headers from template carry through to the request', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['X', { cardDisplayId: 'X', cardUniqueId: 'X', bankAccountUniqueId: 'BA-X' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'https://api',
      method: 'POST',
      postBodyKey: 'bankAccountUniqueId',
      headers: { 'x-custom': 'value' },
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan[0].request.headers['x-custom']).toBe('value');
  });

  it('GET urlQueryKey with malformed URL → tryParseUrl fail branch (<ID> replace fallback)', () => {
    const idents = new Map<string, IAccountIdentity>([
      ['Q', { cardDisplayId: 'Q', cardUniqueId: 'Q', bankAccountUniqueId: 'BAD-Q' }],
    ]);
    const tmpl: IBalanceFetchTemplate = {
      url: 'malformed-no-protocol-<ID>',
      method: 'GET',
      urlQueryKey: 'partyCurrentAccount',
    };
    const plan = buildBalanceFetchPlan(idents, tmpl);
    expect(plan.length).toBe(1);
    expect(plan[0].request.url).toContain('BAD-Q');
  });
});
