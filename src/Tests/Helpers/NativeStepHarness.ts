/**
 * Native-step harness — the real api mediator over the real headless native
 * transport, answered by a fake fetch. RunStep tests use it to drive a step
 * through the transport's response hooks end-to-end, without a network.
 */

import type { CompanyTypes } from '../../Definitions.js';
import {
  createApiMediator,
  type IApiMediator,
} from '../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import type { GraphQLFetchStrategy } from '../../Scrapers/Pipeline/Strategy/Fetch/GraphQLFetchStrategy.js';
import { HeadlessNativeFetchStrategy } from '../../Scrapers/Pipeline/Strategy/Fetch/HeadlessNativeFetchStrategy.js';
import { fakeFetch } from './FakeFetch.js';

/** One response header: its name and value. */
export type HeaderPair = [string, string];

/**
 * Point globalThis.fetch at a fake that answers every call with this JSON
 * body and these headers. The caller restores the real fetch.
 * @param body - JSON body of every answer.
 * @param headers - Response headers of every answer.
 * @returns The number of headers each answer carries.
 */
export function installJsonAnswer(body: object, headers: readonly HeaderPair[]): number {
  const fake = fakeFetch((): Response => {
    const init = { headers: new Headers([...headers]) };
    return Response.json(body, init);
  });
  globalThis.fetch = fake.fetchImpl as typeof globalThis.fetch;
  return headers.length;
}

/**
 * Real mediator over the real headless native transport.
 * @param hint - The bank the mediator serves.
 * @param origin - The transport's base URL.
 * @returns The mediator a step fires through.
 */
export function makeNativeMediator(hint: CompanyTypes, origin: string): IApiMediator {
  const graphql = {} as unknown as GraphQLFetchStrategy;
  const transport = new HeadlessNativeFetchStrategy(origin);
  return createApiMediator(hint, transport, graphql);
}
