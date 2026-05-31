/**
 * Phase H+ shared map: {@link PhaseHBank} → production
 * {@link ILoginConfig}. Single source-of-truth so per-phase tests that
 * need to drive ACTION through real LOGIN configs (currently only
 * {@link LoginPhaseFactory}) don't duplicate the bank-to-config
 * binding inline and don't blow `import-x/max-dependencies` ceilings
 * by importing each bank's pipeline module directly (CodeRabbit
 * cycle #5 finding #4).
 */

import type { ILoginConfig } from '../../../../../../Scrapers/Base/Interfaces/Config/LoginConfig.js';
import { AMEX_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { BEINLEUMI_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import { DISCOUNT_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { HAPOALIM_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import { ISRACARD_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { MAX_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/Max/MaxPipeline.js';
import { VISACAL_LOGIN } from '../../../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import type { PhaseHBank } from './_makePhaseFixture.js';

/**
 * Bank-to-loginConfig map. Production {@link ILoginConfig} constants
 * live in each bank's pipeline module; this is the one place that
 * binds them to the {@link PhaseHBank} discriminator.
 */
const BANK_LOGIN_CONFIGS: Readonly<Record<PhaseHBank, ILoginConfig>> = {
  hapoalim: HAPOALIM_LOGIN,
  beinleumi: BEINLEUMI_LOGIN,
  discount: DISCOUNT_LOGIN,
  amex: AMEX_LOGIN,
  isracard: ISRACARD_LOGIN,
  max: MAX_LOGIN,
  visacal: VISACAL_LOGIN,
};

export default BANK_LOGIN_CONFIGS;
