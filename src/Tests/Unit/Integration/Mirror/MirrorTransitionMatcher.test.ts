/**
 * Unit tests for the pure transition matcher. Exercises:
 *
 *   - phase filter narrows candidates
 *   - method, urlPattern (substring + regex), resourceType predicates
 *   - postData predicate (json + form shapes)
 *   - header predicates (presence + value)
 *   - ambiguous match flagged when two transitions in the same phase fit
 *   - none returned when no candidate matches
 *
 * The matcher is pure — no Playwright stubs required.
 */

import { isSome } from '../../../../Scrapers/Pipeline/Types/Option.js';
import type { IMirrorTransition } from '../../../Integration/Mirror/MirrorManifest.js';
import {
  type IMatchRequest,
  matchTransition,
} from '../../../Integration/Mirror/MirrorTransitionMatcher.js';

const RESPONSE_OK = {
  status: 200,
  contentType: 'text/html',
  bodyFile: 'init.html',
} as const;

const BASE_REQUEST: IMatchRequest = {
  method: 'GET',
  url: 'https://example.com/init',
  resourceType: 'document',
  postBody: '',
  headers: new Map<string, string>(),
};

const BASE_TRANSITION: IMirrorTransition = {
  phase: 'INIT',
  method: 'GET',
  urlPattern: '/init',
  response: RESPONSE_OK,
};

describe('matchTransition — phase filter', () => {
  it('skips transitions whose phase does not equal currentPhase', () => {
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'HOME',
      transitions: [BASE_TRANSITION],
    });
    expect(outcome.kind).toBe('none');
  });

  it('returns matched when phase + url + method all line up', () => {
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [BASE_TRANSITION],
    });
    expect(outcome.kind).toBe('matched');
    if (isSome(outcome.transition)) expect(outcome.transition.value).toBe(BASE_TRANSITION);
  });
});

describe('matchTransition — url patterns', () => {
  it('matches substring urlPattern when not starting with ^', () => {
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, url: 'https://x.example.com/init?x=1' },
      currentPhase: 'INIT',
      transitions: [BASE_TRANSITION],
    });
    expect(outcome.kind).toBe('matched');
  });

  it('compiles urlPattern starting with ^ as a regex', () => {
    const rx: IMirrorTransition = {
      ...BASE_TRANSITION,
      urlPattern: '^https://example\\.com/[a-z]+$',
    };
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, url: 'https://example.com/init' },
      currentPhase: 'INIT',
      transitions: [rx],
    });
    expect(outcome.kind).toBe('matched');
  });

  it('returns none for regex urlPattern that does not match', () => {
    const rx: IMirrorTransition = { ...BASE_TRANSITION, urlPattern: '^/different$' };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [rx],
    });
    expect(outcome.kind).toBe('none');
  });

  it('treats invalid regex as never-matching (false)', () => {
    const rx: IMirrorTransition = { ...BASE_TRANSITION, urlPattern: '^[invalid(' };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [rx],
    });
    expect(outcome.kind).toBe('none');
  });
});

describe('matchTransition — method', () => {
  it('rejects when method differs', () => {
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, method: 'POST' },
      currentPhase: 'INIT',
      transitions: [BASE_TRANSITION],
    });
    expect(outcome.kind).toBe('none');
  });
});

describe('matchTransition — resourceType', () => {
  it('matches when resourceType predicate equals request resourceType', () => {
    const t: IMirrorTransition = { ...BASE_TRANSITION, resourceType: 'document' };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [t],
    });
    expect(outcome.kind).toBe('matched');
  });

  it('rejects when resourceType predicate differs', () => {
    const t: IMirrorTransition = { ...BASE_TRANSITION, resourceType: 'xhr' };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [t],
    });
    expect(outcome.kind).toBe('none');
  });
});

