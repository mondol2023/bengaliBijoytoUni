# Measuring Firestore write volume

Written so the caching question ("do we need Redis in front of the
conversion-failure writes?") can be settled with a measurement instead of an
intuition. Nothing here has been run against the live project.

## What is counted

`lib/firebase/writeMetrics.ts` counts **document writes attempted**, by UTC
day, collection and operation. A write that later fails still counts: it cost
a round trip and usually a retry, which is what a capacity question cares
about.

Instrumented today: `lib/firebase/conversionFailures.ts` only. That is the
collection the question is about, and the only one whose volume scales with
anonymous traffic rather than with signed-in actions. Other writers adopt it
by calling `countWrite` next to their own write — the module imports nothing,
so that is a one-line change.

**Two document writes per accepted report**, always: one `conversionFailures`
occurrence and one `failurePatterns` create-or-update. That ratio is fixed and
independent of the `occurrenceCount` the report carries, which is what makes
the batching in `reportBuffer.ts` a write-volume control as well as an
accuracy fix.

## Why the counters are not stored in Firestore

A counters document incremented on every write costs one write per write. It
would double the quantity being measured and change the answer it exists to
inform. An instrument must not move the needle it reads.

## Reading the numbers

Two views, and they answer different questions.

**Live, one instance:** `GET /api/admin/write-metrics` (admin token required).
Returns this process's counters by day and collection. Useful as a sanity
check — "is the endpoint being hammered right now" — and useless as a
deployment total, because each instance has its own counters and they die with
the instance. The response says so in a `scope` field rather than letting the
reader assume.

**Deployment-wide, per day:** one structured line per minute of activity, per
instance, on stdout:

```json
{"metric":"firestore_writes","instanceId":"3f8c1a02","day":"2026-09-21","windowMs":60000,"total":37,"deltas":{"conversionFailures:create":18,"failurePatterns:update":19}}
```

The lines carry **deltas**, not running totals, so summing every line for a
day across every instance gives that day's real write count. With a log drain
(Vercel, Cloud Logging, or whatever is in front of the deployment):

```
filter: metric = "firestore_writes" AND day = "2026-09-21"
sum:    total
```

Without a drain, `vercel logs --since 24h | grep firestore_writes` and sum the
`total` fields — the format is one JSON object per line specifically so that
works.

## Deciding the caching question with it

The Redis + write-behind proposal was declined for now, with the agreement to
revisit it on measured volume. What to look at once there is a week of data:

- **Writes per day for `conversionFailures` + `failurePatterns`.** Firestore's
  free tier is 20,000 document writes/day. Below a few thousand, a cache in
  front of this is solving a problem that does not exist.
- **The create:update ratio on `failurePatterns`.** Mostly updates means a
  small set of patterns is being hit repeatedly, which is the shape a
  write-behind buffer would actually help. Mostly creates means the write
  volume is genuinely new information and buffering would only delay it.
- **Peak minute versus daily average**, from the per-minute lines. A flat
  profile at low volume needs nothing. A spiky profile that is fine on average
  but bursts is the case for rate shaping rather than for a cache.

Worth restating the objection that stands regardless of the numbers: an
in-memory write buffer on a serverless host loses whatever it holds when the
instance is frozen or recycled. A buffer only becomes safe once it is in a
store that outlives the process, and at that point it is a second database,
with its own failure mode, in front of a first one that was not failing.
