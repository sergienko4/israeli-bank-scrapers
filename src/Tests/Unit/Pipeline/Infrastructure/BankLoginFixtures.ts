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
  AMEX_LOGIN,
  buildAmexPipeline,
} from '../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import {
  BEINLEUMI_LOGIN,
  buildBeinleumiPipeline,
} from '../../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import {
  buildDiscountPipeline,
  DISCOUNT_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import {
  buildHapoalimPipeline,
  HAPOALIM_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import {
  buildIsracardPipeline,
  ISRACARD_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import {
  buildMassadPipeline,
  MASSAD_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Massad/MassadPipeline.js';
import {
  buildMaxPipeline,
  MAX_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Max/MaxPipeline.js';
import {
  buildMercantilePipeline,
  MERCANTILE_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.js';
import {
  buildOtsarHahayalPipeline,
  OTSAR_HAHAYAL_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/OtsarHahayalPipeline.js';
import {
  buildPagiPipeline,
  PAGI_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/Pagi/PagiPipeline.js';
import {
  buildVisaCalPipeline,
  VISACAL_LOGIN,
} from '../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
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
 * post-auth chain (auth-discovery / account-resolve / dashboard /
 * scrape / balance-resolve) is replaced by the hard-model pair
 * `bind-api-mediator` → `api-direct-scrape` via `withBrowserApiDirect`.
 */
const BASE_PHASES = [
  'init',
  'home',
  'login',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

/** Base + `pre-login` (Amex / Isracard / Max / VisaCal). */
const PRE_LOGIN_PHASES = [
  'init',
  'home',
  'pre-login',
  'login',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

/** Base + `otp-fill` only (Hapoalim soft-OTP). */
const OTP_FILL_PHASES = [
  'init',
  'home',
  'login',
  'otp-fill',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

/** Base + `otp-trigger` + `otp-fill` (mandatory OTP banks). */
const OTP_FULL_PHASES = [
  'init',
  'home',
  'login',
  'otp-trigger',
  'otp-fill',
  'bind-api-mediator',
  'api-direct-scrape',
  'terminate',
] as const;

/**
 * Bank-fixture table consumed by {@link LoginFactoryTest}'s
 * `describe.each`. Order is by phase-shape group:
 * base (6) → pre-login (7) → otp-fill (7) → otp-full (8).
 */
const BANK_LOGIN_FIXTURES: readonly IBankLoginFixture[] = [
  {
    bank: 'discount',
    company: CompanyTypes.Discount,
    loginConfig: DISCOUNT_LOGIN,
    buildPipeline: buildDiscountPipeline,
    expectedFieldKeys: ['id', 'password', 'num'],
    expectedPhaseCount: BASE_PHASES.length,
    expectedPhaseNames: BASE_PHASES,
  },
  {
    bank: 'mercantile',
    company: CompanyTypes.Mercantile,
    loginConfig: MERCANTILE_LOGIN,
    buildPipeline: buildMercantilePipeline,
    expectedFieldKeys: ['id', 'password', 'num'],
    expectedPhaseCount: BASE_PHASES.length,
    expectedPhaseNames: BASE_PHASES,
  },
  {
    bank: 'amex',
    company: CompanyTypes.Amex,
    loginConfig: AMEX_LOGIN,
    buildPipeline: buildAmexPipeline,
    expectedFieldKeys: ['id', 'password', 'card6Digits'],
    expectedPhaseCount: PRE_LOGIN_PHASES.length,
    expectedPhaseNames: PRE_LOGIN_PHASES,
  },
  {
    bank: 'isracard',
    company: CompanyTypes.Isracard,
    loginConfig: ISRACARD_LOGIN,
    buildPipeline: buildIsracardPipeline,
    expectedFieldKeys: ['id', 'password', 'card6Digits'],
    expectedPhaseCount: PRE_LOGIN_PHASES.length,
    expectedPhaseNames: PRE_LOGIN_PHASES,
  },
  {
    bank: 'max',
    company: CompanyTypes.Max,
    loginConfig: MAX_LOGIN,
    buildPipeline: buildMaxPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: PRE_LOGIN_PHASES.length,
    expectedPhaseNames: PRE_LOGIN_PHASES,
  },
  {
    bank: 'visacal',
    company: CompanyTypes.VisaCal,
    loginConfig: VISACAL_LOGIN,
    buildPipeline: buildVisaCalPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: PRE_LOGIN_PHASES.length,
    expectedPhaseNames: PRE_LOGIN_PHASES,
  },
  {
    bank: 'hapoalim',
    company: CompanyTypes.Hapoalim,
    loginConfig: HAPOALIM_LOGIN,
    buildPipeline: buildHapoalimPipeline,
    expectedFieldKeys: ['userCode', 'password'],
    expectedPhaseCount: OTP_FILL_PHASES.length,
    expectedPhaseNames: OTP_FILL_PHASES,
  },
  {
    bank: 'beinleumi',
    company: CompanyTypes.Beinleumi,
    loginConfig: BEINLEUMI_LOGIN,
    buildPipeline: buildBeinleumiPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: OTP_FULL_PHASES.length,
    expectedPhaseNames: OTP_FULL_PHASES,
  },
  {
    bank: 'massad',
    company: CompanyTypes.Massad,
    loginConfig: MASSAD_LOGIN,
    buildPipeline: buildMassadPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: OTP_FULL_PHASES.length,
    expectedPhaseNames: OTP_FULL_PHASES,
  },
  {
    bank: 'otsarHahayal',
    company: CompanyTypes.OtsarHahayal,
    loginConfig: OTSAR_HAHAYAL_LOGIN,
    buildPipeline: buildOtsarHahayalPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: OTP_FULL_PHASES.length,
    expectedPhaseNames: OTP_FULL_PHASES,
  },
  {
    bank: 'pagi',
    company: CompanyTypes.Pagi,
    loginConfig: PAGI_LOGIN,
    buildPipeline: buildPagiPipeline,
    expectedFieldKeys: ['username', 'password'],
    expectedPhaseCount: OTP_FULL_PHASES.length,
    expectedPhaseNames: OTP_FULL_PHASES,
  },
];

export type { IBankLoginFixture };
export { BANK_LOGIN_FIXTURES };
