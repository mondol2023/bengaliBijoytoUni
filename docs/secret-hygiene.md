# Secret hygiene

Three things, in the order they matter:

1. **[`scripts/secretScan.mjs`](../scripts/secretScan.mjs)** — the on-demand sweep over every
   tracked file and, with `--history`, every blob the repository has ever held.
2. **[`lib/security/__tests__/envExample.test.ts`](../lib/security/__tests__/envExample.test.ts)** —
   Guard A, which runs in the normal suite and fails the build if a tracked `.env*.example`
   file ever holds a real-looking value.
3. **The findings**, recorded below, redacted.

The scanner and the guard overlap deliberately. Guard A is narrow and always on: it covers the
one file class where a credential is most likely to end up, and it runs on every commit without
anyone remembering to run it. The scanner is broad and manual: it covers everything, including
unreachable history, and it is the thing to run before making the repository public, before
rotating anything, and after any incident.

## Running it

From `convert2uni/`:

```bash
npm run scan:secrets            # tracked files
npm run scan:secrets:history    # + every blob in git history
node scripts/secretScan.mjs --json --history   # same, machine-readable
```

Exit code is 1 when anything matched outside the allowlist, so it can gate CI.

## It never prints a value, and that is the feature

The obvious way to write a scanner is to echo the offending line so a human can judge it. That
copies the credential into terminal scrollback, into CI logs, and into whatever pastes the
output into a ticket — usually somewhere more widely readable than the branch that leaked it.

This one prints the location, the pattern name, the line, and the match length. That is enough
to go open the file, which is the right place to read the value. Guard A holds the same line
and has a test asserting its own failure message names no value.

## What is scanned

Ten patterns: Google/Firebase API keys, OpenAI keys, PEM private-key blocks, service-account
JSON (`"private_key":`) and service-account e-mail addresses, GitHub tokens, AWS access key
IDs, JWTs, Slack tokens, and a generic `secret|token|password|api_key|credential = "<16+ chars>"`
assignment.

History mode reads every object via `git cat-file --batch-all-objects`, which includes blobs
from commits no longer reachable from any branch. That is the case that matters: a secret
"removed in the next commit" is still in the object database, and still recoverable, until the
history is rewritten and the objects are pruned.

Binary extensions (images, fonts, archives, video, PDFs) are skipped.

## Allowlist

Five matches are not credentials. An entry is a **(path, pattern) pair**, not a path:
exempting a whole file would make it a permanent blind spot, and a real key pasted into it
later would be reported as known-benign by the one tool whose job is to notice.

| Location | Pattern | Why it is benign |
| --- | --- | --- |
| `app/api/admin/conversion-failures/[patternId]/resolve/route.test.ts` | `assigned-secret-literal` | sentinel string proving `debug` is stripped from the response |
| `app/api/admin/conversion-failures/[patternId]/review/route.test.ts` | `assigned-secret-literal` | same sentinel, other route |
| `lib/conversionFailures/limits.test.ts` | `assigned-secret-literal` | fake document text proving the privacy bound truncates |
| `lib/security/__tests__/envExample.test.ts` | `google-api-key` | synthetic sequential-digit key proving Guard A can actually fail |
| `docs/secret-hygiene.md` | `service-account-json` | this file's own prose, which names the JSON key that pattern looks for |

The first four are fixtures some test asserts on, so deleting one breaks that test rather
than silently shrinking this list. The fifth is this document matching the scanner it
documents — a self-reference, added when the file was committed and caught by the next run
rather than by review.

Adding to this list requires the reason to be *the value is not a credential* — never *the
finding is inconvenient*.

## Findings

### 2026-09-21, at `53040b9` (17 commits)

```
Scanned 260 tracked file(s) and 392 history blob(s) against 10 patterns.
8 match(es), 0 unexpected.
```

Eight matches: the four allowlisted locations then in the list, each appearing once in the
working tree and once as a history blob.

### 2026-09-21, re-run at `1c84583` (25 commits)

```
Scanned 295 tracked file(s) and 448 history blob(s) against 10 patterns.
10 match(es), 0 unexpected.
```

Ten matches: the five allowlisted (path, pattern) pairs, each once in the working tree and
once as a history blob. **No unexpected match anywhere, in the working tree or in any blob
the repository has ever held.**

The fifth pair appeared between the two runs, and it is this file: committing the sentence
that names `"private_key":` put a match for the `service-account-json` pattern into the
working tree and into history. The re-run reported it as UNEXPECTED and exited 1 — which is
the scanner working. It was resolved by naming it in the allowlist, not by rewording the
sentence, because the history blob would keep matching either way.

### `.env.local.example` specifically

The question was whether the key that was once staged locally ever reached a commit.

- `.env.local.example` has existed in exactly three versions, at `b537d75`, `dc1f7e6`, and
  `53040b9`. Every one of those blobs has **zero** non-empty `KEY=value` assignments — every
  line is either a comment or a bare `KEY=`.
- `.gitignore` ignores `.env*` and re-includes only `!.env.local.example`, so the real
  `.env.local` cannot be staged by accident.
- `git ls-files --error-unmatch .env.local` reports the path is unknown to git: it has never
  been tracked.
- The history sweep above finds no Google API key shape in any blob other than the synthetic
  one in Guard A's own test.

The staged value never entered the object database. Nothing needs rewriting. No value was
printed at any point in producing this, including by the scanner in the negative test below.

### Negative test

A scanner that never fires is indistinguishable from one whose patterns are wrong. A
syntactically valid but fake Google key was appended to a tracked file; the scan reported

```
  UNEXPECTED
    README.md:199  google-api-key  length=39
```

and exited 1, naming no value. The file was then reverted and `git status` confirmed clean.

## If it finds something

1. Do not paste the value anywhere — not into a ticket, not into a chat, not into a commit
   message explaining the fix.
2. **Rotate first.** A key in git history is compromised whether or not the history is
   rewritten, because clones and forks already have it.
3. Then remove it: if it is only in the working tree, delete and commit; if it is in history,
   rewriting (`git filter-repo`) plus a force-push plus re-cloning by everyone is the only
   real removal, and it is worth doing only after the rotation.
4. Add whatever pattern missed it.
