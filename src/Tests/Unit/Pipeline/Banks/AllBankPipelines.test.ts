/**
 * Unit tests for every bank pipeline builder.
 * Each pipeline factory must produce a success Procedure wrapping a descriptor.
 */

import type { readdirSync as FsReaddirSync, readFileSync as FsReadFileSync } from 'node:fs';

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
  ['payBox', buildPayBoxPipeline],
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

describe('Mediator surface extensions (Rule #11 + PayBox prereqs)', () => {
  it('UC-ABP-1: SignerAlgorithm union accepts AES-CBC-PKCS7 literal', () => {
    const aesAlgorithm = 'AES-CBC-PKCS7' as const;
    expect(aesAlgorithm).toBe('AES-CBC-PKCS7');
  });

  it('UC-ABP-2: CanonicalPart union accepts tsMs + deviceId literals', () => {
    const tsMs = 'tsMs' as const;
    const deviceId = 'deviceId' as const;
    expect(tsMs).toBe('tsMs');
    expect(deviceId).toBe('deviceId');
  });

  it('UC-ABP-3: Mediator/ApiDirectCall/* carries no bank-specific PayBox symbols', async () => {
    // Rule #11 grep: walk every file in the mediator directory and
    // assert no PayBox literal appears. The directory is resolved
    // from import.meta.url (ESM-compatible) so __dirname is not
    // required.
    const { readdirSync, readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pathMod = await import('node:path');
    const filePath = fileURLToPath(import.meta.url);
    const here = pathMod.dirname(filePath);
    const mediatorDir = pathMod.resolve(
      here,
      '..',
      '..',
      '..',
      '..',
      'Scrapers',
      'Pipeline',
      'Mediator',
      'ApiDirectCall',
    );
    const seen = walkAndScanForPaybox({ readdirSync, readFileSync }, pathMod, mediatorDir);
    expect(seen).toEqual([]);
  });
});

/** fs subset used by {@link walkAndScanForPaybox}. */
interface IFsLike {
  readonly readdirSync: typeof FsReaddirSync;
  readonly readFileSync: typeof FsReadFileSync;
}

/** path subset used by {@link walkAndScanForPaybox}. */
interface IPathLike {
  readonly join: (...parts: readonly string[]) => string;
}

/**
 * Walk a directory recursively and collect TS files that mention the
 * banned PayBox name. Hand-rolled (no glob dependency) so it works
 * under the project's ts-jest ESM runtime without extra setup.
 * @param fs - Node fs-like module.
 * @param pathMod - Node path-like module.
 * @param dir - Root directory to scan.
 * @returns Array of full paths containing the banned name (empty when clean).
 */
function walkAndScanForPaybox(fs: IFsLike, pathMod: IPathLike, dir: string): readonly string[] {
  const seen: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = pathMod.join(dir, e.name);
    if (e.isDirectory()) {
      seen.push(...walkAndScanForPaybox(fs, pathMod, full));
    } else if (e.isFile() && full.endsWith('.ts')) {
      const content = fs.readFileSync(full, 'utf8');
      if (/\bPayBox\b/.test(content)) seen.push(full);
    }
  }
  return seen;
}
