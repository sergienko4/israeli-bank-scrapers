/**
 * Edge-case unit coverage for the PayBox getKey BOOTSTRAP crypto surface
 * ({@link extractHmacKeyPatch} + {@link getKeyVars}) plus an integration
 * assertion that a full scrape run deposits the decrypted HMAC key into
 * the session-context so subsequent authenticated reads can sign.
 *
 * Per `c:\tmp\guidelines\test-guidlines.md` the happy path is covered by
 * the shape integration test; here we pin the crypto vector, the
 * fail-closed contract, and the never-log-the-key invariant.
 */

import {
  extractHmacKeyPatch,
  getKeyVars,
} from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxBootstrap.js';
import { PAYBOX_SHAPE } from '../../../../../Scrapers/Pipeline/Banks/PayBox/scrape/PayBoxShape.js';
import {
  HMAC_KEY_SLOT,
  HMAC_SIGNER_SLOT,
} from '../../../../../Scrapers/Pipeline/Mediator/Api/ApiMediator.hmacHeaders.js';
import { createApiDirectScrapePhase } from '../../../../../Scrapers/Pipeline/Phases/ApiDirectScrape/ApiDirectScrapePhase.js';
import type { IActionContext } from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';
import { succeed } from '../../../../../Scrapers/Pipeline/Types/Procedure.js';
import { assertOk } from '../../../../Helpers/AssertProcedure.js';
import {
  ctxOf,
  ctxOfNoPhone,
  ctxOfWithPhone,
  FIXT_GETKEY_TSIV,
  FIXT_GETKEY_TSKEY,
  FIXT_HMAC_KEY_HEX,
  makePayBoxBus,
} from './PayBoxBusFactory.js';

const GOOD_BODY = { content: { tsKey: FIXT_GETKEY_TSKEY, tsIv: FIXT_GETKEY_TSIV } };

/**
 * Build a fresh action-context wired to an empty-router PayBox bus (the
 * bus auto-seeds the live getKey vector).
 * @returns Action context.
 */
function freshCtx(): IActionContext {
  const bus = makePayBoxBus({});
  return ctxOf(bus);
}

describe('PayBoxBootstrap — getKey crypto (edge)', () => {
  it('decrypts the live vector into the 32-byte HMAC key patch', () => {
    const ctx = freshCtx();
    const result = extractHmacKeyPatch({ body: GOOD_BODY, ctx });
    assertOk(result);
    expect(result.value[HMAC_KEY_SLOT]).toBe(FIXT_HMAC_KEY_HEX);
    expect(result.value[HMAC_SIGNER_SLOT]).toBeDefined();
  });

  it('derives the same key when the edge already wire-formatted the phone', () => {
    const bus = makePayBoxBus({});
    const ctx = ctxOfWithPhone(bus, '972-500000000');
    const result = extractHmacKeyPatch({ body: GOOD_BODY, ctx });
    assertOk(result);
    expect(result.value[HMAC_KEY_SLOT]).toBe(FIXT_HMAC_KEY_HEX);
  });

  it('fails closed when tsKey/tsIv are missing', () => {
    const ctx = freshCtx();
    const result = extractHmacKeyPatch({ body: { content: {} }, ctx });
    expect(result.success).toBe(false);
  });

  it('fails closed when content is null, summarising the numeric code', () => {
    const ctx = freshCtx();
    const result = extractHmacKeyPatch({ body: { content: null, code: 7 }, ctx });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errorMessage).toContain('code=7');
    }
  });

  it('fails closed when the caller context carries no phone number', () => {
    const bus = makePayBoxBus({});
    const result = extractHmacKeyPatch({ body: GOOD_BODY, ctx: ctxOfNoPhone(bus) });
    expect(result.success).toBe(false);
  });

  it('exposes only the two transport slots (never the raw key material)', () => {
    const ctx = freshCtx();
    const result = extractHmacKeyPatch({ body: GOOD_BODY, ctx });
    assertOk(result);
    const slots = Object.keys(result.value);
    expect(slots).toEqual([HMAC_KEY_SLOT, HMAC_SIGNER_SLOT]);
  });

  it('getKeyVars carries the auth envelope', () => {
    const ctx = freshCtx();
    const vars = getKeyVars(ctx);
    expect(vars.auth).toBeDefined();
  });
});

describe('PayBoxBootstrap — session deposit (integration)', () => {
  it('deposits the HMAC key into session-context during a scrape run', async () => {
    const page = succeed({ content: { nc: [{ ts: 'null' }] } });
    const bus = makePayBoxBus({ transactions: [page] });
    const ctx = ctxOf(bus);
    const phase = createApiDirectScrapePhase(PAYBOX_SHAPE);
    const result = await phase(ctx);
    assertOk(result);
    const session = bus.getSessionContext() as Record<string, unknown>;
    expect(session[HMAC_KEY_SLOT]).toBe(FIXT_HMAC_KEY_HEX);
  });
});
