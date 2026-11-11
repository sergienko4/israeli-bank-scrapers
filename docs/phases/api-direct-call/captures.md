# API-DIRECT-CALL — Captures

How a non-JSON answer becomes a carry value: text, forms, scripts, SDK references, serialized JSON and JWT claims.

## Text captures

A bank that answers with a page or a script rather than JSON can still hand a
value to carry. On a `response: 'text'` step, `textCaptures` maps a carry slot
to an `ITextCapture`: a regex `pattern`, searched in the whole answer
with the `g` flag, and the `group` whose text the slot takes (`0` is the whole
match). `captureText` (in `Flow/Captures/RunStep.textCapture.ts`) runs right after the
header slots, through `answerSlots` (in `Flow/RunStep.answerSlots.ts`):

```ts
response: 'text',
maxTextChars: 262_144,
textCaptures: {
  ssoCode: { pattern: '^[\\s\\S]*?code=([\\s\\S]+)$', group: 1 },
  csrf: { pattern: 'csrfToken', group: 0, absent: true },
},
```

- The pattern must match exactly once. No match, or a match that leaves the
  group unset, fails `<step> capture <slot> missing`; a second match fails
  `<step> capture <slot> ambiguous`. An empty match steps one char on before
  the second search, so a pattern that can match `''` is still caught twice.
- `absent: true` makes the capture a guard: any match fails
  `<step> capture <slot> present`, and the slot never enters carry, so no
  extract rule may name it.
- A captured slot then runs its [extract rules](codecs.md#extract-rules). A slot with no
  rule of its own still gets the empty rule, so it is capped at 8192 chars.
- `maxTextChars` moves the step's answer cap off the 65 536-char default; an
  answer over it fails `<step> text too long`, never truncated.
- A failure names the step and the slot only, never the text.

## Login-form capture

Some banks hand out a login form whose hidden fields the logon post must send
back. On a `response: 'text'` step, `formCapture` (an `IFormCapture`)
reads one form's hidden fields into a carry slot. `captureForm` (in
`Flow/Captures/RunStep.formCapture.ts`) runs through `answerSlots` after the text
captures, on the page `answerText` reads off the `{ text }` answer:

```ts
response: 'text',
formCapture: {
  form: 'loginServlet',
  into: 'loginForm',
  action: 'https://bank.example/MatafLoginService/MatafLoginServlet',
  required: ['user', 'passwordEnc', 'bankId'],
  forbidden: ['password'],
  minFields: 3,
  maxFields: 32,
},
```

- `scanHtmlTags` (in `Flow/HtmlTags.ts`) reads the page once, left to right,
  into `IHtmlTag` start and end tags. It skips comments, doctypes and the
  bodies of `script` and `style`; an unclosed comment, tag or quoted value
  ends the scan. `attrsOf` (in `Flow/HtmlTags.attrs.ts`) reads a tag's
  attributes into `HtmlAttrs`: lower-cased names, the last of a repeated name
  wins, and an attribute with no `=` reads `true` (`HtmlAttrValue`). Values
  decode `&amp;`, `&lt;`, `&gt;`, `&quot;` and numeric references only; any
  other named entity stays as written.
- The page must hold exactly one `<form>` whose `id` or `name` is `form`: none
  fails `<step> form <form> missing`, more `<step> form <form> ambiguous`.
- The form's `method` must be `post` in any case, and its `action`, resolved
  against the final answering URL after any redirects, must equal `action`;
  anything else, including a missing method or action, fails
  `<step> form action refused`.
- Its fields are the inputs with a non-empty `name` and no `disabled`, up to
  its end tag or the next `<form>`. `formFieldsOf` (in
  `Flow/RunStep.formFields.ts`) fails `<step> form field not hidden` when a
  field's `type` is not `hidden` (a missing `type` included), and
  `<step> form fields invalid` for a name off `FORM_FIELD_NAME`
  (`^[\w-]{1,100}$`), a `value` past 32 768 chars or with no `=`, a field
  count outside `minFields`..`maxFields`, a repeated name, a missing
  `required` name or any `forbidden` one. A field with no `value` reads `''`.
