# Response digest

> **Who this is for:** maintainers diagnosing a scrape that "succeeded" (HTTP 200) but returned nothing.

An HTTP status alone cannot distinguish a bank returning **an empty page** from our code **failing to extract a full one** — both look like `200`. That ambiguity stalled three separate PayBox investigations, because the only way to tell them apart is to look at the response body, and the body is exactly what we must not log.

`digestResponse()` (`src/Scrapers/Pipeline/Strategy/Fetch/ResponseDigest.ts`) resolves this. It reduces a response body to an `IResponseDigest` — a fixed, non-sensitive shape that the fetch strategy spreads into its `fetch STATUS` debug line.

## Fields

| Field        | Meaning                              | Why it is safe                    |
| ------------ | ------------------------------------ | --------------------------------- |
| `respLength` | Body size in bytes                   | A number, never content           |
| `respKeys`   | Top-level JSON key **names**         | Structure only — never values     |
| `rowKeys`    | Field **names** of the first collection in the body | Structure only — never values |
| `errorCode`  | Server error code, when present      | Machine identifier, not free text |
| `errorName`  | Server error name/type, when present | Machine identifier, not free text |

## Naming the row fields

`respKeys` describes only the **envelope**, which is uninformative for a *successful* collection fetch: PayBox's wallet history digests to `["code","content"]` no matter what the rows contain. That blind spot has a cost — a defect that left transaction descriptions blank could not be diagnosed from any log, because nothing ever named the fields the bank actually sent.

`rowKeys` closes it. The digest scans the body one nesting level at a time, takes the first array holding records, and emits the **union of field names** across the first 5 rows (so a field present on only some rows — exactly the signal being hunted — still shows up), sorted and capped at 40 names.

Field names are schema, not customer data, so the same allowlist argument that permits `respKeys` permits `rowKeys`. That argument only holds while keys really are schema, so the guard is stated positively: values are never read at all, and a key is emitted **only when it is identifier-shaped** — a letter or underscore followed by word characters, at most 40 of them. Anything else is data wearing a key's clothes and is dropped: a bare account number, a four-digit card suffix, a `050-123-4567`, or a multi-kilobyte blob posing as a field name. `T-DIGEST-16`, `T-DIGEST-17`, `T-DIGEST-22` and `T-DIGEST-23` pin the four shapes.

## What it deliberately never emits

Free-text fields — most importantly `message` and `explanation` — are **excluded by construction**. Banks routinely interpolate customer-identifying detail into them, so they can carry PII even when the surrounding payload does not.

This is not a convention to be relied on by review alone: `T-DIGEST-6` in `ResponseDigest.test.ts` asserts structurally that no such value can reach the digest, so the guarantee fails loudly if someone widens the extraction.

## Reading it

`respLength` is the strongest **signal**, not a proof. It is the UTF-8 byte length of the raw body, so a Hebrew rejection envelope measures roughly twice its character count — which is precisely why a code-unit count would understate it.

| Observation                       | Signal                                                     |
| --------------------------------- | ---------------------------------------------------------- |
| Large body, zero rows parsed      | The bank likely returned data — suspect **our extraction** |
| Small body, zero rows parsed      | Suspect a **rejection envelope**, not an empty page         |
| `errorCode` / `errorName` present | The server named its own objection — start there            |
| Rows parsed but a field is blank  | Compare `rowKeys` against the field names the mapper reads  |

Size alone settles nothing: PayBox answers a rejected `/sync` with a 327–336-byte `{code, name, message, explanation}` envelope, which is small enough to read as "empty page" until `respKeys` and `errorCode` are checked. Always read the three fields together.

Because it is a standalone module rather than logic embedded in the fetch strategy, it is unit-tested in isolation and adds nothing to the strategy's size budget.
