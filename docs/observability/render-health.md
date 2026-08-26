# Render health and element identity

> **Who this is for:** maintainers reading a failed [HOME](../phases/home.md) phase in `pipeline.log`, and anyone debugging a credential field that was filled twice, or not at all.

Two diagnostic signals that answer questions the existing trace could not. Render health answers *"did the page actually paint?"*; element identity answers *"is this the same field I already filled?"*.

Both are safe to share: render health reports three integers, and an identity token is a structural path such as `BODY:0/FORM:1/INPUT:0`. Neither can carry page content, a value, or a credential.

## Render health

Every other HOME signal describes **navigation**, not **rendering**. When a bank served its document but its stylesheets or bundles never arrived, the trace reported an ordinary `didNavigate: true, loginForm: false` — indistinguishable from a markup change. Telling those apart meant opening the screenshot and judging its byte size. These counters put the distinction in the log.

### Fields

| Field | Type | Meaning |
|---|---|---|
| `elements` | integer | Elements below `<body>`. A homepage that painted carries hundreds; an error shell or a stalled SPA mount carries a handful |
| `styleSheets` | integer | Stylesheets the document accepted. Reported, but see below — it does not vote |
| `bodyHeight` | integer | Laid-out body height in pixels, rounded |
| `isRendered` | boolean | The blank-page verdict derived from the counters |
| `status` | `observed` \| `unknown` | Whether the counters were read at all |

### `status` is what makes the verdict readable

A failed probe reports zeroed counters — which is also exactly what a document with no body yields. Without `status` those two cases are byte-identical in the trace, and separating them is the entire point of the signal.

| `status` | Means | `isRendered` |
|---|---|---|
| `observed` | The counters came from the document | The real verdict |
| `unknown` | The probe threw, or outlived its budget | Always `false` — absence of evidence, **not** evidence of a blank page |

Never read `isRendered: false` as "the page is blank" without checking `status` first.

### The blank-page thresholds

A document counts as rendered only when it exceeds **both** thresholds — more than 20 elements **and** more than 100 pixels of body height. One alone is too easy to satisfy: an error shell can be tall, and a lazy mount can be wide but empty.

Stylesheet count deliberately does not vote. A document whose CSS was blocked but whose DOM arrived *did* render — just unstyled. The count is still reported, so a `styleSheets: 0` is visible in the log; that is what makes a failed asset load readable without opening a screenshot.

### Diagnostic only

Nothing here decides whether a phase passes. The probe is best-effort by design: one that throws or times out reports the unknown result rather than propagating, because a diagnostic must never be able to fail the phase it is describing.

### Exports

| Export | What it gives you |
|---|---|
| `measureRenderHealth` | Reads the counters from a page and returns the verdict. Never throws — an unreadable page yields `UNKNOWN_RENDER` |
| `isRenderedFrom` | Applies the two thresholds to an already-read `IRenderCounts`. Pure, so the verdict is testable without a browser |
| `UNKNOWN_RENDER` | The `status: 'unknown'` result. Its `isRendered: false` records absence of evidence, not a blank page |
| `BLANK_PAGE_MAX_ELEMENTS` | The element-count threshold a document must exceed |
| `BLANK_PAGE_MAX_BODY_HEIGHT_PX` | The body-height threshold, in pixels, a document must exceed |
| `IRenderCounts` | The raw counters: element count, body height, stylesheet count |
| `IRenderHealth` | The counters plus `isRendered` and `status` |
| `RenderProbeStatus` | The `'observed' \| 'unknown'` discriminant — read it before trusting `isRendered` |

## Element identity

Selector strings are a poor proxy for identity, and they fail in **both** directions:

- **False match** — two different inputs answer the same string. A password field and its confirmation both answer a type-based selector.
- **False miss** — one input is described by two strings. `#user` and a placeholder match reach the same node.

The credential-collision guard that compares fields inherits both failures. An identity token replaces the comparison with the element's own position in the document tree, which is unique per element and independent of whichever selector found it.

### Exports

| Export | What it gives you |
|---|---|
| `elementPathToken` | Builds the position token. Runs in the browser realm, so it is self-contained by necessity |
| `readElementIdentity` | Resolves a locator and reads its token, within a bounded budget |
| `UNKNOWN_IDENTITY` | The empty-string token returned when identity could not be established |

### Handling an unknown token

`readElementIdentity` returns `UNKNOWN_IDENTITY` — the empty string — when the locator did not resolve, the read outlived its budget, or the element was detached from any document.

An unknown token means **"cannot compare"**. It must never be read as a match, and two unknown tokens are not equal to one another in any meaningful sense. Callers that compare identity may therefore only ever *add* a collision on the strength of a token, never clear one that the selector already established.

Note that a present `elementId` property does **not** imply a known identity: the field is always set, and carries the empty token when the read failed. Check the value, not the key.

### Shadow boundaries

A shadow root stops `parentElement`, so a walk that ignored it would describe an element by its position *within its own shadow tree*. Two copies of the same custom element, each holding one input, would then answer the same path and be read as one element. The walk crosses the boundary through the shadow host instead, so the host's own path prefixes the inner one and the two copies stay distinct.

## See also

- [Structured events](events.md) — where these fields surface in the trace
- [HOME phase](../phases/home.md) — where render health is measured
