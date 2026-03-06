import {
  BrowserEngineType,
  getGlobalEngineChain,
  isCapableOfInitScript,
  setGlobalDefaultEngine,
  setGlobalEngineChain,
} from '../../Common/BrowserEngine';

/** Saves and restores the global engine chain around each test. */
let savedChain: BrowserEngineType[];

beforeEach(() => {
  savedChain = getGlobalEngineChain().slice();
});

afterEach(() => {
  setGlobalEngineChain(savedChain);
});

describe('isCapableOfInitScript', () => {
  it('returns false for Camoufox', () => {
    const isCapable = isCapableOfInitScript(BrowserEngineType.Camoufox);
    expect(isCapable).toBe(false);
  });

  it('returns true for PlaywrightStealth', () => {
    const isCapable = isCapableOfInitScript(BrowserEngineType.PlaywrightStealth);
    expect(isCapable).toBe(true);
  });

  it('returns true for Rebrowser', () => {
    const isCapable = isCapableOfInitScript(BrowserEngineType.Rebrowser);
    expect(isCapable).toBe(true);
  });

  it('returns true for Patchright', () => {
    const isCapable = isCapableOfInitScript(BrowserEngineType.Patchright);
    expect(isCapable).toBe(true);
  });
});

describe('getGlobalEngineChain', () => {
  it('starts with PlaywrightStealth as the first entry (Camoufox is opt-in)', () => {
    expect(getGlobalEngineChain()[0]).toBe(BrowserEngineType.PlaywrightStealth);
  });

  it('contains 3 Chromium engines by default (Camoufox requires separate binary install)', () => {
    const chain = getGlobalEngineChain();
    expect(chain).toEqual([
      BrowserEngineType.PlaywrightStealth,
      BrowserEngineType.Rebrowser,
      BrowserEngineType.Patchright,
    ]);
  });
});

describe('setGlobalEngineChain', () => {
  it('replaces the chain with the provided list', () => {
    setGlobalEngineChain([BrowserEngineType.Rebrowser, BrowserEngineType.Patchright]);
    const chain = getGlobalEngineChain();
    expect(chain).toEqual([BrowserEngineType.Rebrowser, BrowserEngineType.Patchright]);
  });

  it('is restored to original after each test via afterEach', () => {
    setGlobalEngineChain([BrowserEngineType.Patchright]);
    const chain = getGlobalEngineChain();
    expect(chain).toEqual([BrowserEngineType.Patchright]);
  });
});

describe('setGlobalDefaultEngine', () => {
  it('sets chain to single-engine array', () => {
    setGlobalDefaultEngine(BrowserEngineType.PlaywrightStealth);
    const chain = getGlobalEngineChain();
    expect(chain).toEqual([BrowserEngineType.PlaywrightStealth]);
  });

  it('works for Camoufox', () => {
    setGlobalDefaultEngine(BrowserEngineType.Camoufox);
    const chain = getGlobalEngineChain();
    expect(chain).toEqual([BrowserEngineType.Camoufox]);
  });
});
