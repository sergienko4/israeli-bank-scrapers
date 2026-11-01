/**
 * Yahav native BaNCS request headers (spec §10.2): the fixed set, the call's
 * path, the session ids (empty on the login) and the device's
 * `mag-identifier`. The bearer token, the cookie jar and the `BD_IDENT_KEY`
 * digest are added by the transport and the shape's body digest.
 */

import type { HeaderMap } from '../../../Phases/ApiDirectScrape/IApiDirectScrapeShape.js';
import { YAHAV_NATIVE_HEADERS } from '../../../Registry/Config/PipelineBankConfigYahavConstants.js';

/** What a BaNCS call's headers are built from. */
interface IYahavHeaderArgs {
  /** BaNCS path of the call. */
  readonly path: string;
  /** The device's `mag-identifier`. */
  readonly mag: string;
  /** The current `JSESSIONID` value; empty on the login. */
  readonly session: string;
  /** The current `XSRF-TOKEN` value; empty on the login. */
  readonly xsrf: string;
}

/**
 * Headers for one BaNCS call.
 * @param args - Path, device id and session ids.
 * @returns Header map.
 */
function yahavNativeHeaders(args: IYahavHeaderArgs): HeaderMap {
  return {
    ...YAHAV_NATIVE_HEADERS,
    request_path: args.path,
    JESESSIONID: args.session,
    'X-XSRF-TOKEN': args.xsrf,
    'mag-identifier': args.mag,
  };
}

export default yahavNativeHeaders;
export type { IYahavHeaderArgs };
export { yahavNativeHeaders };
