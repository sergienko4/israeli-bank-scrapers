# Response digest

> **Who this is for:** maintainers diagnosing a scrape that "succeeded" (HTTP 200) but returned nothing.

An HTTP status alone cannot distinguish a bank returning **an empty page** from our code **failing to extract a full one** — both look like `200`. That ambiguity stalled three separate PayBox investigations, because the only way to tell them apart is to look at the response body, and the body is exactly what we must not log.

`digestResponse()` (`src/Scrapers/Pipeline/Strategy/Fetch/ResponseDigest.ts`) resolves this. It reduces a response body to an `IResponseDigest` — a fixed, non-sensitive shape that the fetch strategy spreads into its `fetch STATUS` debug line.

## Fields

| Field        | Meaning                              | Why it is safe                    |
| ------------ | ------------------------------------ | --------------------------------- |
| `respLength` | Body size in bytes                   | A number, never content           |
| `respKeys`   | Top-level JSON key **names**         | Structure only — never values     |
| `errorCode`  | Server error code, when present      | Machine identifier, not free text |
| `errorName`  | Server error name/type, when present | Machine identifier, not free text |

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

Size alone settles nothing: PayBox answers a rejected `/sync` with a 327–336-byte `{code, name, message, explanation}` envelope, which is small enough to read as "empty page" until `respKeys` and `errorCode` are checked. Always read the three fields together.

Because it is a standalone module rather than logic embedded in the fetch strategy, it is unit-tested in isolation and adds nothing to the strategy's size budget.