- The `{ name: value }` record, in page order, goes to carry `into`, and a
  form body sends it back through a [`$merge`](signing.md#jsonvaluetemplate). The slot
  is not an extract slot, so no extract rule may name it and `sessionCarry`
  cannot keep it. A failure names the step only, never a field or a value.

## Handoff script capture

Some banks answer a logon with a page whose script sends the client on, and an
app elsewhere, by testing the User-Agent. On a `response: 'text'` step,
`locationCapture` (an `ILocationCapture`) carries the URL that script
sends the client to. `captureLocation` (in `Flow/Captures/RunStep.locationCapture.ts`)
runs through `answerSlots` after the text captures and the form capture. The
script is never run: it is read as tokens, along the path the configured
`userAgent` selects.

```ts
response: 'text',
locationCapture: {
  into: 'handoffUrl',
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  url: [{ origin: 'https://bank.example', anyPathExcept: ['logout', 'changepass'] }],
},
```

- The page's `<script>` bodies are read left to right, up to the first one
  that is never closed; a script with only a `src` has no body to read.
- `tokenizeScript` (in `Flow/Captures/RunStep.locationScriptLexer.ts`) reads a body
  into `IScriptToken`s, each of a `ScriptTokenKind`: names, numbers, quoted
  strings, templates without `${`, and one-char punctuators (an `end` token
  stands past the last one); comments and blanks are dropped, and a token
  after a line break starts a line. Anything else, an unclosed string or
  comment included, refuses the script. `decodeJsString` decodes a string
  with no escape but `\/`, `\\`, `\'` and `\"`.
- `selectedTargets` (in `Flow/Captures/RunStep.locationScriptWalk.ts`) walks the
  tokens through an `IScriptWalk` (cursor helpers `tokenAt`, `isEndAt`,
  `isPunctAt`, `isNameAt`, `takePunct`, `takeName` and `takeToken` in
  `Flow/Captures/RunStep.locationScriptCursor.ts`). `walkChain` (in
  `Flow/Captures/RunStep.locationScriptStatement.ts`) reads a plain statement: a
  quoted string assigned to `location`, `window.location`,
  `document.location` or `top.location`, or to their `.href`, or a call to
  `console.log`, `sessionStorage.removeItem` or `localStorage.removeItem`,
  whose arguments are skipped unread. A statement ends at `;`, or before a
  line break, a `}` or the end of the script.
- An `if` must test exactly
  `(navigator.userAgent.indexOf('<marker>') > -1)`; `readMarker` (in
  `Flow/Captures/RunStep.locationScriptCondition.ts`) reads a marker of 1 to 64 chars.
  The branch is taken when `userAgent` contains the marker, else the `else`
  branch, when there is one. A branch is a block or one statement; `if`
  nests at most `MAX_IF_DEPTH` (4) deep. The taken branch is walked, and
  `skipBranch` and `skipGroup` (in `Flow/Captures/RunStep.locationScriptSkip.ts`) step
  over the other one unread, as balanced brackets.
- Any other statement on the walked path, an empty statement, a bare block or
  two statements on one line without `;` fail
  `<step> handoff script unsupported`. Over all scripts, no assignment fails
  `<step> handoff missing`, and two or more `<step> handoff ambiguous`.
- The one URL is resolved against the final answering URL and must pass the
  `url` rules (https, no user info, no fragment): else `<step> handoff
refused`. Its `href` goes to carry `into`, which a later step can name as its
  [`urlFromCarry`](flow.md#carried-step-url). A failure is `Generic` and names the
  step only, never the URL.

Page captures require the answering URL; if the transport cannot provide it,
the step fails `<step> answer url missing` without exposing a URL. A later
retry or redirect always replaces the prior answer's URL.

The build (`API_DIRECT_LOCATION_CAPTURE_RULES`) refuses a `locationCapture`
on a step whose `response` is not `'text'`, one with an empty `into`,
`userAgent` or `url`, and an `into` the step also fills: an extract, its
`finalUrlInto` or its `formCapture` slot.

## SDK reference capture

A `response: 'text'` step can find the SDK named by a page without running its
scripts. `structuredCapture` takes an `ISdkReferenceCapture`:

```ts
structuredCapture: {
  kind: 'sdk-reference',
  into: 'sdkUrl',
  url: [{ origin: 'https://bank.example', paths: ['/sdk/client.js'] }],
},
```

`captureSdkReference` resolves script sources against the first document base
and the final answering URL. It considers active HTML script `src` attributes
and literal sources in the observed top-level `self.__next_s.push` queue
forms. A zero-marker inline queue entry with static, non-source properties is
not an external script; dynamic or source-bearing inline properties are refused.
Each supported queue push must have exactly one argument; multi-argument calls
are refused rather than silently ignoring later entries.
It excludes inert, non-JavaScript and foreign-namespace subtrees;
`activeElements`, `attribute`, `isExecutableScript`, `scriptText`, and
`queueSources` supply those syntactic checks. No page or SDK code is
executed. Unrelated well-formed sources outside the allowlist are ignored;
the distinct allowlisted sources must resolve to exactly one URL. Malformed
active sources or relevant queue syntax fail without including source text
or URLs in the error.

`captureStructured` runs after text, form and handoff capture, before
derivations, and a later GET may use `urlFromCarry`. The builder's
`API_DIRECT_STRUCTURED_CAPTURE_RULES` requires a text response, a named fresh
slot, and a nonempty allowlist. `areSdkUrlRulesValid` checks each HTTPS origin
and path/query rule; `generatedSlots` also helps reject conflicting generator
outputs. The later GET checks the carried URL again before sending it.
This only finds the SDK reference: pin the SDK response separately with
`responseIntegrity` before relying on its contents.

## Serialized script JSON capture

The `script-json` member of `StructuredCapture` (`IScriptJsonCapture`) reads
one exact root field from JSON serialized inside an active inline script:

```ts
structuredCapture: {
  kind: 'script-json',
  into: 'session',
  field: 'SessionID',
  pattern: '^[a-fA-F0-9]{32}$',
  maxChars: 32,
},
```

`captureScriptJson` reads the literals found by `scriptJsonLiterals` in
top-level assignments and declarations, including their objects, arrays and
single-argument `JSON.parse` expressions. It does not evaluate those expressions,
inspect function bodies, traverse other calls or constructors, or read external
scripts. A matching unrelated assignment can still be selected: this syntax
check does not establish a literal's provenance. It accepts a single distinct
matching string root field; unrelated malformed JSON literals are ignored.
No match, multiple distinct matches or malformed script syntax fail without
disclosing page text or values. `hasDuplicateJsonField` rejects
repeated root keys, including alternate escape spellings.
`isScriptJsonCaptureValid` requires a nonblank field, a bounded `maxChars`,
and an anchored flat pattern before any request. As with other structured
captures, its carry is available to the same step's derivations. The
`script-json` output can be explicitly projected through `sessionCarry`;
it is not a checked URL producer.

## Issued JWT claim binding

The `jwt-claims` member (`IJwtClaimsCapture` and `IJwtClaimSlot`) reads a
token from carry after the step's ordinary and classifier captures. It compares
configured payload pointers to refs in the current scope and writes only the
named bounded text captures before same-step derivations:

```ts
structuredCapture: {
  kind: 'jwt-claims',
  from: 'issuedToken',
  maxTokenChars: 32768,
  equals: { '/subject': 'creds.username', '/routing': 'carry.routing' },
  captures: { site: { pointer: '/site', maxChars: 8 } },
},
```

`isJwtClaimsCaptureValid` uses `isCookieRef` for known refs and rejects invalid
configurations before I/O. `issuedJwtPayload` checks the bound, three canonical
base64url segments, strict UTF-8 JSON objects, and `hasDuplicateJsonKeys` for
ambiguous keys at any depth. `captureJwtClaims` requires an integer future
expiry and exact equality for every binding; its failures contain no token or
claims. An output slot may opt into `rejectBlank: true` to reject whitespace-only
claims without trimming accepted values; omitting it preserves the default.
`applyJwtCapture` enforces these checks before the next step.
`structuredSlotsOf` reports output slots for collision and URL-admission
checks; captured claims do not become checked URL producers.

These are local structural and binding checks, **not JWT signature
verification**. The bank remains responsible for validating its opaque token.

Back to [API-DIRECT-CALL](../api-direct-call.md).
