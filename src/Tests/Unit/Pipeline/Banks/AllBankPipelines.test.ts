/**
 * Unit tests for every bank pipeline builder.
 * Each pipeline factory must produce a success Procedure wrapping a descriptor.
 */

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
import { buildVisaCalPipeline } from '../../../../Scrapers/Pipeline/Banks/VisaCal/VisaCalPipeline.js';
import type { IPipelineDescriptor } from '../../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { Procedure } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { isOk } from '../../../../Scrapers/Pipeline/Types/Procedure.js';
import { makeMockOptions } from '../Infrastructure/MockFactories.js';

/** Signature of each bank's pipeline builder. */
type BankBuilder = (opts: ReturnType<typeof makeMockOptions>) => Procedure<IPipelineDescriptor>;

/** Labelled entry for parameterised tests. */
const BANK_BUILDERS: readonly (readonly [string, BankBuilder])[] = [
  ['amex', buildAmexPipeline],
  ['beinleumi', buildBeinleumiPipeline],
  ['discount', buildDiscountPipeline],
  ['hapoalim', buildHapoalimPipeline],
  ['isracard', buildIsracardPipeline],
  ['massad', buildMassadPipeline],
  ['max', buildMaxPipeline],
  ['mercantile', buildMercantilePipeline],
  ['oneZero', buildOneZeroPipeline],
  ['otsarHahayal', buildOtsarHahayalPipeline],
  ['pagi', buildPagiPipeline],
  ['visaCal', buildVisaCalPipeline],
];

describe('All bank pipelines', () => {
  it.each(BANK_BUILDERS)('%s builder returns success Procedure', (_name, build) => {
    const opts = makeMockOptions();
    const result = build(opts);
    const isOkResult1 = isOk(result);
    expect(isOkResult1).toBe(true);
  });

  it.each(BANK_BUILDERS)(
    '%s descriptor carries options + phases + interceptors',
    (_name, build) => {
      const opts = makeMockOptions();
      const result = build(opts);
      const isOkResult2 = isOk(result);
      expect(isOkResult2).toBe(true);
      if (isOk(result)) {
        expect(result.value.options).toBe(opts);
        const isArrayResult3 = Array.isArray(result.value.phases);
        expect(isArrayResult3).toBe(true);
        const isArrayResult4 = Array.isArray(result.value.interceptors);
        expect(isArrayResult4).toBe(true);
      }
    },
  );
});
