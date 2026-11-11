/**
 * Cookie hand-off at login completion. The login's cookies are scoped
 * to the gateway that issued them, but a `Path=/` gateway cookie also matches
 * every later read on a sibling host. `shared` leaves them in the session jar
 * for the scrape; `isolate` moves them to the run's private stash, so the
 * scrape starts from an empty jar and sends only cookies its own calls set.
 * The warm export runs first, so the published token still carries them.
 */

import type { ITokenBus } from '../../../Types/Domain/TokenBus.js';
import type { CookieHandoff } from '../ConfigContracts/index.js';
import type {
  ILongTermTokenSlot,
  IRunFlowArgs,
} from './Lifecycle/TokenStrategyFromConfig.types.js';

/** What a hand-off reads: the finished flow's config and bus. */
type IHandoffArgs = Pick<IRunFlowArgs, 'config' | 'bus'>;

/** Moves (or keeps) the login's cookies; always acks. */
type HandOff = (bus: ITokenBus, slot: ILongTermTokenSlot) => true;

/**
 * Leave the jar as the login left it.
 * @returns True (ack contract).
 */
function keepShared(): true {
  return true;
}

/**
 * Stash the jar's cookies on the slot, then empty the jar.
 * @param bus - The run's bus; a bus without a jar has nothing to move.
 * @param slot - Run-scoped capture slot holding the stash.
 * @returns True (ack contract).
 */
function isolateCookies(bus: ITokenBus, slot: ILongTermTokenSlot): true {
  const jar = bus.cookies;
  slot.handoffCookies = jar?.exportAll();
  jar?.clear();
  return true;
}

/** One hand-off per mode. */
const COOKIE_HANDOFFS: Readonly<Record<CookieHandoff, HandOff>> = {
  shared: keepShared,
  isolate: isolateCookies,
};

/**
 * Hand the login's cookies to the scrape the way the config asks.
 * @param args - The finished flow's config and bus.
 * @param slot - Run-scoped capture slot.
 * @returns True (ack contract).
 */
function handOffCookies(args: IHandoffArgs, slot: ILongTermTokenSlot): true {
  const mode = args.config.cookieHandoff ?? 'shared';
  const handOff = COOKIE_HANDOFFS[mode];
  return handOff(args.bus, slot);
}

export default handOffCookies;
export { handOffCookies };
