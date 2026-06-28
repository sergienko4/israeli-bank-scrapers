import {
  type IRaceResult,
  NOT_FOUND_RESULT,
} from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementMediator.js';
import type { IDiscoveredEndpoint } from '../../../../../Scrapers/Pipeline/Mediator/Network/NetworkDiscoveryTypes.js';
import { type Procedure, succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';

/**
 * Shared no-op nudge result — a `found:false` success matching the real
 * `resolveAndClick` contract (`Promise<Procedure<IRaceResult>>`) without
 * driving an id into the pool.
 */
export const NUDGE_NOOP_RESULT: Procedure<IRaceResult> = succeed(NOT_FOUND_RESULT);

/** Args for {@link makeCapture}. */
export interface IMakeCaptureArgs {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly responseBody: unknown;
  readonly postData?: string;
}

/**
 * Build a synthetic discovered endpoint.
 * @param args - Capture args.
 * @returns Synthetic IDiscoveredEndpoint.
 */
export function makeCapture(args: IMakeCaptureArgs): IDiscoveredEndpoint {
  return {
    url: args.url,
    method: args.method,
    postData: args.postData ?? '',
    responseBody: args.responseBody,
    contentType: 'application/json',
    requestHeaders: {},
    responseHeaders: {},
    timestamp: 100,
  };
}
