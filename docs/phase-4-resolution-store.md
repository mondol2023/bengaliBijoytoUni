# Phase 4 design: storing and serving accepted resolutions

One page, written before any code. The principle it has to keep: **no live AI
call in the user conversion path**, AI output is never authoritative, and only
a human promotes a resolution.

## Decision: extend `aiResolutions`. No new collection.

The brief said a new collection needs evidence. I looked for it and did not
find it.

`aiResolutions` already carries `provider`, `model`, `promptVersion`,
`engineVersion`, `rulesHash`, `candidateConversion`, `confidence`,
`alternativeCandidates`, `rawResponse`, and the full review quartet
(`reviewDecision`, `reviewedBy`, `reviewedAt`, `reviewNote`). The admin
accept/reject flow exists end to end: `POST /api/admin/conversion-failures/[patternId]/review`
→ `lib/ai/reviewConversionResolution.ts` → an audit-log entry, with reviewer
identity derived server-side and never read from the body. A second
collection would restate every one of those fields and need a second review
route, a second audit action and a second admin screen. That is the
duplication the brief warned about, bought for nothing.

**Four things are genuinely missing**, and each is an added field or index
rather than a reason to start over:

| Need (brief §) | Gap today | Change |
|---|---|---|
| Key by `encodingId` + failed sequence (§2) | Keyed by `patternId` = `sha256(encodingId\|engineVersion\|failedSequence)` — **engine version is baked into the key**, which §2 says it must not be | Denormalize `encodingId` and `failedSequence` onto the document, server-derived from the authoritative pattern, never client-supplied. `patternId` stays as provenance. |
| Statuses `unverified \| accepted \| rejected` (§3) | `status` (`pending\|completed\|failed\|reviewed`) plus `reviewDecision` | Derive, don't add a third status field: `accepted`/`rejected` are `reviewDecision`; everything else is `unverified`. One exported function owns the mapping. |
| `hitCount`, `lastUsedAt` (§3) | Absent | Add. Increments are batched and atomic; the serving path does not write per request (it reads a snapshot), so the per-document write rate stays low. |
| Accepted must survive TTL (§6) | `aiResolutions` carries no `expireAt` at all today | Keep it that way, and assert it — a test that fails if `expireAt` is ever written to an accepted resolution. |

`engineVersion` stays on the document as metadata and is reported alongside a
served result, but it is not part of the lookup. A resolution accepted under
an older engine is still a candidate; whether it is still *correct* is the
validator's question, not the key's.

## Lookup key and the context window

Key: `(encodingId, failedSequence)`. `contextBefore`/`contextAfter` are
metadata only. They are 80 characters of *someone else's* text — matching on
them would make the store narrower with every occurrence and would mean one
user's surrounding words decide whether another user gets a result. If a
match constraint on context ever turns out to be needed, it needs its own
justification and its own tests; it is not in this phase.

## The validator

A pure function in `lib/conversionFailures/`, no I/O, no Firebase, no
provider import — so it can be tested exhaustively and cannot be skipped by
being unreachable. It checks: output is valid target-script Bengali; no
residual legacy characters survive; the length ratio against the source is
sane; nothing is added or dropped beyond what conversion explains.

It runs **twice**: before storing a candidate, and again before serving one.
Twice because the two moments answer different questions. The first asks "is
this worth keeping"; the second asks "is this still right *now*" — the engine,
the rules and the normalization may all have moved since, and a stored
`accepted` flag is a record of a past human judgement, not a standing
guarantee.

## Serving

The existing known-patterns snapshot gains the accepted resolutions:
**accepted only**, top N by `hitCount`, size-capped, ETag-versioned, and
invalidated by the versioning already in place. No network call in the
conversion hot path; no Firestore read either, since the snapshot is what the
client holds.

`SERVE_UNVERIFIED_AI` is a flag, **default off**. When on, results carry an
explicit "AI-suggested, unverified" label through to the UI — the label is
part of the payload, not something a component remembers to add.

One thing the threat model makes non-optional here: the same endpoint already
publishes `failedSequence`, and an anonymous caller can choose which
sequences reach the top N by inflating counts
(`docs/threat-model-public-failure-endpoints.md` §2). Adding
`candidateConversion` to that payload widens what an attacker could get in
front of users. The validator's second run is the control that stops it, and
`hitCount` ordering has the same poisoning question as `occurrenceCount` —
which is why `hitCount` increments only on a *served* accepted resolution, a
path an attacker cannot reach without an admin first accepting their content.

## AI safety

All of it against a mocked provider; **no test calls an external API**, and
real provider behaviour stays UNVERIFIED until someone runs it deliberately.
User text is passed as delimited data, never as instructions, with
injection-resistance tests. Timeouts, bounded retries with backoff,
in-flight de-duplication so one pattern is not resolved twice concurrently,
and a daily cost cap that fails closed.

## Explicitly not in this phase

Promoting accepted resolutions into permanent rule tables. That is a change
to `features/converter/engine/**`, it is irreversible in a way nothing else
here is, and it deserves its own proposal. Written up separately, not built.
