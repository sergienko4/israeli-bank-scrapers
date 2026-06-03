/**
 * Headless-mediator factory types — args bundles + strategy pairs for the
 * native and browser-backed headless ApiMediator factories. Extracted from
 * `ApiMediator.types.ts` to keep that file under the strict 150-LoC cap.
 */

import type { CompanyTypes } from '../../../../Definitions.js';
import type { CamoufoxIdentityFetchStrategy } from '../../Strategy/Fetch/CamoufoxIdentityFetchStrategy.js';
import type { GraphQLFetchStrategy } from '../../Strategy/Fetch/GraphQLFetchStrategy.js';
import type { NativeFetchStrategy } from '../../Strategy/Fetch/NativeFetchStrategy.js';

/** Args bundle for the headless-mediator factory. */
interface IHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly graphqlUrl: string;
  readonly staticAuth?: string;
}

/** Bundled strategy pair returned by the headless builder. */
interface IHeadlessStrategies {
  readonly fetch: NativeFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

/** Args bundle for the browser-backed headless-mediator factory. */
interface IBrowserBackedHeadlessMediatorArgs {
  readonly bankHint: CompanyTypes;
  readonly identityBaseUrl: string;
  readonly identityOriginUrl: string;
  readonly graphqlUrl: string;
  readonly staticAuth?: string;
  readonly bypassOriginChallenge?: boolean;
}

/** Bundled strategy pair returned by the browser-backed headless builder. */
interface IBrowserBackedStrategies {
  readonly fetch: CamoufoxIdentityFetchStrategy;
  readonly gql: GraphQLFetchStrategy;
}

export type {
  IBrowserBackedHeadlessMediatorArgs,
  IBrowserBackedStrategies,
  IHeadlessMediatorArgs,
  IHeadlessStrategies,
};
