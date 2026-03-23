/**
 * Unit tests for PipelineFieldResolver.ts.
 * Mocks SelectorResolverPipeline functions to test resolve/enrich paths.
 */

import { jest } from '@jest/globals';
import type { Page } from 'playwright-core';

jest.unstable_mockModule('../../../../../Common/SelectorResolverPipeline.js', () => ({
  probeIframes: jest.fn(),
  probeMainPage: jest.fn(),
  buildNotFoundContext: jest.fn(),
}));

jest.unstable_mockModule('../../../../../Common/SelectorResolver.js', () => ({
  isPage: jest.fn(),
  tryInContext: jest.fn(),
  tryInContextInternal: jest.fn(),
  candidateToCss: jest.fn((c: { kind: string; value: string }) => c.value),
  extractCredentialKey: jest.fn((s: string) => s),
  queryWithTimeout: jest.fn(),
  toXpathLiteral: jest.fn((v: string) => `"${v}"`),
}));

jest.unstable_mockModule('../../../../../Scrapers/Pipeline/Mediator/MetadataExtractors.js', () => ({
  extractMetadata: jest.fn(),
  EMPTY_METADATA: {
    id: '',
    className: '',
    tagName: '',
    type: '',
    name: '',
    formId: '',
    ariaLabel: '',
    placeholder: '',
    isVisible: false,
  },
}));

const SRP_MOD = await import('../../../../../Common/SelectorResolverPipeline.js');
const SR_MOD = await import('../../../../../Common/SelectorResolver.js');
const META_MOD = await import('../../../../../Scrapers/Pipeline/Mediator/MetadataExtractors.js');
const RESOLVER_MOD =
  await import('../../../../../Scrapers/Pipeline/Mediator/PipelineFieldResolver.js');
const FACTORY = await import('../MockPipelineFactories.js');

/** Shared mock page for all tests — page content is irrelevant since resolution is mocked. */
const MOCK_PAGE: Page = FACTORY.makeMockFullPage();

/** Resolved IFieldContext for mock returns. */
const RESOLVED_CTX = {
  isResolved: true,
  selector: '#mat-input-2',
  context: MOCK_PAGE,
  resolvedVia: 'wellKnown' as const,
  round: 'mainPage' as const,
};

/** Not-found IFieldContext. */
const NOT_FOUND_CTX = {
  isResolved: false,
  selector: '',
  context: MOCK_PAGE,
  resolvedVia: 'notResolved' as const,
  round: 'notResolved' as const,
  message: 'not found',
};

/** Full metadata for mock returns. */
const MOCK_META = {
  id: 'mat-input-2',
  className: '',
  tagName: 'input',
  type: 'text',
  name: '',
  formId: '',
  ariaLabel: '',
  placeholder: '',
  isVisible: true,
};

// ── resolveFieldPipeline ─────────────────────────────────

describe('resolveFieldPipeline/success-main-page', () => {
  it('returns isResolved=true when probeMainPage finds the field', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false); // treat as Frame → skip probeIframes
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue(RESOLVED_CTX);
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    const page = MOCK_PAGE;
    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: page,
      fieldKey: 'username',
      bankCandidates: [],
    });
    expect(result.isResolved).toBe(true);
    expect(result.selector).toBe('#mat-input-2');
  });

  it('attaches metadata when resolved with CSS selector', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue(RESOLVED_CTX);
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'username',
      bankCandidates: [],
    });
    expect(result.metadata?.id).toBe('mat-input-2');
  });

  it('metadata is EMPTY_METADATA when extractMetadata throws (xpath selector)', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue({
      ...RESOLVED_CTX,
      selector: 'xpath=//button[contains(., "כניסה")]',
    });
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockRejectedValue(new Error('invalid selector'));

    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: '__submit__',
      bankCandidates: [],
    });
    expect(result.metadata).toBeDefined();
    expect(result.metadata?.id).toBe('');
  });
});

