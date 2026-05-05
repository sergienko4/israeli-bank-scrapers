/**
 * Unit tests for Mediator/Api/ApiMediatorAccessor — generic narrower of
 * the pipeline context's mediator slot to an IApiMediator.
 * Also guards that the source file contains ZERO bank-name literals.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

import { jest } from '@jest/globals';

import { ScraperErrorTypes } from '../../../../../Scrapers/Base/ErrorTypes.js';
import type { IApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.js';
import { resolveApiMediator } from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediatorAccessor.js';
import { none, some } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type { IPipelineContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import { makeMockContext } from '../../Infrastructure/MockFactories.js';

/**
 * Build a stub IApiMediator — no behaviour, just shape satisfaction.
 * @returns A minimal mediator with jest.fn() stubs for each method.
 */
function makeStubMediator(): IApiMediator {
  return {
    apiPost: jest.fn(),
    apiGet: jest.fn(),
    apiQuery: jest.fn(),
    setBearer: jest.fn(),
  } as unknown as IApiMediator;
}

describe('resolveApiMediator — resolver behaviour', () => {
  it('returns succeed(mediator) when slot has value', () => {
    const bus = makeStubMediator();
    const base = makeMockContext();
    const ctx: IPipelineContext = {
      ...base,
      apiMediator: some(bus),
    };
    const result = resolveApiMediator(ctx, 'TestLabel');
    assertOk(result);
    expect(result.value).toBe(bus);
  });

  it('returns fail with Generic error when slot is absent', () => {
    const base = makeMockContext();
    const ctx: IPipelineContext = { ...base, mediator: none() };
    const result = resolveApiMediator(ctx, 'TestLabel');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorType).toBe(ScraperErrorTypes.Generic);
      expect(result.errorMessage).toContain('ApiMediator missing');
      expect(result.errorMessage).toContain('TestLabel');
    }
  });
});

/**
 * Resolve this test file's directory via import.meta.url (ESM-safe).
 * @returns Absolute directory of this test file.
 */
function thisDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  return dirname(thisFile);
}

describe('ApiMediatorAccessor — source file bank-agnostic guard', () => {
  it('source file contains ZERO bank-name literals', () => {
    const here = thisDir();
    const filePath = resolvePath(
      here,
      '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediatorAccessor.ts',
    );
    const source = readFileSync(filePath, 'utf8');
    const bannedNamesPattern =
      /\b(oneZero|amex|isracard|hapoalim|discount|visaCal|max|beinleumi|massad|mercantile|otsarHahayal|pagi)\b/i;
    const hit = bannedNamesPattern.exec(source);
    expect(hit).toBeNull();
  });
});
