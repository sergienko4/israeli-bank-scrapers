/**
 * Checked URL composition follows relative handoffs and merges fresh query values.
 */

import { CompanyTypes } from '../../../../../../Definitions.js';
import { validateApiDirectConfig } from '../../../../../../Scrapers/Pipeline/Core/Builder/ApiDirectConfigRules.js';
import type {
  IApiDirectCallConfig,
  IGetStep,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { runStep } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/RunStep.js';
import { carriedUrlRulesOf } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Steps/RunStep.carriedUrlRules.js';
import { registerWkUrl } from '../../../../../../Scrapers/Pipeline/Registry/WK/UrlsWK.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { fakeFetch } from '../../../../../Helpers/FakeFetch.js';
import { makeNativeMediator } from '../../../../../Helpers/NativeStepHarness.js';

const ORIGIN = 'https://bank.example';
const LANDING_RULES = [{ origin: ORIGIN, paths: ['/SSO'] }] as const;
const ENTRY_RULES = [{ origin: ORIGIN, paths: ['/gate'] }] as const;
const MERGE_OP = {
  kind: 'url-compose',
  base: ORIGIN,
  path: '/SSO',
  source: LANDING_RULES,
  url: LANDING_RULES,
  merge: { source: ENTRY_RULES, requiredKeys: ['tracking', 'language'], setKey: 'userId' },
} as const;
const DERIVATION = {
  into: 'target',
  parts: ['carry.landing', 'carry.entry', 'creds.username'],
  op: MERGE_OP,
} as const;
const FIRST: IGetStep = {
  name: 'prime',
  urlTag: 'auth.bind',
  method: 'GET',
  extractsToCarry: {},
  deriveCarry: [DERIVATION],
};
const NEXT: IGetStep = {
  name: 'landing',
  urlTag: 'auth.login',
  method: 'GET',
  urlFromCarry: 'target',
  extractsToCarry: {},
};
const CONFIG: IApiDirectCallConfig = { flow: 'sms-otp', envelope: {}, steps: [FIRST, NEXT] };
const HEADLESS = {
  identityBase: ORIGIN,
  graphql: `${ORIGIN}/graphql`,
  paths: {},
  nativeFetch: true,
};
const ENTRY = `${ORIGIN}/gate?tracking=fresh&language=1&extra=keep`;
const LANDING = '/sso?SectorCheck=Override&userId=old&tracking=old&tracking=stale';

interface IRunOptions {
  readonly first?: IGetStep;
  readonly username?: string;
}

/**
 * Sends the checked target only when the producer succeeded.
 * @param config - Flow configuration.
 * @param result - Producer result.
 * @param bus - Synthetic token bus.
 * @returns Whether the carried GET succeeded.
 */
async function runCheckedNext(
  config: IApiDirectCallConfig,
  result: Awaited<ReturnType<typeof runStep>>,
  bus: ITokenBus,
): Promise<boolean> {
  if (!result.success) return false;
  const carriedUrlRules = carriedUrlRulesOf(config.steps, 1);
  const args = { step: NEXT, scope: result.value, bus, companyId: CompanyTypes.OneZero };
  const outcome = await runStep({ ...args, carriedUrlRules });
  return outcome.success;
}

/**
 * Runs the producer and, if admitted, the checked carried GET.
 * @param landing - Returned landing text.
 * @param entry - Fresh entry URL.
 * @param options - Step and credential overrides.
 * @returns Both outcomes and recorded synthetic calls.
 */
async function runComposition(
  landing: string,
  entry = ENTRY,
  options: IRunOptions = {},
): Promise<{
  result: Awaited<ReturnType<typeof runStep>>;
  isNextSuccessful: boolean;
  calls: string[];
}> {
  const fake = fakeFetch(() => Response.json({}));
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  const bus = makeNativeMediator(CompanyTypes.OneZero, ORIGIN);
  const config = { ...CONFIG, steps: [options.first ?? FIRST, NEXT] };
  const creds = { username: options.username ?? 'Synthetic+User' };
  const scope = { carry: { landing, entry }, creds, config };
  const result = await runStep({
    step: config.steps[0],
    scope,
    bus,
    companyId: CompanyTypes.OneZero,
  });
  const isNextSuccessful = await runCheckedNext(config, result, bus);
  return { result, isNextSuccessful, calls: fake.calls.map(call => call.url) };
}

describe('checked URL composition', () => {
  const originalFetch = globalThis.fetch;
  beforeAll(() => {
    registerWkUrl('auth.bind', CompanyTypes.OneZero, `${ORIGIN}/authenticate`);
    registerWkUrl('auth.login', CompanyTypes.OneZero, `${ORIGIN}/fallback`);
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('resolves and canonicalizes a relative target while merging and replacing query values', async () => {
    const { result, isNextSuccessful, calls } = await runComposition(LANDING);
    expect(result.success).toBe(true);
    expect(isNextSuccessful).toBe(true);
    const url = new URL(calls[1]);
    const sector = url.searchParams.get('SectorCheck');
    const extra = url.searchParams.get('extra');
    const tracking = url.searchParams.getAll('tracking');
    const identity = url.searchParams.getAll('userId');
    const validation = validateApiDirectConfig({ call: CONFIG, transport: HEADLESS });
    expect(url.pathname).toBe('/SSO');
    expect(sector).toBe('Override');
    expect(extra).toBe('keep');
    expect(tracking).toEqual(['fresh']);
    expect(identity).toEqual(['Synthetic+User']);
    expect(validation.success).toBe(true);
  });

  it('resolves an allowed relative target without merging a query', async () => {
    const op = { ...MERGE_OP, merge: undefined };
    const derive = { ...DERIVATION, parts: ['carry.landing'], op } as const;
    const first = { ...FIRST, deriveCarry: [derive] };
    const { result, isNextSuccessful, calls } = await runComposition('/sso?extra=1', ENTRY, {
      first,
    });
    expect(result.success).toBe(true);
    expect(isNextSuccessful).toBe(true);
    expect(calls[1]).toBe(`${ORIGIN}/SSO?extra=1`);
  });

  it('preserves the returned path when no canonical path is configured', async () => {
    const op = { ...MERGE_OP, merge: undefined, path: undefined };
    const derive = { ...DERIVATION, parts: ['carry.landing'], op } as const;
    const first = { ...FIRST, deriveCarry: [derive] };
    const { result, isNextSuccessful, calls } = await runComposition('/sso?extra=1', ENTRY, {
      first,
    });
    expect(result.success).toBe(true);
    expect(isNextSuccessful).toBe(true);
    expect(calls[1]).toBe(`${ORIGIN}/sso?extra=1`);
  });

  it.each([
    ['foreign target', 'https://foreign.example/sso'],
    ['wrong target path', '/outside'],
    ['userinfo', 'https://synthetic@bank.example/sso'],
    ['fragment', '/sso#fragment'],
    ['invalid query UTF-8', '/sso?value=%C0%AF'],
    ['encoded control', '/sso?value=%00'],
    ['ill-formed target Unicode', '/sso?value=route\ud800'],
  ])('refuses %s before the next request', async (_label, landing) => {
    const { result, calls } = await runComposition(landing);
    expect(result.success).toBe(false);
    expect(calls).toEqual([`${ORIGIN}/authenticate`]);
    const message = JSON.stringify(result);
    expect(message).not.toContain(landing);
  });

  it.each([
    ['foreign entry', 'https://foreign.example/gate?tracking=fresh&language=1'],
    ['duplicate routing', `${ENTRY}&tracking=stale`],
    ['missing routing', `${ORIGIN}/gate?language=1`],
    ['invalid entry query', `${ENTRY}&extra=%C0%AF`],
    ['ill-formed entry Unicode', `${ENTRY}&extra=route\udc00`],
  ])('refuses %s before the next request', async (_label, entry) => {
    const { result, calls } = await runComposition(LANDING, entry);
    expect(result.success).toBe(false);
    expect(calls).toEqual([`${ORIGIN}/authenticate`]);
  });

  it('refuses a composed destination outside its final allowlist', async () => {
    const op = { ...MERGE_OP, url: [{ origin: ORIGIN, paths: ['/other'] }] };
    const first = { ...FIRST, deriveCarry: [{ ...DERIVATION, op }] };
    const { result, calls } = await runComposition(LANDING, ENTRY, { first });
    expect(result.success).toBe(false);
    expect(calls).toEqual([`${ORIGIN}/authenticate`]);
  });

  it.each(['', '   ', '\ud800'])(
    'refuses unsafe identity before the next request',
    async username => {
      const { result, calls } = await runComposition(LANDING, ENTRY, { username });
      expect(result.success).toBe(false);
      expect(calls).toEqual([`${ORIGIN}/authenticate`]);
    },
  );

  it.each([
    ['missing target policy', { ...DERIVATION, op: { ...MERGE_OP, source: [] } }],
    ['missing output policy', { ...DERIVATION, op: { ...MERGE_OP, url: [] } }],
    ['insecure base', { ...DERIVATION, op: { ...MERGE_OP, base: 'http://bank.example' } }],
    ['base with path', { ...DERIVATION, op: { ...MERGE_OP, base: `${ORIGIN}/gate` } }],
    ['unsafe path', { ...DERIVATION, op: { ...MERGE_OP, path: '/sso?x=1' } }],
    [
      'missing merge policy',
      { ...DERIVATION, op: { ...MERGE_OP, merge: { ...MERGE_OP.merge, source: [] } } },
    ],
    [
      'empty required keys',
      { ...DERIVATION, op: { ...MERGE_OP, merge: { ...MERGE_OP.merge, requiredKeys: [] } } },
    ],
    [
      'duplicate required keys',
      {
        ...DERIVATION,
        op: { ...MERGE_OP, merge: { ...MERGE_OP.merge, requiredKeys: ['tracking', 'tracking'] } },
      },
    ],
    [
      'empty override key',
      { ...DERIVATION, op: { ...MERGE_OP, merge: { ...MERGE_OP.merge, setKey: '' } } },
    ],
    ['wrong part count', { ...DERIVATION, parts: ['carry.landing'] }],
    ['text transform', { ...DERIVATION, transform: 'lower' }],
    ['text truncation', { ...DERIVATION, truncateBytes: 64 }],
    ['separator', { ...DERIVATION, separator: '|' }],
  ] as const)('rejects %s at build time', (_label, derived) => {
    const first = { ...FIRST, deriveCarry: [derived] };
    const call: IApiDirectCallConfig = { ...CONFIG, steps: [first, NEXT] };
    const result = validateApiDirectConfig({ call, transport: HEADLESS });
    expect(result).toMatchObject({
      success: false,
      errorMessage: 'derive.op.url-compose: invalid composition',
    });
  });
});