describe('resolveFieldPipeline/iframe-search', () => {
  it('calls probeIframes when pageOrFrame is a Page', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(true); // is a Page → call probeIframes
    const probeIframes = SRP_MOD.probeIframes as jest.Mock;
    probeIframes.mockResolvedValue(RESOLVED_CTX); // found in iframe
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    const page = MOCK_PAGE;
    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: page,
      fieldKey: 'username',
      bankCandidates: [],
    });
    expect(probeIframes).toHaveBeenCalled();
    expect(result.isResolved).toBe(true);
  });

  it('falls through to probeMainPage when probeIframes returns IFieldMatch (not resolved)', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(true);
    const probeIframes = SRP_MOD.probeIframes as jest.Mock;
    probeIframes.mockResolvedValue({ selector: '', context: MOCK_PAGE }); // not IFieldContext
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue(RESOLVED_CTX);
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'username',
      bankCandidates: [],
    });
    expect(SRP_MOD.probeMainPage).toHaveBeenCalled();
    expect(result.isResolved).toBe(true);
  });
});

describe('resolveFieldPipeline/not-found', () => {
  it('returns isResolved=false when field not found on any context', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue({ selector: '', context: MOCK_PAGE }); // IFieldMatch, not resolved
    const buildNotFound = SRP_MOD.buildNotFoundContext as jest.Mock;
    buildNotFound.mockResolvedValue(NOT_FOUND_CTX);

    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'id',
      bankCandidates: [],
    });
    expect(result.isResolved).toBe(false);
  });

  it('metadata is undefined when not resolved', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue({ selector: '', context: MOCK_PAGE });
    const buildNotFound = SRP_MOD.buildNotFoundContext as jest.Mock;
    buildNotFound.mockResolvedValue(NOT_FOUND_CTX);

    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'id',
      bankCandidates: [],
    });
    expect(result.metadata).toBeUndefined();
  });
});

describe('resolveFieldPipeline/frame-context', () => {
  it('resolves field when context is a Frame (no url property)', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue(RESOLVED_CTX);
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);
    const mockFrame = {} as unknown as Page;
    const result = await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: mockFrame,
      fieldKey: 'username',
      bankCandidates: [],
    });
    expect(result.isResolved).toBe(true);
  });
});

describe('resolveFieldPipeline/wellKnown-lookup', () => {
  it('uses WellKnown candidates for known field key (e.g. username)', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    probeMain.mockResolvedValue(RESOLVED_CTX);
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    const capturedOpts: unknown[] = [];
    probeMain.mockImplementation((opts: unknown) => {
      capturedOpts.push(opts);
      return Promise.resolve(RESOLVED_CTX);
    });

    await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'username',
      bankCandidates: [],
    });
    const opts = capturedOpts[0] as { wellKnownCandidates: unknown[] };
    expect(opts.wellKnownCandidates.length).toBeGreaterThan(0);
  });

  it('returns empty wellKnown for unknown field key', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    const capturedOpts: unknown[] = [];
    probeMain.mockImplementation((opts: unknown) => {
      capturedOpts.push(opts);
      return Promise.resolve(RESOLVED_CTX);
    });
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: 'unknownField123',
      bankCandidates: [],
    });
    const opts = capturedOpts[0] as { wellKnownCandidates: unknown[] };
    expect(opts.wellKnownCandidates).toHaveLength(0);
  });

  it('uses WellKnown candidates for __submit__ key', async () => {
    const isPageFn = SR_MOD.isPage as unknown as jest.Mock;
    isPageFn.mockReturnValue(false);
    const probeMain = SRP_MOD.probeMainPage as jest.Mock;
    const capturedOpts: unknown[] = [];
    probeMain.mockImplementation((opts: unknown) => {
      capturedOpts.push(opts);
      return Promise.resolve(RESOLVED_CTX);
    });
    const metaFn = META_MOD.extractMetadata as jest.Mock;
    metaFn.mockResolvedValue(MOCK_META);

    await RESOLVER_MOD.resolveFieldPipeline({
      pageOrFrame: MOCK_PAGE,
      fieldKey: '__submit__',
      bankCandidates: [],
    });
    const opts = capturedOpts[0] as { wellKnownCandidates: unknown[] };
    expect(opts.wellKnownCandidates.length).toBeGreaterThan(0);
  });
});
