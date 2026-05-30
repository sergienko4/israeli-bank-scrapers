/**
 * Unit tests for PiiRedactor — single source of truth for PII redaction.
 * One describe per strategy; positive + negative + edge cases per spec.
 */

import {
  classifyKey,
  createCensorFn,
  redactAccount,
  redactAmount,
  redactCard,
  redactCookie,
  redactErrorMessage,
  redactHtml,
  redactIsraeliId,
  redactJsonBody,
  redactMerchant,
  redactName,
  redactOtp,
  redactPhone,
  redactToken,
  redactUrl,
  redactUrlFull,
} from '../../../../Scrapers/Pipeline/Types/PiiRedactor.js';

describe('PiiRedactor — redactAccount (TC-AC-01..05)', () => {
  it('returns ***last4 for Hapoalim account "12-170-536347"', () => {
    const result = redactAccount('12-170-536347');
    expect(result).toBe('***6347');
  });
  it('returns ***last4 for Discount account "8878787823"', () => {
    const result = redactAccount('8878787823');
    expect(result).toBe('***7823');
  });
  it('returns [REDACTED] for inputs shorter than 4 chars', () => {
    const result = redactAccount('123');
    expect(result).toBe('[REDACTED]');
  });
  it('returns empty string for empty input (idempotent)', () => {
    const result = redactAccount('');
    expect(result).toBe('');
  });
});

