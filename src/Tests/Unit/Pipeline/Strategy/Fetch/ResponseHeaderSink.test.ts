/**
 * Unit tests for Strategy/Fetch/ResponseHeaderSink — a call's header sink
 * receives only the response headers it declared (N6).
 */

import { jest } from '@jest/globals';

import { emitResponseHeaders } from '../../../../../Scrapers/Pipeline/Strategy/Fetch/ResponseHeaderSink.js';
import type { IResponseHeaderSink } from '../../../../../Scrapers/Pipeline/Types/Domain/FetchPolicy.js';

const ANSWER = new Response('{}', {
  status: 202,
  headers: [
    ['x-session-id', 'syn-session'],
    ['x-trace', 'syn-trace'],
    ['set-cookie', 'sid=syn-sid'],
  ],
});

describe('emitResponseHeaders', () => {
  it('UT-HC-04 hands the sink only the declared headers the answer carried, and its status', () => {
    const take = jest.fn<number, [Readonly<Record<string, string>>, number]>(
      (headers): number => Object.keys(headers).length,
    );
    const sink: IResponseHeaderSink = { names: ['x-session-id', 'x-missing'], take };
    const count = emitResponseHeaders(ANSWER, sink);
    expect(take.mock.calls).toEqual([[{ 'x-session-id': 'syn-session' }, 202]]);
    expect(count).toBe(1);
  });

  it('emits nothing without a sink', () => {
    const count = emitResponseHeaders(ANSWER);
    expect(count).toBe(0);
  });
});
