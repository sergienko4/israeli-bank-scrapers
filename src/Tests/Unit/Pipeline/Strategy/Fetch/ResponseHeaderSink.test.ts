/**
 * Unit tests for Strategy/Fetch/ResponseHeaderSink — a call's header sink
 * receives only the response headers it declared, the status and the
 * URL that gave the answer.
 */

import { jest } from '@jest/globals';

import { emitResponseHeaders } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseHeaderSink.js';
import type { IResponseHeaderSink } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

const ANSWERED_URL = 'https://bank.test/portal/landing';

const ANSWER = new Response('{}', {
  status: 202,
  headers: [
    ['x-session-id', 'syn-session'],
    ['x-trace', 'syn-trace'],
    ['set-cookie', 'sid=syn-sid'],
  ],
});

describe('emitResponseHeaders', () => {
  it('UT-HC-04 hands the sink the declared headers the answer carried, its status and URL', () => {
    const take = jest.fn<number, [Readonly<Record<string, string>>, number, string]>(
      (headers): number => Object.keys(headers).length,
    );
    const sink: IResponseHeaderSink = { names: ['x-session-id', 'x-missing'], take };
    const count = emitResponseHeaders(ANSWER, ANSWERED_URL, sink);
    expect(take.mock.calls).toEqual([[{ 'x-session-id': 'syn-session' }, 202, ANSWERED_URL]]);
    expect(count).toBe(1);
  });

  it('emits nothing without a sink', () => {
    const count = emitResponseHeaders(ANSWER, ANSWERED_URL);
    expect(count).toBe(0);
  });
});