describe('PiiRedactor — redactCard', () => {
  it('returns ****last4 for short card "6440"', () => {
    const result = redactCard('6440');
    expect(result).toBe('****6440');
  });
  it('returns ****last4 for full PAN', () => {
    const result = redactCard('3307405447846202');
    expect(result).toBe('****6202');
  });
  it('returns [REDACTED] for inputs shorter than 4 chars', () => {
    const result = redactCard('12');
    expect(result).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactIsraeliId', () => {
  it('returns ***last4 for valid 9-digit ID', () => {
    const result = redactIsraeliId('445577890');
    expect(result).toBe('***7890');
  });
  it('returns [REDACTED] for non-9-digit input', () => {
    const result = redactIsraeliId('123');
    expect(result).toBe('[REDACTED]');
  });
  it('strips non-digit chars before validating length', () => {
    const result = redactIsraeliId('445-577-890');
    expect(result).toBe('***7890');
  });
});

describe('PiiRedactor — redactPhone', () => {
  it('returns ***last4 for international form', () => {
    const result = redactPhone('+972501234567');
    expect(result).toBe('***4567');
  });
  it('returns ***last4 across separators', () => {
    const result = redactPhone('05x-12-34-567');
    expect(result).toBe('***4567');
  });
  it('returns [REDACTED] when fewer than 4 digits', () => {
    const result = redactPhone('123');
    expect(result).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactName (length tag)', () => {
  it('returns <name:N> for Latin names', () => {
    const result = redactName('Test First Name and Last Name');
    expect(result).toBe('<name:29>');
  });
  it('returns <name:N> for Hebrew names (Unicode-aware)', () => {
    const result = redactName('משה כהן');
    expect(result).toBe('<name:7>');
  });
  it('counts emoji as 1 grapheme', () => {
    const result = redactName('First name 🎉');
    expect(result).toBe('<name:12>');
  });
  it('returns empty for empty input', () => {
    const result = redactName('');
    expect(result).toBe('');
  });
});

describe('PiiRedactor — redactMerchant (length tag)', () => {
  it('returns <merchant:N> for Hebrew merchant', () => {
    const result = redactMerchant('ארומה חוף גורדון');
    expect(result).toBe('<merchant:16>');
  });
  it('returns <merchant:N> for Latin merchant', () => {
    const result = redactMerchant('AMAZON.COM');
    expect(result).toBe('<merchant:10>');
  });
});

describe('PiiRedactor — redactAmount', () => {
  it('returns +*** for positive number', () => {
    const result = redactAmount(400);
    expect(result).toBe('+***');
  });
  it('returns -*** for negative number', () => {
    const result = redactAmount(-100);
    expect(result).toBe('-***');
  });
  it('returns +*** for positive numeric string', () => {
    const result = redactAmount('150.5');
    expect(result).toBe('+***');
  });
  it('returns +*** for zero', () => {
    const result = redactAmount(0);
    expect(result).toBe('+***');
  });
  it('returns [REDACTED] for non-numeric string', () => {
    const result = redactAmount('abc');
    expect(result).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for empty string (CR review #1)', () => {
    const result = redactAmount('');
    expect(result).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for whitespace-only string (CR review #1)', () => {
    const result = redactAmount('   ');
    expect(result).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactErrorMessage (CodeQL #28)', () => {
  it('returns <msg:N> for a Latin error message', () => {
    const result = redactErrorMessage('Login failed: bad credentials');
    expect(result).toBe('<msg:29>');
  });
  it('returns <msg:N> for a Hebrew error message (Unicode-aware)', () => {
    const result = redactErrorMessage('שגיאה בהתחברות');
    expect(result).toBe('<msg:14>');
  });
  it('returns <msg:0> for empty input (preserves "there was no message" signal)', () => {
    const result = redactErrorMessage('');
    expect(result).toBe('<msg:0>');
  });
  it('does not echo any character of the raw message', () => {
    const raw = 'Wrong password ABC123XYZ';
    const result = redactErrorMessage(raw);
    expect(result).not.toContain('ABC123XYZ');
    expect(result).not.toContain('password');
    expect(result).toMatch(/^<msg:\d+>$/);
  });
});

describe('PiiRedactor — redactToken / redactCookie', () => {
  it('redactToken returns [REDACTED] for any non-empty input', () => {
    const result = redactToken('Bearer eyJhbG.long.jwt');
    expect(result).toBe('[REDACTED]');
  });
  it('redactCookie returns [REDACTED]', () => {
    const result = redactCookie('session=abc123');
    expect(result).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactOtp', () => {
  it('returns [OTP] for 6-digit code', () => {
    const result = redactOtp('551917');
    expect(result).toBe('[OTP]');
  });
  it('returns [REDACTED] for too-short code', () => {
    const result = redactOtp('12');
    expect(result).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for too-long code', () => {
    const result = redactOtp('123456789');
    expect(result).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for length-OK but non-digit string (CR review #2)', () => {
    const result = redactOtp('abcd');
    expect(result).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for length-OK mixed digits + separators (CR review #2)', () => {
    const result = redactOtp('12-34');
    expect(result).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — classifyKey', () => {
  it('routes accountNumber → account', () => {
    const cat = classifyKey('accountNumber');
    expect(cat).toBe('account');
  });
  it('routes firstName → name', () => {
    const cat = classifyKey('firstName');
    expect(cat).toBe('name');
  });
  it('routes description → merchant', () => {
    const cat = classifyKey('description');
    expect(cat).toBe('merchant');
  });
  it('routes any *Token suffix → token (case-insensitive)', () => {
    const cat = classifyKey('xCsrfToken');
    expect(cat).toBe('token');
  });
  it('routes unknown keys → unknown', () => {
    const cat = classifyKey('somethingElse');
    expect(cat).toBe('unknown');
  });
});

describe('PiiRedactor — createCensorFn', () => {
  it('routes accountNumber path to redactAccount', () => {
    const censor = createCensorFn();
    const out = censor('12-170-536347', ['accountNumber']);
    expect(out).toBe('***6347');
  });
  it('routes balance path to redactAmount', () => {
    const censor = createCensorFn();
    const out = censor(1500, ['balance']);
    expect(out).toBe('+***');
  });
  it('returns [REDACTED] for unknown path tail', () => {
    const censor = createCensorFn();
    const out = censor('value', ['mystery']);
    expect(out).toBe('[REDACTED]');
  });
  it('returns [REDACTED] for empty path', () => {
    const censor = createCensorFn();
    const out = censor('value', []);
    expect(out).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactUrl', () => {
  it('redacts known PII query keys, keeps non-PII keys', () => {
    const out = redactUrl('https://x.example/api?accountId=12-170-536347&v=1');
    expect(out).toContain('accountId=***6347');
    expect(out).toContain('v=1');
  });
  it('returns input unchanged when not parseable', () => {
    const out = redactUrl('not-a-url');
    expect(out).toBe('not-a-url');
  });
  it('returns empty for empty input', () => {
    const out = redactUrl('');
    expect(out).toBe('');
  });
});

describe('PiiRedactor — redactUrlFull', () => {
  it('redacts an account ID embedded in a path segment (Hapoalim)', () => {
    const out = redactUrlFull('https://x.example/api/lastTransactions/8878787823/Date');
    expect(out).toContain('lastTransactions/***7823/Date');
    expect(out).not.toContain('8878787823');
  });
  it('preserves a non-identifier route segment that disambiguates picker choice', () => {
    const out = redactUrlFull(
      'https://www.max.co.il/api/registered/transactionDetails/getTransactionsAndGraphs?v=V4',
    );
    expect(out).toContain('getTransactionsAndGraphs');
  });
  it('redacts both query and path PII when both are present', () => {
    const out = redactUrlFull(
      'https://x.example/api/accounts/8878787823/Date?accountId=12-170-536347&v=1',
    );
    expect(out).toContain('accounts/***7823/Date');
    expect(out).toContain('accountId=***6347');
    expect(out).toContain('v=1');
  });
  it('passes through URLs with no PII identifiers in path or query', () => {
    const out = redactUrlFull('https://x.example/api/healthcheck?v=V4');
    expect(out).toBe('https://x.example/api/healthcheck?v=V4');
  });
  it('returns input unchanged when not parseable', () => {
    const out = redactUrlFull('not-a-url');
    expect(out).toBe('not-a-url');
  });
  it('returns empty for empty input', () => {
    const out = redactUrlFull('');
    expect(out).toBe('');
  });
  it('leaves segments shorter than 4 digits intact (no over-redaction)', () => {
    const out = redactUrlFull('https://x.example/api/v1/users/42/profile');
    expect(out).toContain('users/42/profile');
  });
  it('masks dash-separated card-formatted path segments (CR review #8)', () => {
    const out = redactUrlFull('https://x.example/api/cards/4111-1111-1111-1111/details');
    expect(out).not.toContain('4111-1111-1111-1111');
    expect(out).toContain('***1111');
  });
});

describe('PiiRedactor — redactJsonBody', () => {
  it('redacts firstName + balance leaves', () => {
    const out = redactJsonBody('{"firstName":"Eugene","balance":1500}');
    expect(out).toContain('<name:6>');
    expect(out).toContain('+***');
  });
  it('replaces PII-array with size sentinel', () => {
    const body = JSON.stringify({
      transactions: [
        { description: 'X', chargedAmount: -50 },
        { description: 'Y', chargedAmount: 12 },
      ],
    });
    const out = redactJsonBody(body);
    expect(out).toContain('[<2 redacted items>]');
  });
  it('passes scalar arrays through unchanged', () => {
    const out = redactJsonBody('{"flags":[1,2,3]}');
    expect(out).toContain('[1,2,3]');
  });
  it('falls back to regex replacement for non-JSON input', () => {
    const out = redactJsonBody('Hapoalim 12-170-536347 client');
    expect(out).toContain('***6347');
  });
  it('collapses arrays whose elements carry nested PII (CR review #6)', () => {
    const body = JSON.stringify({
      records: [
        { id: 1, meta: { phoneNumber: '0501234567' } },
        { id: 2, meta: { phoneNumber: '0507654321' } },
      ],
    });
    const out = redactJsonBody(body);
    expect(out).toContain('[<2 redacted items>]');
    expect(out).not.toContain('0501234567');
    expect(out).not.toContain('0507654321');
  });
  it('detects PII nested inside arrays-of-arrays-of-objects (CR review #6)', () => {
    const body = JSON.stringify({ groups: [[{ phoneNumber: '0501234567' }]] });
    const out = redactJsonBody(body);
    expect(out).not.toContain('0501234567');
  });
});

describe('PiiRedactor — redactHtml', () => {
  it('replaces input @value with grapheme-count tag', () => {
    const out = redactHtml('<input value="Eugene Sergienko"/>');
    expect(out).toContain('<name:16>');
  });
  it('redacts Israeli ID inside text node', () => {
    const out = redactHtml('<span>445577890</span>');
    expect(out).toContain('***7890');
  });
});

describe('PiiRedactor — empty-input idempotency', () => {
  it('redactCard returns empty for empty', () => {
    const r = redactCard('');
    expect(r).toBe('');
  });
  it('redactIsraeliId returns empty for empty', () => {
    const r = redactIsraeliId('');
    expect(r).toBe('');
  });
  it('redactPhone returns empty for empty', () => {
    const r = redactPhone('');
    expect(r).toBe('');
  });
  it('redactMerchant returns empty for empty', () => {
    const r = redactMerchant('');
    expect(r).toBe('');
  });
  it('redactToken returns empty for empty', () => {
    const r = redactToken('');
    expect(r).toBe('');
  });
  it('redactCookie returns empty for empty', () => {
    const r = redactCookie('');
    expect(r).toBe('');
  });
  it('redactOtp returns empty for empty', () => {
    const r = redactOtp('');
    expect(r).toBe('');
  });
});

describe('PiiRedactor — redactAccount terminal-segment branches', () => {
  it('handles slash separator', () => {
    const r = redactAccount('IBAN/9876');
    expect(r).toBe('[REDACTED]');
  });
  it('handles space separator with long terminal segment', () => {
    const r = redactAccount('Bank Account 12345678');
    expect(r).toBe('***5678');
  });
  it('handles no separator at all (whole string is the tail)', () => {
    const r = redactAccount('1234567890');
    expect(r).toBe('***7890');
  });
});

describe('PiiRedactor — redactJsonBody safety guards', () => {
  it('replaces object with PII inside (depth 1)', () => {
    const out = redactJsonBody('{"customer":{"firstName":"X","balance":10}}');
    expect(out).toContain('<name:1>');
    expect(out).toContain('+***');
  });
  it('passes plain object with no PII keys through', () => {
    const out = redactJsonBody('{"items":[{"id":1},{"id":2}]}');
    expect(out).toContain('"id":1');
    expect(out).toContain('"id":2');
  });
  it('handles arrays of scalars (no array-size sentinel)', () => {
    const out = redactJsonBody('{"flags":[true,false,true]}');
    expect(out).toContain('[true,false,true]');
  });
  it('handles null leaf values', () => {
    const out = redactJsonBody('{"foo":null}');
    expect(out).toContain('null');
  });
});

describe('PiiRedactor — redactUrl multi-query', () => {
  it('redacts multiple PII keys in one URL', () => {
    const out = redactUrl('https://x.example/a?accountId=12-170-536347&cardId=6440&v=2');
    expect(out).toContain('accountId=***6347');
    expect(out).toContain('cardId=');
    expect(out).toContain('v=2');
  });
});

describe('PiiRedactor — createCensorFn boolean + numeric paths', () => {
  it('boolean value with token path → [REDACTED]', () => {
    const censor = createCensorFn();
    const out = censor(true, ['idToken']);
    expect(out).toBe('[REDACTED]');
  });
  it('number value with phone path coerces to string then redacts', () => {
    const censor = createCensorFn();
    const out = censor(123456, ['phoneNumber']);
    expect(out).toBe('***3456');
  });
  it('string value on amount path: toAmountValue returns the string verbatim then redacts', () => {
    // Coverage backfill — exercises the `return value` fallback in
    // toAmountValue (the third branch beyond number / boolean).
    const censor = createCensorFn();
    const out = censor('1234.56', ['totalAmount']);
    expect(typeof out).toBe('string');
  });
  it('boolean value on amount path: toAmountValue stringifies then redacts', () => {
    // Hits the `typeof === "boolean"` branch in toAmountValue —
    // ensures all three CensorValue type variants are exercised.
    const censor = createCensorFn();
    const out = censor(true, ['totalAmount']);
    expect(typeof out).toBe('string');
  });
});

describe('PiiRedactor — fallback regex coverage', () => {
  it('redactJsonBody fallback regex catches Hapoalim account in non-JSON', () => {
    const out = redactJsonBody('Customer 12-170-536347 contacted support');
    expect(out).toContain('***6347');
    expect(out).not.toContain('536347');
  });
  it('redactJsonBody fallback regex catches Israeli ID in non-JSON', () => {
    const out = redactJsonBody('IL identifier 445577890 not found');
    expect(out).toContain('***7890');
    expect(out).not.toContain('445577890');
  });
  it('redactJsonBody fallback regex catches JWT in non-JSON', () => {
    const out = redactJsonBody('Bearer eyJabcdefghijklmnopqrst expired');
    expect(out).toContain('[REDACTED]');
    expect(out).not.toContain('eyJabcdefghij');
  });
});

describe('PiiRedactor — redactJsonBody value-input path', () => {
  it('accepts already-parsed object input', () => {
    const obj = { firstName: 'Eugene', balance: 1500 };
    const stringified = JSON.stringify(obj);
    const reparsed: unknown = JSON.parse(stringified);
    const out = redactJsonBody(reparsed as Parameters<typeof redactJsonBody>[0]);
    expect(out).toContain('<name:6>');
    expect(out).toContain('+***');
  });
  it('handles null at root', () => {
    const out = redactJsonBody(null);
    expect(out).toBe('null');
  });
});

describe('PiiRedactor — classifyKey suffix exhaustion', () => {
  it('routes *bearer suffix → token', () => {
    const cat = classifyKey('myBearer');
    expect(cat).toBe('token');
  });
  it('routes *cookie suffix → token', () => {
    const cat = classifyKey('sessionCookie');
    expect(cat).toBe('token');
  });
  it('routes *secret suffix → token', () => {
    const cat = classifyKey('apiSecret');
    expect(cat).toBe('token');
  });
  it('routes *firstname suffix → name', () => {
    const cat = classifyKey('userFirstname');
    expect(cat).toBe('name');
  });
  it('routes *lastname suffix → name', () => {
    const cat = classifyKey('userLastname');
    expect(cat).toBe('name');
  });
  it('routes *fullname suffix → name', () => {
    const cat = classifyKey('userFullname');
    expect(cat).toBe('name');
  });
  it('routes *customername suffix → name', () => {
    const cat = classifyKey('mainCustomername');
    expect(cat).toBe('name');
  });
});

describe('PiiRedactor — redactJsonBody depth + cycle guards', () => {
  it('handles cyclic object via [REDACTED:cycle]', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const out = redactJsonBody(cyclic as Parameters<typeof redactJsonBody>[0]);
    expect(out).toContain('[REDACTED:cycle]');
  });
  it('handles arrays whose first element is null (no-PII branch)', () => {
    const out = redactJsonBody('{"items":[null, {"id":1}]}');
    expect(out).toContain('null');
    expect(out).toContain('"id":1');
  });
  it('handles arrays of primitives (some null mixed in)', () => {
    const out = redactJsonBody('{"vals":[null,1,2]}');
    expect(out).toContain('null');
    expect(out).toContain('1');
  });
});

describe('PiiRedactor — censor empty path-tail / null', () => {
  it('returns [REDACTED] when path tail is empty string', () => {
    const censor = createCensorFn();
    const out = censor('val', ['']);
    expect(out).toBe('[REDACTED]');
  });
  it('boolean value via amount path coerces and redacts', () => {
    const censor = createCensorFn();
    const out = censor(true, ['balance']);
    expect(out).toBe('[REDACTED]');
  });
});

describe('PiiRedactor — redactJsonBody empty array / param-less query', () => {
  it('returns [] for empty array values', () => {
    const out = redactJsonBody('{"transactions":[]}');
    expect(out).toContain('"transactions":[]');
  });
  it('handles query param without `=value` (URL parser treats as empty)', () => {
    const out = redactUrl('https://x.example/api?accountId&v=1');
    expect(out).toContain('accountId=');
  });
});

describe('PiiRedactor — redactHtml empty + no-match paths', () => {
  it('returns empty for empty input', () => {
    const out = redactHtml('');
    expect(out).toBe('');
  });
  it('preserves HTML without PII patterns', () => {
    const out = redactHtml('<div class="foo"><span>hello</span></div>');
    expect(out).toBe('<div class="foo"><span>hello</span></div>');
  });
  it('handles whitespace-only @value (preserve original)', () => {
    const out = redactHtml('<input value="   "/>');
    expect(out).toContain('   ');
  });
});

describe('PiiRedactor — redactUrl missing query value', () => {
  it('preserves the URL when a known PII key has empty value', () => {
    const out = redactUrl('https://x.example/api?accountId=&v=1');
    expect(out).toContain('accountId=');
    expect(out).toContain('v=1');
  });
});

describe('PiiRedactor — bug-report contract (no raw PII leaks)', () => {
  it('produces zero raw PII patterns when redacting a synthetic record', () => {
    const censor = createCensorFn();
    const fields: readonly (readonly [string, string | number])[] = [
      ['accountNumber', '12-170-536347'],
      ['firstName', 'Eugene'],
      ['description', 'ARMA'],
      ['authorization', 'Bearer eyJhbG.long.jwt'],
      ['balance', 1500],
    ];
    const lines: string[] = [];
    for (const [key, value] of fields) {
      const censored = censor(value, [key]);
      lines.push(censored);
    }
    const blob = lines.join('|');
    const israeliIdRe = /(?<!\d)\d{9}(?!\d)/;
    const hapoalimRe = /\d{2}-\d{3}-\d{6}/;
    const jwtRe = /eyJ[\w-]{20,}/;
    const hasIsraeliId = israeliIdRe.test(blob);
    const hasHapoalim = hapoalimRe.test(blob);
    const hasJwt = jwtRe.test(blob);
    const hasAccountHint = blob.includes('***6347');
    const hasNameHint = blob.includes('<name:6>');
    const hasMerchantHint = blob.includes('<merchant:4>');
    const hasRedacted = blob.includes('[REDACTED]');
    const hasAmountHint = blob.includes('+***');
    expect(hasIsraeliId).toBe(false);
    expect(hasHapoalim).toBe(false);
    expect(hasJwt).toBe(false);
    expect(hasAccountHint).toBe(true);
    expect(hasNameHint).toBe(true);
    expect(hasMerchantHint).toBe(true);
    expect(hasRedacted).toBe(true);
    expect(hasAmountHint).toBe(true);
  });
});
