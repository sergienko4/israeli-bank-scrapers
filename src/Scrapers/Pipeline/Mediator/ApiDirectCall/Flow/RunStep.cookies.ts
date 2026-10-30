/**
 * On-set-cookie sink builder. The jar itself is the shared
 * `Strategy/Fetch/CookieJar` leaf, re-exported by the RunStep barrel.
 */

import type { IRunStepArgs, IStepCookieJar, OnSetCookie } from './RunStep.types.js';

/**
 * Forward Set-Cookie lines to a bound jar.
 * @param jar - Bound cookie jar instance.
 * @returns Cookie-sink callback.
 */
function bindJarSink(jar: IStepCookieJar): OnSetCookie {
  return (cookies): number => jar.add(cookies);
}

/**
 * Resolve the optional Set-Cookie sink for this step.
 * @param args - Run-step args.
 * @returns Callback when a jar is configured; false otherwise.
 */
function buildOnSetCookie(args: IRunStepArgs): OnSetCookie | false {
  if (!args.step.cookieJar) return false;
  if (args.cookieJar === undefined) return false;
  return bindJarSink(args.cookieJar);
}

export default buildOnSetCookie;
