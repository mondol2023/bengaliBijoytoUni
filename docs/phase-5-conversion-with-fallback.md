# Phase 5 design: `runConversion()`, and what happens when the engine cannot

**Status: design only. Nothing in this document is implemented**, as §4 of
the brief asked. Where it says "would", that is literal.

## 0. What exists today, so the gap is visible

`convertLegacyText(text, encodingId)` in
`features/converter/engine/pipeline.ts` is the whole conversion path, called
identically from the browser (`hooks/useConversion.ts`, per debounced
keystroke) and from the server (`app/api/documents/extract/route.ts`). It
returns a `ConversionOutput` whose `validation.unmappedDetails` lists what it
could not map.

Phase 4 added a store of accepted resolutions and publishes them in the
known-patterns snapshot, but **nothing reads that array yet**. The only
importers of `lib/conversionFailures/knownPatternsClient.ts` are its own test
and a privacy test. `runConversion()` does not exist under that or any other
name.

So Phase 5 is: one function that runs the engine, then consults the store for
what the engine could not do, and is honest in the output about which is
which.

## 1. `runConversion()` — shape and order

```ts
// features/converter/runConversion.ts — proposed, does not exist
export interface RunConversionOptions {
  readonly text: string;
  readonly encodingId: string;
  /** Snapshot reader; omitted on the server, injected in tests. */
  readonly resolutions?: ResolutionSource;
  readonly signal?: AbortSignal;
}

export interface RunConversionResult {
  readonly conversion: ConversionOutput;      // exactly what the engine returned
  readonly segments: readonly OutputSegment[]; // what to render
  readonly fallbacksApplied: readonly AppliedFallback[];
  readonly unresolved: readonly UnmappedDetail[];
}
```

**The converter always runs first, on the whole input, every time.** Not as a
cache check — as the answer. The store is consulted only for the sequences
`validation.unmappedDetails` reports, and only after the engine has had its
say. Three reasons this order is not negotiable:

