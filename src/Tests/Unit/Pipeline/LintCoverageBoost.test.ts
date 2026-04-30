/**
 * LintCoverageBoost — targeted branch coverage for helper code introduced
 * during the lint-resolution pass. Each block exercises a specific
 * branch that the existing suite does not reach.
 */

import { ScraperErrorTypes } from '../../../Scrapers/Base/ErrorTypes.js';
import type { ScraperOptions } from '../../../Scrapers/Base/Interface.js';
import ScraperError from '../../../Scrapers/Base/ScraperError.js';
import { executePipeline } from '../../../Scrapers/Pipeline/Core/Executor/PipelineExecutor.js';
import type { IPipelineDescriptor } from '../../../Scrapers/Pipeline/Core/PipelineDescriptor.js';
import type { JsonValue } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import { walkPointer } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Envelope/JsonPointer.js';
import type {
  IApiDirectCallConfig,
  JsonValueTemplate,
} from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/IApiDirectCallConfig.js';
import { hydrate } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/GenericBodyTemplate.js';
import type { ITemplateScope } from '../../../Scrapers/Pipeline/Mediator/ApiDirectCall/Template/RefResolver.js';
import type { IActionContext } from '../../../Scrapers/Pipeline/Types/PipelineContext.js';
import type { Procedure } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { fail } from '../../../Scrapers/Pipeline/Types/Procedure.js';
import { SimplePhase } from '../../../Scrapers/Pipeline/Types/SimplePhase.js';

const EMPTY_CONFIG = {} as unknown as IApiDirectCallConfig;
const EMPTY_SCOPE: ITemplateScope = { carry: {}, creds: {}, config: EMPTY_CONFIG };

const MOCK_OPTIONS = {
  companyId: 'beinleumi',
  startDate: new Date('2024-01-01'),
} as unknown as ScraperOptions;
const MOCK_CREDENTIALS = { username: 'user', password: 'pass' };

describe('JsonPointer.walkPointer — extended-syntax guards', () => {
  it('*prop pick — non-plain-object entries are skipped; first match wins', () => {
    const doc: JsonValue = { arr: [null, ['x'], { target: 'hit' }] };
    const result = walkPointer(doc, '/arr/*target');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe('hit');
  });

  it('*prop pick — returns miss when no array entry carries the property', () => {
    const doc: JsonValue = { arr: [{ other: 1 }, null] };
    const result = walkPointer(doc, '/arr/*target');
    expect(result.success).toBe(false);
  });

  it('*prop pick — miss when cursor is not an array', () => {
    const doc: JsonValue = { arr: { nested: 'no' } };
    const result = walkPointer(doc, '/arr/*target');
    expect(result.success).toBe(false);
  });

  it('?k=v filter — miss when expression lacks "="', () => {
    const doc: JsonValue = { arr: [{ type: 'a' }] };
    const result = walkPointer(doc, '/arr/?typea');
    expect(result.success).toBe(false);
  });

  it('?k=v filter — miss when array element lacks the key', () => {
    const doc: JsonValue = { arr: [{ other: 'x' }] };
    const result = walkPointer(doc, '/arr/?type=a');
    expect(result.success).toBe(false);
  });

  it('?k=v filter — miss when value does not match', () => {
    const doc: JsonValue = { arr: [{ type: 'b' }] };
    const result = walkPointer(doc, '/arr/?type=a');
    expect(result.success).toBe(false);
  });

  it('?k=v filter — miss when cursor is not an array', () => {
    const doc: JsonValue = { arr: { not: 'array' } };
    const result = walkPointer(doc, '/arr/?k=v');
    expect(result.success).toBe(false);
  });

  it('returns the document for "/" pointer', () => {
    const doc: JsonValue = { a: 1 };
    const result = walkPointer(doc, '/');
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(doc);
  });

  it('miss when walking through a null cursor', () => {
    const doc: JsonValue = { a: null };
    const result = walkPointer(doc, '/a/b');
    expect(result.success).toBe(false);
  });
});

describe('GenericBodyTemplate.hydrate — literal + array shapes', () => {
  it('hydrates a null $literal value', () => {
    const template = { $literal: null } as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBeNull();
  });

  it('hydrates a number $literal value', () => {
    const template = { $literal: 42 } as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toBe(42);
  });

  it('hydrates an object $literal value', () => {
    const payload = { deeply: { nested: 'ok' } } as const;
    const template = { $literal: payload } as unknown as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(payload);
  });

  it('hydrates an array template element-wise', () => {
    const template = [{ $literal: 'a' }, { $literal: 'b' }] as unknown as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(true);
    if (result.success) expect(result.value).toEqual(['a', 'b']);
  });

  it('propagates failure from the first array element', () => {
    const template = [{ $ref: 'carry.missing' }] as unknown as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(false);
  });

  it('propagates failure from a record entry', () => {
    const template = { a: { $ref: 'carry.missing' } } as unknown as JsonValueTemplate;
    const result = hydrate(template, EMPTY_SCOPE);
    expect(result.success).toBe(false);
  });
});

type PhaseName = ConstructorParameters<typeof SimplePhase>[0];

/**
 * Build a SimplePhase that fails with a specific name — used to exercise
 * the NO_RETRY branch in PipelineReducer.
 * @param name - Phase name.
 * @param message - Failure message.
 * @returns A phase whose execute returns a failure procedure.
 */
function buildFailingPhase(name: PhaseName, message: string): SimplePhase {
  /**
   * Failing execute.
   * @returns Failure procedure.
   */
  const exec = (): Promise<Procedure<IActionContext>> => {
    const failure = fail(ScraperErrorTypes.Generic, message);
    return Promise.resolve(failure);
  };
  return new SimplePhase(name, exec);
}

/**
 * Build a SimplePhase whose execute throws synchronously — used to
 * exercise the wrapError catch in PipelineExecutor.
 * @param name - Phase name.
 * @returns A phase whose execute throws.
 */
function buildThrowingPhase(name: PhaseName): SimplePhase {
  /**
   * Throwing execute.
   * @returns Never — throws.
   */
  const exec = (): Promise<Procedure<IActionContext>> => {
    throw new ScraperError('boom');
  };
  return new SimplePhase(name, exec);
}

describe('PipelineReducer — api-direct-call NO_RETRY path', () => {
  it('skips sanitization pulse for api-direct-call failures', async () => {
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [buildFailingPhase('api-direct-call', 'api-direct-call failed')],
      interceptors: [],
    };
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errorMessage).toBe('api-direct-call failed');
  });

  it('executePipeline wraps thrown errors via wrapError', async () => {
    const descriptor: IPipelineDescriptor = {
      options: MOCK_OPTIONS,
      phases: [buildThrowingPhase('init')],
      interceptors: [],
    };
    const result = await executePipeline(descriptor, MOCK_CREDENTIALS);
    expect(result.success).toBe(false);
  });
});
