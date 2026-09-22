# Where the tests came from: 632 → 816, commit by commit

Asked because a suite that grows by 184 tests between two reports is either
real coverage or padding, and the difference should not have to be taken on
trust.

**Short answer:** 632 was the end of Phase 2 (`3aba875`). 816 was the end of
Phase 3 item 6 (`6b6e33c`). Between them sit two groups: four
security-hardening commits that ran before Phase 3 opened (+36), and Phase 3
items 1–6 (+148). No commit in the range added a test that asserts nothing,
and none of the growth is one feature tested six ways — the largest single
contribution, 39 tests, is a cache with five distinct failure modes.

## How these numbers were obtained

Each row's delta is the `it(`/`test(` declarations the commit adds to
`*.test.ts` / `*.test.tsx`, with `it.each([...])` counted as its number of
cases. That static count was checked against the runtime totals recorded in
the commit messages at eleven points (`fe59646` 816→822, `398f6c7` 822→835,
and every commit of the current branch through `8e60e13` 872→877); it agreed
at every one. The two rows below whose commit messages state no total
(`51b18cc`, `53040b9`) are counted the same way, and their sum closes the gap
to the independently recorded figure of 668 exactly.

That 668 is not a figure invented here: `bc1ee58`'s message records a flaky
rate-limit test "caught once in 668 tests", which fixes the suite size at
that commit.

## 1. Between the phases: +36

These are the Guard A / Guard B commits — the response to the secret-hygiene
review, done before Phase 3 work started.

| Commit | What it added | Δ | Suite |
|---|---|---:|---:|
| `3aba875` | *end of Phase 2* — `feat(E2)`, shared `normalizeSource()` | — | **632** |
| `51b18cc` | Guard A: `lib/security/__tests__/envExample.test.ts` — a tracked `.env*.example` holding a real value fails the suite | +6 | 638 |
| `53040b9` | Guard B: `lib/ai/__tests__/callSites.test.ts` (11) pinning the provider-import inventory as an exact set, and `lib/ai/registry.test.ts` (+19, of which 16 are two `it.each` tables over flag spellings) | +30 | **668** |
| `9e52e66` | Secret-hygiene scan and its redacted findings — script and data, no test file touched | 0 | 668 |
| `bc1ee58` | Made an existing rate-limit window test deterministic; rewrote a test, added none | 0 | 668 |

Two of the four added nothing, which is the point of listing them: the jump
is not spread evenly and there is no reason to pretend it is.

## 2. Phase 3 items 1–6: +148

| Commit | Item | What it added | Δ | Suite |
|---|---|---|---:|---:|
| `48f109d` | 1 | `CacheStore`, an in-memory LRU and a browser store — LRU by use not by write, TTL, version and rules-hash invalidation, storage-unavailable, quota exceeded, corrupted entry | +39 | 707 |
| `6a10883` | 2 | Known-patterns snapshot endpoint with ETag revalidation | +35 | 742 |
| `620aacd` | 3 | Batched count deltas, and `lib/firebase/__tests__/conversionFailures.test.ts`, which had no test at all before | +31 | 773 |
| `3f2f6fa` | 4 | Sort failure patterns by occurrence count | +6 | 779 |
| `2978415` | 5 | Firestore write metrics, including one test asserting the metrics module imports nothing | +17 | 796 |
| `6b6e33c` | 6 | Golden-corpus runner for real legacy documents — skips cleanly while the corpus is empty | +20 | **816** |

`7413459` (the dev-environment proposal) also carries a "Phase 3 item 4"
label and added no tests; it is a design document, and the implementation
landed later as `0af9ed1`.

## 3. Why 39 tests for a cache

The one row that looks disproportionate. The cache is the only component in
this range whose *failure* modes outnumber its success mode: a browser store
can be absent, throw on write, be over quota, or return a value that no
longer parses, and each of those has to degrade to a miss rather than to an
exception in the conversion path. Eviction order (by use, not by write) and
two independent invalidation keys (snapshot version, rules hash) are four
more. The success path is a handful of tests; the rest is the list of ways it
is allowed to fail.

## 4. After 816

Recorded here so the chain does not stop mid-air. `fe59646` +6 → 822;
`dc94901` 0 → 822; `398f6c7` +13 → **835**, which is the baseline the Phase 3
close-out work started from. The close-out itself: `1c84583` 0, `3c58c7f` 0,
`719c15d` +15 → 850, `0af9ed1` +1 → 851, `841ad29` +9 → 860, `2cafe84` +9 →
869, `d6c3241` +3 → 872, `8e60e13` +5 → **877**.

## 5. The one correction

The review called 816 "the start of Phase 3". It is not: Phase 3 item 1
(`48f109d`) began at 668, and 816 is where Phase 3 items 1–6 ended — the
figure reported when those items were presented for review. The 632 → 816
span therefore covers Phase 3's implementation plus the four hardening
commits that preceded it, not a gap before Phase 3 began.
