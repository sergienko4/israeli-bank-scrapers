/**
 * Cross-bank fixtures consumed by `LoginFactoryTest.test.ts`.
 *
 * <p>Pulled into a sibling module so the factory test stays under
 * the per-file `import-x/max-dependencies` ceiling (15). Each fixture
 * row reuses the production `*_LOGIN` config verbatim — no
 * duplication, no fake-bank shape drift.
 */

import type { ILoginConfig } from '../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { LEUMI_LOGIN } from '../../../../Scrapers/Pipeline/Banks/Leumi/LeumiPipeline.js';

/** Per-bank fixture for the LOGIN-config `describe.each` block. */
interface IBankLoginFixture {
  readonly bank: string;
  readonly loginConfig: ILoginConfig;
  readonly expectedFieldKeys: readonly string[];
}

/** Bank-fixture table consumed by {@link LoginFactoryTest}'s `describe.each`. */
const BANK_LOGIN_FIXTURES: readonly IBankLoginFixture[] = [
  {
    bank: 'leumi',
    loginConfig: LEUMI_LOGIN,
    expectedFieldKeys: ['username', 'password'],
  },
];

export type { IBankLoginFixture };
export { BANK_LOGIN_FIXTURES };
