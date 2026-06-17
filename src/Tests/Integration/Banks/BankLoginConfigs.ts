/**
 * Barrel — exports the `*_LOGIN` config of every bank whose pipeline
 * supports Mode A integration drive. Consolidating these 11 imports
 * into one barrel keeps {@link LoginFormDiscovery.integration.test}
 * under the `import-x/max-dependencies` ceiling while preserving the
 * one-bank-per-line readability at the call-site.
 *
 * <p>Banks added to the pipeline must register their LOGIN const here
 * AND in {@link BankFixtureExpectations} — the pre-commit coverage
 * gate enforces both invariants (see `CheckBankIntegrationCoverage`).
 */

import type { ILoginConfig } from '../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { AMEX_LOGIN } from '../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { BEINLEUMI_LOGIN } from '../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import { DISCOUNT_LOGIN } from '../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { HAPOALIM_LOGIN } from '../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import { ISRACARD_LOGIN } from '../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { LEUMI_LOGIN } from '../../../Scrapers/Pipeline/Banks/Leumi/LeumiPipeline.js';
import { MASSAD_LOGIN } from '../../../Scrapers/Pipeline/Banks/Massad/MassadPipeline.js';
import { MAX_LOGIN } from '../../../Scrapers/Pipeline/Banks/Max/MaxPipeline.js';
import { MERCANTILE_LOGIN } from '../../../Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.js';
import { OTSAR_HAHAYAL_LOGIN } from '../../../Scrapers/Pipeline/Banks/OtsarHahayal/OtsarHahayalPipeline.js';
import { PAGI_LOGIN } from '../../../Scrapers/Pipeline/Banks/Pagi/PagiPipeline.js';
import { VISACAL_LOGIN } from '../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';

/**
 * Map of bankId → exported LoginConfig — used by both Mode A and
 * Mode B drive tests. Declared as `Partial` so consumers MUST check
 * for `undefined` before dereferencing (no implicit assumption that
 * every bank in {@link BankFixtureExpectations} has a config entry).
 */
const BANK_LOGIN_CONFIGS: Readonly<Partial<Record<string, ILoginConfig>>> = {
  amex: AMEX_LOGIN,
  beinleumi: BEINLEUMI_LOGIN,
  discount: DISCOUNT_LOGIN,
  hapoalim: HAPOALIM_LOGIN,
  isracard: ISRACARD_LOGIN,
  leumi: LEUMI_LOGIN,
  massad: MASSAD_LOGIN,
  max: MAX_LOGIN,
  mercantile: MERCANTILE_LOGIN,
  otsarHahayal: OTSAR_HAHAYAL_LOGIN,
  pagi: PAGI_LOGIN,
  visaCal: VISACAL_LOGIN,
};

export default BANK_LOGIN_CONFIGS;
