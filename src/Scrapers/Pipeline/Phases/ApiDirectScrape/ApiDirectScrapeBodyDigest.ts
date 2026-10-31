/**
 * Scrape-phase body digest (N30): adds the shape's digest header to a REST
 * object POST's opts, computed over the bytes of the one JSON serializer the
 * transport's `json` writer sends. GET, array POST and GraphQL steps never
 * reach here, so they carry no digest.
 */

import type { IApiQueryOpts } from '../../Mediator/Api/ApiMediator.js';
import type { IBodyDigestConfig } from '../../Mediator/ApiDirectCall/ConfigContracts/index.js';
import { computeBodyDigest } from '../../Mediator/ApiDirectCall/Crypto/BodyDigest.js';
import { serializeJsonBody } from '../../Strategy/Fetch/JsonBody.js';
import type { VarsMap } from './IApiDirectScrapeShape.js';

/**
 * Opts with the body digest header added, when the shape declares one.
 * @param opts - The step's opts.
 * @param body - Final body, after any signer.
 * @param digest - The shape's digest config, if any.
 * @returns The same opts when no digest is declared; else a copy with the header.
 */
function withBodyDigest(
  opts: IApiQueryOpts,
  body: VarsMap,
  digest?: IBodyDigestConfig,
): IApiQueryOpts {
  if (digest === undefined) return opts;
  const serialized = serializeJsonBody(body);
  const value = computeBodyDigest(serialized.bytes, digest);
  return { ...opts, extraHeaders: { ...opts.extraHeaders, [digest.header]: value } };
}

export default withBodyDigest;
export { withBodyDigest };
