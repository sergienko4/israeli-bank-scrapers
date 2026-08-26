/**
 * Unit tests for the login field collision guard.
 *
 * Two credential fields resolving to the same element is the signature of a
 * positional fallback stealing an input a semantically-resolved field already
 * owns. Filling both overwrites the first, leaving the real field empty and
 * the form silently invalid — the failure mode observed on Yahav.
 */

import { jest } from '@jest/globals';
import pino from 'pino';

import type { IFieldConfig } from '../../../../../Scrapers/Base/Interfaces/Config/FieldConfig.js';
import { UNKNOWN_IDENTITY } from '../../../../../Scrapers/Pipeline/Mediator/Elements/ElementIdentity.js';
import {
  findClaimingField,
  rejectClaimedTarget,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/FieldDiscovery/FieldDiscoveryAccumulate.js';
import type {
  IAccumulateCallArgs,
  IFieldAccum,
} from '../../../../../Scrapers/Pipeline/Mediator/Login/FieldDiscovery/FieldDiscoveryTypes.js';
import { none } from '../../../../../Scrapers/Pipeline/Types/Option.js';
import type {
  IResolvedTarget,
  LoginFieldKey,
} from '../../../../../Scrapers/Pipeline/Types/PipelineContext.js';

/** Element the first field legitimately resolved to. */
const OWNED: IResolvedTarget = {
  selector: '#username',
  contextId: 'iframe:https://login.example.co.il/login/',
  kind: 'labelText',
  candidateValue: 'קוד משתמש',
};

/** A different element in the same frame. */
const FREE: IResolvedTarget = {
  selector: '#nationalId',
  contextId: 'iframe:https://login.example.co.il/login/',
  kind: 'labelText',
  candidateValue: 'תעודת זהות',
};

/** Same selector, different frame — not a collision. */
const OTHER_FRAME: IResolvedTarget = { ...OWNED, contextId: 'main' };

/** The field under resolution when the collision is detected. */
const FIELD: IFieldConfig = { credentialKey: 'nationalID', selectors: [] };

/** Key the accumulator has already claimed. */
const CLAIMED_KEY = 'num' as LoginFieldKey;

/**
 * Build an accumulator in which `num` already owns {@link OWNED}.
 * @returns Accumulator with one claimed target.
 */
function makeAccum(): IFieldAccum {
  return { targets: new Map([[CLAIMED_KEY, OWNED]]), formAnchor: none() };
}

/**
 * Build the bundled accumulate arguments for a candidate resolution.
 * @param resolved - Candidate resolution under test.
 * @returns Bundle plus the logger so the caller can assert on warnings.
 */
function makeCall(resolved: IResolvedTarget | false): IAccumulateCallArgs {
  const logger = pino({ enabled: false });
  return { accum: makeAccum(), field: FIELD, resolved, logger };
}

describe('findClaimingField', () => {
  it('reports the owner when selector and context both match', () => {
    const owner = findClaimingField(makeAccum().targets, OWNED);
    expect(owner.has).toBe(true);
  });

  it('reports free when the selector differs', () => {
    const owner = findClaimingField(makeAccum().targets, FREE);
    expect(owner.has).toBe(false);
  });

  it('reports free when the same selector lives in another frame', () => {
    const owner = findClaimingField(makeAccum().targets, OTHER_FRAME);
    expect(owner.has).toBe(false);
  });
});

/**
 * Build a one-entry target map claimed by {@link CLAIMED_KEY}.
 * @param target - The target the claimed key already owns.
 * @returns Map with a single claimed target.
 */
function makeTargetMap(target: IResolvedTarget): ReadonlyMap<LoginFieldKey, IResolvedTarget> {
  return new Map([[CLAIMED_KEY, target]]);
}

/** Frame every identity fixture below lives in. */
const IDENTITY_FRAME = 'iframe:https://login.example.co.il/login/';

/** Selector a password field and its confirmation both answer. */
const SHARED_SELECTOR = 'input[type="password"]';

/** The password input — third child input of the form. */
const PASSWORD_FIELD: IResolvedTarget = {
  selector: SHARED_SELECTOR,
  contextId: IDENTITY_FRAME,
  kind: 'wellKnown',
  candidateValue: 'password',
  elementId: 'BODY:1/FORM:0/INPUT:2',
};

/**
 * A different input answering the very same selector.
 *
 * Its position differs, but that changes nothing: a fill runs through
 * `locator(selector).first()`, so both targets reach the *first* match.
 */
const CONFIRM_FIELD: IResolvedTarget = {
  ...PASSWORD_FIELD,
  candidateValue: 'passwordConfirm',
  elementId: 'BODY:1/FORM:0/INPUT:3',
};

/** Position of the single username input. */
const USERNAME_PATH = 'BODY:1/FORM:0/INPUT:0';

/** The username input, reached by its id. */
const USERNAME_BY_ID: IResolvedTarget = {
  selector: '#user',
  contextId: IDENTITY_FRAME,
  kind: 'bankConfig',
  candidateValue: 'username',
  elementId: USERNAME_PATH,
};

/** The same input, reached by a placeholder match. */
const USERNAME_BY_PLACEHOLDER: IResolvedTarget = {
  ...USERNAME_BY_ID,
  selector: '[placeholder="קוד משתמש"]',
  kind: 'placeholder',
  candidateValue: 'nationalID',
};

describe('findClaimingField — element identity', () => {
  it('rejects a shared selector even when the positions differ', () => {
    const targets = makeTargetMap(PASSWORD_FIELD);
    const owner = findClaimingField(targets, CONFIRM_FIELD);
    expect(owner.has).toBe(true);
  });

  it('rejects the same element reached by a different selector', () => {
    const targets = makeTargetMap(USERNAME_BY_ID);
    const owner = findClaimingField(targets, USERNAME_BY_PLACEHOLDER);
    expect(owner.has).toBe(true);
  });

  it('keeps identical positions in different frames apart', () => {
    const targets = makeTargetMap(USERNAME_BY_ID);
    const elsewhere: IResolvedTarget = { ...USERNAME_BY_ID, contextId: 'main' };
    const owner = findClaimingField(targets, elsewhere);
    expect(owner.has).toBe(false);
  });

  it('rejects a shared selector when one side has no identity', () => {
    const targets = makeTargetMap(PASSWORD_FIELD);
    const unread: IResolvedTarget = { ...CONFIRM_FIELD, elementId: UNKNOWN_IDENTITY };
    const owner = findClaimingField(targets, unread);
    expect(owner.has).toBe(true);
  });

  it('rejects a shared selector for a target that carries no identity field', () => {
    const targets = makeTargetMap(OWNED);
    const owner = findClaimingField(targets, OWNED);
    expect(owner.has).toBe(true);
  });

  it('accepts different selectors when identity cannot be compared', () => {
    const targets = makeTargetMap(USERNAME_BY_ID);
    const unread: IResolvedTarget = { ...USERNAME_BY_PLACEHOLDER, elementId: UNKNOWN_IDENTITY };
    const owner = findClaimingField(targets, unread);
    expect(owner.has).toBe(false);
  });
});

describe('rejectClaimedTarget', () => {
  it('accepts a resolution that no other field claimed', () => {
    const call = makeCall(FREE);
    const warn = jest.spyOn(call.logger, 'warn');
    const kept = rejectClaimedTarget(call);
    expect(kept).toEqual(FREE);
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects a resolution another field already claimed', () => {
    const call = makeCall(OWNED);
    const kept = rejectClaimedTarget(call);
    expect(kept).toBe(false);
  });

  it('names the claiming field in the warning so the collision is diagnosable', () => {
    const call = makeCall(OWNED);
    const warn = jest.spyOn(call.logger, 'warn');
    rejectClaimedTarget(call);
    const payload = warn.mock.calls[0]?.[0] as { event: string; claimedBy: string };
    expect(payload.event).toBe('login.field_collision');
    expect(payload.claimedBy).toBe(CLAIMED_KEY);
  });

  it('passes a missing resolution straight through as false', () => {
    const call = makeCall(false);
    const kept = rejectClaimedTarget(call);
    expect(kept).toBe(false);
  });
});
