/**
 * Cross-bank fixtures consumed by `LoginFactoryTest.test.ts`.
 *
 * <p>Pulled into a sibling module so the factory test stays under
 * the per-file `import-x/max-dependencies` ceiling (15). This
 * module legitimately needs every browser-flow bank's pipeline
 * surface — exempting one fixtures file is the correct trade-off
 * versus exempting the entire test file.
 *
 * <p>Each fixture row reuses the production `*_LOGIN` config and
 * `build*Pipeline` builder verbatim — no duplication, no fake-bank
 * shape drift.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import type { ScraperOptions } from '../../../../Scrapers/Base/Interface.js';
import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import {
  buildMercantilePipeline,
  MERCANTILE_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';

/** Per-bank fixture for the LOGIN-shape `describe.each` block. */
interface IBankLoginFixture {
  readonly bank: string;
  readonly company: CompanyTypes;
  readonly loginConfig: ILoginConfig;
  readonly buildPipeline: (opts: ScraperOptions) => Procedure<IPipelineDescriptor>;
  readonly expectedFieldKeys: readonly string[];
  readonly expectedPhaseCount: number;
  readonly expectedPhaseNames: readonly string[];
}

/**
 * Base phases shared by every migrated browser bank. The generic
 * post-auth chain (account-resolve / dashboard / scrape / balance-resolve)
 * is replaced by the hard-model pair `bind-api-mediator` →
 * `api-direct-scrape` via `withBrowserApiDirect`; `auth-discovery` is
 * retained to establish the data-API session before BIND.
 */
const BASE_PHASES = [
  'init',
  'home',
  'login',
  'auth-discovery',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

/**
 * Bank-fixture table consumed by {@link LoginFactoryTest}'s
 * `describe.each`. Every remaining browser bank runs the base
 * phases (7) with no OTP step.
 */
const BANK_LOGIN_FIXTURES: readonly IBankLoginFixture[] = [
  {
    bank: 'mercantile',
    company: CompanyTypes.Mercantile,
    loginConfig: MERCANTILE_LOGIN,
    buildPipeline: buildMercantilePipeline,
    expectedFieldKeys: ['id', 'password', 'num'],
    expectedPhaseCount: BASE_PHASES.length,
    expectedPhaseNames: BASE_PHASES,
  },
];

export type { IBankLoginFixture };
export { BANK_LOGIN_FIXTURES };
