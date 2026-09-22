# Proposal: promoting accepted resolutions into the rule tables

**Status: proposal. Nothing in this document is implemented**, and Phase 4
item 8 asked for it that way. It is here so the decision can be made with the
costs visible rather than discovered halfway through.

## What is being proposed

Today an accepted resolution is served *beside* the converter: the
known-patterns snapshot tells the client "this sequence is known, and here is
what a human said it should be", and the engine itself is unchanged. The
promotion this document is about would take the other step — write the pair
into `features/converter/encodings/<id>/map.ts`, so the deterministic
converter maps the sequence on its own and the resolution stops being needed.

That is the right end state. Serving a lookup table beside an engine that
still cannot do the conversion is a workaround, and workarounds that work
tend to stay.

## Why it is not a small change

**It edits the thing everything else is measured against.** `rulesHash` is a
fingerprint of the table (`features/converter/engine/version.ts`). Every
`conversionFailures` row, every `failurePatterns` row and every
`aiResolutions` document carries the `rulesHash` and `engineVersion` it was
produced under. Adding one rule changes the hash for every conversion
afterwards, which is correct and is also a discontinuity in the pipeline's own
history: counts before and after are not comparable, the same way
`occurrenceCount` is not comparable across `620aacd`
(`docs/conversion-failure-pipeline.md` §3.2.1).

**It is the one irreversible step in the chain.** Everything else Phase 4
built can be undone by flipping a flag or rejecting a review: an unpublished
resolution stops being served, a rejected one is never served again. A rule in
the table converts silently, everywhere, including in documents nobody is
watching — and the thing it replaced, an unmapped-character *warning*, was the
signal that anything was wrong. A wrong rule is worse than a missing one
precisely because the missing one announces itself.

**The table has a sourcing standard, and an AI is not one of its sources.**
`bijoy/map.ts` documents the bar every existing entry met: a byte↔glyph
correspondence cross-checked across multiple independently-authored published
converters, with single-source entries rejected even when plausible
(`CLAUDE.md`, `PROGRESS.md` §9.6). A model's suggestion plus one admin's
click is a different and weaker provenance. Promotion is therefore not a data
migration; it is a change to what the table's provenance claim means, and
that has to be decided deliberately rather than inherited from a script.

## What promotion would have to include

If it is done, these are the parts. They are listed so the size is visible,
not because the order is settled.

1. **A promotion record.** Which resolution, which reviewer, which
   `rulesHash` before and after, and when. Without it the table's
   corroboration story has a gap nobody can audit later.
2. **A second reviewer, or a second source.** Whatever replaces the
   two-source bar has to be written down before the first promotion, not
   after. The weakest acceptable version: the same admin cannot both accept a
   resolution and promote it.
3. **A round-trip test per promoted rule**, generated with the rule, in
   `features/converter/__tests__/`. The existing fixtures are what stop a
   table edit breaking a neighbouring cluster; a rule that arrives without one
   is a rule nothing is watching.
4. **An engine-version bump policy.** A new rule changes output for the same
   input, which is exactly what `CONVERSION_ENGINE_VERSION`'s doc comment says
   to bump for. Whether every promotion bumps the version, or a batch does, is
   a real choice with a cost either way: per-promotion churn versus a window
   where the version does not distinguish two behaviours.
5. **A reconciliation pass.** Once a sequence converts, its `failurePatterns`
   row should move to `resolved` and its resolution should stop being
   published — otherwise the snapshot keeps shipping a candidate for something
   the engine now handles, and the two can drift apart.
6. **A rollback.** Removing a rule is easy; knowing which conversions were
   produced with it is not, since only `rulesHash` records that and it is a
   hash, not a diff. At minimum, keep the promoted pairs in a file the table
   imports, so reverting is deleting a line rather than editing the corpus.

## The cheaper alternative, and why it may be the right one

Phase 5 already asks for server-side re-verification of stored failed
sequences against the current engine. That mechanism — run the engine, see
whether it still fails — is most of what promotion needs, pointed the other
way: it detects when a sequence has *started* converting, whether because
somebody edited the table by hand or because the engine changed.

So one option is to never promote automatically, and instead use accepted
resolutions as a **work queue for a human editing `map.ts` by hand**, against
the existing two-source bar, with the re-verification pass confirming the edit
landed and retiring the resolution. That keeps the table's provenance claim
intact, keeps the irreversible step manual, and needs no new machinery beyond
an admin view sorted by `hitCount`. It is slower per rule. Given that the
whole corpus is a few hundred rules and a wrong one is silent, slower is not
obviously the wrong trade.

## What I would want answered before building either

- Does an accepted AI resolution count as a source for the table, or only as
  a lead for a human to corroborate? Everything above follows from that one
  answer.
- Does a promotion bump `CONVERSION_ENGINE_VERSION`?
- Who may promote, and may it be the same person who accepted?

Until those are answered, the accepted-resolution store stands on its own:
the converter is unchanged, the resolution is served beside it and labelled,
and nothing about the engine's output has moved.
