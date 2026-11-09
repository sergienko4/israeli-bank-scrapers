/**
 * Unit tests for every bank pipeline builder.
 * Each pipeline factory must produce a success Procedure wrapping a descriptor.
 * Each builder runs under its own bank id, as in production: build-time
 * config rules read that bank's registry entry.
 */

import { CompanyTypes } from '../../../../Definitions.js';
import { buildAmexPipeline } from '../../../../Scrapers/Pipeline/Banks/Amex/AmexPipeline.js';
import { buildBeinleumiPipeline } from '../../../../Scrapers/Pipeline/Banks/Beinleumi/BeinleumiPipeline.js';
import { buildDiscountPipeline } from '../../../../Scrapers/Pipeline/Banks/Discount/DiscountPipeline.js';
import { buildHapoalimPipeline } from '../../../../Scrapers/Pipeline/Banks/Hapoalim/HapoalimPipeline.js';
import { buildIsracardPipeline } from '../../../../Scrapers/Pipeline/Banks/Isracard/IsracardPipeline.js';
import { buildMassadPipeline } from '../../../../Scrapers/Pipeline/Banks/Massad/MassadPipeline.js';
import { buildMaxPipeline } from '../../../../Scrapers/Pipeline/Banks/Max/MaxPipeline.js';
import { buildMercantilePipeline } from '../../../../Scrapers/Pipeline/Banks/Mercantile/MercantilePipeline.js';
import { buildOneZeroPipeline } from '../../../../Scrapers/Pipeline/Banks/OneZero/OneZeroPipeline.js';
import { buildOtsarHahayalPipeline } from '../../../../Scrapers/Pipeline/Banks/OtsarHahayal/OtsarHahayalPipeline.js';
import { buildPagiPipeline } from '../../../../Scrapers/Pipeline/Banks/Pagi/PagiPipeline.js';
import { buildPayBoxPipeline } from '../../../../Scrapers/Pipeline/Banks/PayBox/PayBoxPipeline.js';
import { buildVisaCalPipeline } from '../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockOptions } from '../Infrastructure/MockFactories.js';

/** Signature of each bank's pipeline builder. */
type BankBuilder = (opts: ReturnType<typeof makeMockOptions>) => Procedure<IPipelineDescriptor>;

/** Labelled entry for parameterised tests. */
const BANK_BUILDERS: readonly (readonly [CompanyTypes, BankBuilder])[] = [
  [CompanyTypes.Amex, buildAmexPipeline],
  [CompanyTypes.Beinleumi, buildBeinleumiPipeline],
  [CompanyTypes.Discount, buildDiscountPipeline],
  [CompanyTypes.Hapoalim, buildHapoalimPipeline],
  [CompanyTypes.Isracard, buildIsracardPipeline],
  [CompanyTypes.Massad, buildMassadPipeline],
  [CompanyTypes.Max, buildMaxPipeline],
  [CompanyTypes.Mercantile, buildMercantilePipeline],
  [CompanyTypes.OneZero, buildOneZeroPipeline],
  [CompanyTypes.OtsarHahayal, buildOtsarHahayalPipeline],
  [CompanyTypes.Pagi, buildPagiPipeline],
  [CompanyTypes.PayBox, buildPayBoxPipeline],
  [CompanyTypes.VisaCal, buildVisaCalPipeline],
];

describe('All bank pipelines', () => {
  it.each(BANK_BUILDERS)('%s builder returns success Procedure', (companyId, build) => {
    const opts = makeMockOptions({ companyId });
    const result = build(opts);
    expect(result.success).toBe(true);
  });

  it.each(BANK_BUILDERS)(
    '%s descriptor carries options + phases',
    (companyId, build) => {
      const opts = makeMockOptions({ companyId });
      const result = build(opts);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.value.options).toBe(opts);
        const isArrayResult3 = Array.isArray(result.value.phases);
        expect(isArrayResult3).toBe(true);
      }
    },
  );
});