describe('matchTransition — postData json shape', () => {
  const jsonTransition: IMirrorTransition = {
    phase: 'LOGIN',
    method: 'POST',
    urlPattern: '/login',
    postData: { shape: 'json', expectations: { username: 'alice' } },
    response: RESPONSE_OK,
  };

  it('matches when JSON body contains the expected key/value', () => {
    const body = JSON.stringify({ username: 'alice', password: 'hunter2' });
    const outcome = matchTransition({
      request: {
        ...BASE_REQUEST,
        method: 'POST',
        url: 'https://example.com/login',
        postBody: body,
      },
      currentPhase: 'LOGIN',
      transitions: [jsonTransition],
    });
    expect(outcome.kind).toBe('matched');
  });

  it('rejects when JSON body has wrong value', () => {
    const body = JSON.stringify({ username: 'bob' });
    const outcome = matchTransition({
      request: {
        ...BASE_REQUEST,
        method: 'POST',
        url: 'https://example.com/login',
        postBody: body,
      },
      currentPhase: 'LOGIN',
      transitions: [jsonTransition],
    });
    expect(outcome.kind).toBe('none');
  });

  it('treats malformed JSON as empty body (no expectation can match)', () => {
    const outcome = matchTransition({
      request: {
        ...BASE_REQUEST,
        method: 'POST',
        url: 'https://example.com/login',
        postBody: 'not-json{',
      },
      currentPhase: 'LOGIN',
      transitions: [jsonTransition],
    });
    expect(outcome.kind).toBe('none');
  });
});

describe('matchTransition — postData form shape', () => {
  const formTransition: IMirrorTransition = {
    phase: 'LOGIN',
    method: 'POST',
    urlPattern: '/login',
    postData: { shape: 'form', expectations: { username: 'alice' } },
    response: RESPONSE_OK,
  };

  it('matches when URL-encoded form body contains the value', () => {
    const body = 'username=alice&password=hunter2';
    const outcome = matchTransition({
      request: {
        ...BASE_REQUEST,
        method: 'POST',
        url: 'https://example.com/login',
        postBody: body,
      },
      currentPhase: 'LOGIN',
      transitions: [formTransition],
    });
    expect(outcome.kind).toBe('matched');
  });
});

describe('matchTransition — header predicates', () => {
  const headerTransition: IMirrorTransition = {
    ...BASE_TRANSITION,
    headers: [{ name: 'X-Required', value: 'yes' }],
  };

  it('matches when header is present with the expected value', () => {
    const headers = new Map<string, string>([['x-required', 'yes']]);
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, headers },
      currentPhase: 'INIT',
      transitions: [headerTransition],
    });
    expect(outcome.kind).toBe('matched');
  });

  it('rejects when header is missing', () => {
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [headerTransition],
    });
    expect(outcome.kind).toBe('none');
  });

  it('rejects when header value differs', () => {
    const headers = new Map<string, string>([['x-required', 'no']]);
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, headers },
      currentPhase: 'INIT',
      transitions: [headerTransition],
    });
    expect(outcome.kind).toBe('none');
  });

  it('accepts presence-only predicate (no value declared)', () => {
    const presence: IMirrorTransition = {
      ...BASE_TRANSITION,
      headers: [{ name: 'X-Required' }],
    };
    const headers = new Map<string, string>([['x-required', 'whatever']]);
    const outcome = matchTransition({
      request: { ...BASE_REQUEST, headers },
      currentPhase: 'INIT',
      transitions: [presence],
    });
    expect(outcome.kind).toBe('matched');
  });
});

describe('matchTransition — ambiguity detection', () => {
  it('returns ambiguous when two same-phase transitions both fit', () => {
    const a: IMirrorTransition = { ...BASE_TRANSITION };
    const b: IMirrorTransition = {
      ...BASE_TRANSITION,
      response: { ...RESPONSE_OK, bodyFile: 'b.html' },
    };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [a, b],
    });
    expect(outcome.kind).toBe('ambiguous');
  });

  it('matches when one of two same-phase transitions has a stricter predicate that excludes the other', () => {
    const broad: IMirrorTransition = { ...BASE_TRANSITION };
    const strict: IMirrorTransition = { ...BASE_TRANSITION, resourceType: 'xhr' };
    const outcome = matchTransition({
      request: BASE_REQUEST,
      currentPhase: 'INIT',
      transitions: [broad, strict],
    });
    expect(outcome.kind).toBe('matched');
    if (isSome(outcome.transition)) expect(outcome.transition.value).toBe(broad);
  });
});
