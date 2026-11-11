/**
 * Cookie hand-off at login completion. `isolate` moves the login's
 * cookies out of the session jar into the run's private stash, so no scrape
 * read is sent a gateway cookie; `shared`, the default, leaves the jar as the
 * login left it.
 */

import type {
  CookieHandoff,
  IApiDirectCallConfig,
} from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/ConfigContracts/index.js';
import { handOffCookies } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/CookieHandoff.js';
import type { ILongTermTokenSlot } from '../../../../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Flow/Lifecycle/TokenStrategyFromConfig.types.js';
import type { ITokenBus } from '../../../../../../Scrapers/Pipeline/Types/Domain/TokenBus.js';
import { makeStubMediator } from './StubMediator.js';
import { BANCS_URL, makeDomainSession, WARM_COOKIES } from './WarmJarSpy.js';

/**
 * A login-only call config with the given hand-off.
 * @param cookieHandoff - Hand-off under test; undefined for the default.
 * @returns Call config.
 */
function configWith(cookieHandoff?: CookieHandoff): IApiDirectCallConfig {
  return { flow: 'sms-otp', envelope: {}, steps: [], cookieHandoff };
}

/**
 * A capture slot before any login finished.
 * @returns Empty slot.
 */
function emptySlot(): ILongTermTokenSlot {
  return { latest: '', latestCarrySnapshot: {} };
}

/**
 * A bus whose real domain jar holds the login's cookies.
 * @returns The bus and its jar.
 */
function loggedInBus(): { bus: ITokenBus; jar: ReturnType<typeof makeDomainSession>['jar'] } {
  const stub = makeStubMediator({ responses: [], captures: [] });
  const { jar, session } = makeDomainSession();
  jar.importAll(WARM_COOKIES);
  return { bus: { ...stub, cookies: session }, jar };
}

describe('handOffCookies', () => {
  it('isolate stashes the login cookies and empties the jar for the scrape', () => {
    const { bus, jar } = loggedInBus();
    const slot = emptySlot();
    const gatewayHeader = jar.header(BANCS_URL);
    const isAcked = handOffCookies({ config: configWith('isolate'), bus }, slot);
    expect(isAcked).toBe(true);
    expect(gatewayHeader).toContain('SMSESSION=');
    const left = jar.exportAll();
    const bancsHeader = jar.header(BANCS_URL);
    expect(slot.handoffCookies).toEqual(WARM_COOKIES);
    expect(left).toEqual([]);
    expect(bancsHeader).toBe('');
  });

  it.each<[string, CookieHandoff | undefined]>([
    ['shared', 'shared'],
    ['the default', undefined],
  ])('%s leaves the jar to the scrape and stashes nothing', (_label, cookieHandoff) => {
    const { bus, jar } = loggedInBus();
    const slot = emptySlot();
    const isAcked = handOffCookies({ config: configWith(cookieHandoff), bus }, slot);
    expect(isAcked).toBe(true);
    const left = jar.exportAll();
    expect(slot.handoffCookies).toBeUndefined();
    expect(left).toEqual(WARM_COOKIES);
  });

  it('isolate on a bus without a jar has nothing to move', () => {
    const bus = makeStubMediator({ responses: [], captures: [] });
    const slot = emptySlot();
    const isAcked = handOffCookies({ config: configWith('isolate'), bus }, slot);
    expect(isAcked).toBe(true);
    expect(slot.handoffCookies).toBeUndefined();
  });
});