- the engine is the thing with provenance (`bijoy/map.ts`'s two-source bar);
  a stored resolution is one admin's judgement about one sequence;
- if the table has since grown a rule for that sequence, the engine's answer
  is the right one and the store's is stale — running the engine first makes
  that resolve itself, with no invalidation logic;
- it is what makes the re-check in §3 free: we already know, per conversion,
  whether the engine still fails on each sequence.

**No live AI call, ever, on this path.** Not as a fallback, not behind a flag,
not "only for signed-in users". The only way a resolution reaches a user is
if it was stored earlier and a human accepted it. `runConversion` must not be
able to import `lib/ai` at all — the import-boundary test
(`lib/ai/__tests__/callSites.test.ts`) already enforces the shape of that
rule and would be extended to name this module.

**Lookup order for one unmapped sequence:**

1. **In-memory map** for this page/process, built once per snapshot. A
   document with nine hundred instances of one bad sequence must do one
   lookup, not nine hundred.
2. **The cached snapshot** (`fetchKnownPatterns`, `localStorage`, fresh for 10
   minutes, revalidated by ETag). Already built; already returns the stale
   copy on any failure and `null` rather than throwing.
3. **Nothing.** The sequence stays unmapped and is reported as it is today.

Step 2 is a network call, so `runConversion` must not await it on the typing
path. The snapshot is fetched once when the encoding is chosen and the result
is applied to conversions after it arrives; a conversion that happens before
it lands is simply a conversion with no fallbacks, re-rendered when the
snapshot appears. The converter's own output never waits.

## 2. The failure states, and the exact order

```
                    ┌──────────────────────────────┐
  input text ──────▶│ convertLegacyText()          │  always, first, whole input
                    └───────────────┬──────────────┘
                                    │
                    ┌───────────────▼──────────────┐
                    │ validation.unmappedDetails   │
                    └───────┬──────────────┬───────┘
                            │ empty        │ non-empty
                            ▼              ▼
                    ┌──────────────┐   ┌───────────────────────────┐
                    │ CLEAN        │   │ for each unmapped sequence│
                    │ engine output│   └─────────────┬─────────────┘
                    └──────────────┘                 │
                                                     ▼
                                       ┌───────────────────────────┐
                                       │ 1. in-memory map          │
                                       └──────┬─────────────┬──────┘
                                          hit │             │ miss
                                              │             ▼
                                              │   ┌───────────────────────┐
                                              │   │ 2. cached snapshot    │
                                              │   │    (never awaited on  │
                                              │   │     the typing path)  │
                                              │   └───┬──────────┬────────┘
                                              │   hit │          │ miss / not
                                              │       │          │ yet loaded
                                              ▼       ▼          ▼
                                     ┌──────────────────┐  ┌──────────────┐
                                     │ validator, again │  │ UNRESOLVED   │
                                     └───┬──────────┬───┘  │ show the raw │
                                    pass │          │ fail │ bytes, warn, │
                                         ▼          ▼      │ report it    │
                              ┌──────────────┐ ┌──────────┐└──────────────┘
                              │ FALLBACK     │ │UNRESOLVED│
                              │ labelled,    │ │ as above │
                              │ reportable   │ └──────────┘
                              └──────────────┘
```

Four states, and every one of them is a state the UI has to be able to draw:

| State | What the user sees | What is recorded |
|---|---|---|
| `clean` | Converted text, nothing extra | Nothing |
| `fallback_accepted` | Converted text with the filled sequence marked, and by whom | A hit (`hitCount`, batched) |
| `fallback_unverified` | Same, plus "AI-suggested, unverified" — only when `SERVE_UNVERIFIED_AI` is on | A hit |
| `unresolved` | The raw legacy bytes, in `font-mono`, with the existing warning | A failure occurrence, as today |

The fourth state is the existing behaviour and must not get worse. A fallback
path that swallows an unmapped sequence into plausible-looking Bengali,
rather than showing the bytes, would remove the one signal the user has that
anything went wrong.

**The validator runs a third time here**, on the client, before rendering.
Twice was the Phase 4 rule (before storing, before serving). The third run
costs nothing — it is a pure function already in the client bundle — and it
is the only one that sees the actual output text being assembled. It is cheap
insurance against a snapshot that was valid when it was built and is being
applied against a different engine version in a tab that has been open for a
week.

## 3. How "resolved" gets decided, and why a client cannot decide it

**The threat.** `failurePatterns.status` is a published field
(`toKnownPattern`). If a client could set it — by reporting "I converted this
fine now", or by any endpoint that takes a status — an anonymous caller could
mark real gaps resolved and make them disappear from the admin's work queue.
That is the quiet version of the count-poisoning finding in
`docs/threat-model-public-failure-endpoints.md` §2: not injecting content,
but deleting evidence.

Today nothing can: `firestore.rules` denies all client writes to
`failurePatterns`, and no route accepts a status. **That must stay true.** The
design below adds no client-writable path to `status`.

**Proposed: server-side re-verification.** The server decides "resolved" by
running the current engine over the stored `failedSequence` itself:

```ts
// proposed
function reverify(pattern: FailurePattern): "still_fails" | "converts_now" {
  const result = convertLegacyText(pattern.failedSequence, pattern.encodingId);
  // `convertLegacyText` is pure and isomorphic, so the server runs the exact
  // code the browser ran — no second implementation to drift.
  return result.ok && result.value.validation.valid ? "converts_now" : "still_fails";
}
```

Nothing about the caller enters that decision. The input is a sequence the
server already stored; the judge is the engine the server is running.

**When it runs.** Two triggers, and they answer different questions:

1. **On an engine or rules change.** `CONVERSION_ENGINE_VERSION` or an
   encoding's `rulesHash` differing from what a pattern was stored under is
   exactly the condition under which the answer could have changed. A pass
   over the patterns for that encoding, marking the ones that now convert.
   This is the one that matters: it is how a table fix retires the patterns it
   fixed, instead of leaving them open forever.
2. **When an occurrence arrives**, opportunistically, for that one pattern.
   Cheap (one pure function call on a ≤200-character string) and it catches
   the case where a pattern was marked resolved prematurely — a fresh
   occurrence against an unchanged engine is evidence it was not.

A third trigger is worth naming and rejecting: **not on every snapshot
build.** Re-verifying the top 50 patterns every 60 seconds would work, but it
buries the signal — the answer only changes when the engine changes, and
re-deriving it constantly makes it impossible to say when it changed or why.

**The same mechanism fixes finding 2 of the threat model.** Publishing only
sequences the current engine actually fails on means invented text that
converts cleanly, or that is not legacy bytes at all, never reaches the
snapshot. That was mitigation 1 in that document, deferred to "before the
snapshot reaches the UI" — which is this phase.

**What re-verification must not do:** delete anything. A pattern that now
converts becomes `status: "resolved"`, and its occurrences keep their normal
retention. Deleting on re-verification would mean a bad engine change could
erase the evidence of what it broke.

## 4. Labelling, and reporting a wrong result

**The label travels in the data.** Phase 4 already put it there:
`KnownResolution.label` is a `{ en, bn }` pair on the payload, non-null
exactly when `verification` is `unverified`. A component cannot forget to
render it, because there is no other place the text lives. `runConversion`
carries it through to the segment it labels.

**Marking, not styling.** A filled sequence renders as a marked span inside
the converted text, with:

- the converted Unicode in `font-bengali` with `lang="bn"`, like all converted
  output;
- a visible marker — not colour alone — so the distinction survives a
  screenshot, a monochrome print and a colour-blind reader;
- the origin in text on hover *and* in an adjacent element, because the
  reader who most needs to know this was filled from a store is the one who
  cannot hover;
- for `fallback_unverified`, `AI_UNVERIFIED_LABEL` shown, not tucked into a
  tooltip. An unreviewed machine suggestion presented as indistinguishable
  from a converted result is the failure mode the flag exists to make
  deliberate.

**Reporting a wrong result.** The mechanism exists: `POST /api/feedback`
already takes a `wrong_conversion` category with `encodingId`, `sampleInput`
and `sampleOutput`, is open to anonymous callers, and is rate-limited at 5 per
10 minutes. Phase 5 would add a "this is wrong" control on a marked segment
that pre-fills that form with the failed sequence and the fallback that was
applied — no new endpoint, no new collection.

What it must **not** do is let the report change anything by itself. A report
is evidence for an admin, the same as an occurrence is; the resolution's
status changes only when a human acts on it in the admin UI. The obvious
temptation — "three reports and it un-accepts itself" — is a client-writable
path to a server-side decision wearing a delay, and it is the same hole §3 is
about.

An admin-side counter of reports per resolution would be worth having, so the
review queue can be sorted by "accepted, and people are complaining". That is
a field and a query, not a mechanism, and it does not change who decides.

## 5. What this design deliberately leaves out

- **Promotion into the rule tables.** Separate proposal
  (`docs/proposal-promoting-resolutions-to-rules.md`), and it stays separate.
- **Any live provider call.** Stated again because it is the one thing that
  would quietly make everything else here pointless.
- **Fallbacks for anything but an exact `(encodingId, failedSequence)` match.**
  No fuzzy matching, no context-window matching, no partial-sequence
  stitching. Each of those is a way to apply a human's judgement about one
  sequence to a sequence they never saw.

## 6. Open questions

1. Does a fallback count as "converted" for usage limits and word counts, or
   is it reported separately? It changes what the tier counters mean.
2. Should the document path (`/api/documents/extract`) apply fallbacks at
   all, or only the interactive converter? A marked span is legible on
   screen; a downloaded file has nowhere to put the label, which argues for
   leaving document output unfilled and listing the sequences instead.
3. On re-verification finding that a pattern now converts, should the
   accepted resolution for it be retired, kept as history, or kept and
   simply stop being published? I would keep and stop publishing — it is the
   record of how the gap was closed.
