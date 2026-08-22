---
title: In-page POST metadata
source-files:
  - src/Scrapers/Pipeline/Mediator/Network/Fetch/PageFetchPostMetadata.ts
status: new
---

# In-page POST metadata

> **Scope:** Bank-agnostic, pipeline-internal. An opt-in alternative to
> `fetchPostWithinPage` for callers that need to tell a _bounced_ response from
> an _empty_ one. Not part of the package's public API — neither function is
> re-exported from `src/index.ts`; both are reached from pipeline code under
> `Mediator/Network/Fetch/`.

## Why this exists

`fetchPostWithinPage` returns the parsed body and nothing else. That is the
right shape for the common case, but it makes two very different outcomes
indistinguishable:

| What actually happened                                               | What the caller sees |
| -------------------------------------------------------------------- | -------------------- |
| The account genuinely has no transactions                            | `null`               |
| A WAF challenge answered with HTML at status 200                     | `null`               |
| The session expired and the request was redirected to a login origin | `null`               |

A WAF challenge and an expired session both commonly arrive as a **200 carrying
HTML**, or as a **redirect to a login origin**. Parsed as JSON, both yield the
same `null` an empty result gives. A caller cannot tell an authentication
failure from an empty account, so it keeps spending its request budget against
a session that is already gone.

A provider that accepts the connection and never answers is a second version of
the same problem: the browser `fetch` has no timeout of its own, so the request
stalls the whole scrape until the outer per-run timeout fires — by which point
the session is usually gone too.

## What it returns

`fetchPostWithinPageWithMetadata` returns the transport facts alongside the
body, instead of collapsing everything into the body alone:

```typescript
interface IResponseMetadata {
  status: number;
  contentType: string;
  redirected: boolean;
  /** False when the response came from a different origin than requested. */
  sameOrigin: boolean;
}

interface IPostWithMetadata {
  http: IResponseMetadata;
  /** Parsed JSON body, or null when the response was not usable JSON. */
  envelope: unknown;
}
```

Usage:

```typescript
// Narrow per-bucket import, per the Fetch sub-module deprecation note.
// The `Fetch/index.js` barrel re-exports it as a named export too.
import fetchPostWithinPageWithMetadata from '../Network/Fetch/PageFetchPostMetadata.js';

const { http, envelope } = await fetchPostWithinPageWithMetadata(page, url, {
  data: { from: '2026-01-01' },
  timeoutMs: 15_000,
});

if (http.redirected || !http.sameOrigin) {
  // Bounced to a login / challenge origin — not an empty account.
}
if (envelope === null) {
  // The response was not usable JSON. `http` says why.
}
```

## Parse rules

The body is parsed only where parsing is meaningful. Each rule exists to keep a
failure distinguishable from an empty success:

| Condition                   | `envelope` | Why                                                                                                                                                                                             |
| --------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status === 204`            | `{}`       | A successful empty response. Answered **before** the JSON gate because servers routinely omit a content-type on a 204 — collapsing it to `null` would put it in the same bucket as a WAF bounce |
| `redirected === true`       | `null`     | Excluded even at 2xx: landing on a login origin is the most common way a scrape "succeeds" while returning nothing usable                                                                       |
| status outside 2xx          | `null`     | Reported, never thrown                                                                                                                                                                          |
| content-type is not JSON    | `null`     | The WAF-challenge shape: HTML served at 200                                                                                                                                                     |
| body claims JSON and is not | `null`     | A transport-level anomaly, not a parse error to raise — `http` already records what happened                                                                                                    |

## `timeoutMs`

Arms an `AbortSignal` inside the page. Omitted or non-positive means no
timeout.

This option lives on `IFetchPostWithMetadataOptions` and applies to **this path
only** — `fetchPostWithinPage` is unaffected.

## Why a separate function

Two reasons, and the second is the binding one.

**The return types stay honest.** This function never collapses a failure into
`null`, which is the entire reason to call it. A flag on `fetchPostWithinPage`
would leave one function with two contradictory contracts.

**The page function cannot be shared.** The function that performs the fetch is
serialised into the browser by `page.evaluate`, so it may not reference
anything outside its own arguments — it cannot call a helper, and two callers
cannot share one. The two paths could not have shared an implementation even if
the return types allowed it.

As a result `fetchPostWithinPage` is untouched by this module: same behaviour,
and the same evaluate-args object it has always built. The two paths share only
`withJsonContentType`, so both agree on Content-Type handling — captured SPA
headers stay the single source of truth, and Hapoalim's 302-on-mismatch
behaviour is unchanged.
