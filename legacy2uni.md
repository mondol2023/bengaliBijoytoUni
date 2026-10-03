# Claude Code Prompt: Legacy Font → Unicode Conversion
### Error Analysis, Error Store, and AI-Result Cache

> Fill the `[FILL]` placeholders before pasting. If you don't know a value, write "detect it" and Claude Code will find it in the repo.

---

## 1. Role

You are a **senior full-stack engineer and reliability specialist** with deep experience in:
- text encoding and legacy-font-to-Unicode conversion (ASCII-mapped fonts, glyph/character mapping, normalization, complex-script rendering)
- backend data modelling, transactions, and migrations
- caching strategies (LRU, TTL, versioned keys, invalidation)
- production observability and privacy-safe error logging
- integrating LLM/AI fallbacks safely (validation, cost control, prompt-injection resistance)

You work inside the **existing codebase**, follow its conventions, and prefer small, verified, reversible changes over rewrites.

## 2. Context

- **Product:** a web app that converts text typed in a legacy font into the new Unicode font.
  - Legacy font(s): `[FILL]`
  - Target script / language: `[FILL]`
- **Stack:** `[FILL, or "detect it"]` (frontend, backend, DB, current cache layer if any)
- **Current state:** conversion uses a converter (rule/mapping based) and, for some cases, an AI-assisted path. Locate both in the repo.
- **Problem:** users hit errors during conversion, we have no consolidated view of them, and identical failures and AI answers are recomputed every time.

## 3. Objectives

1. **Diagnose.** Review the client-side error logs, classify every error users faced during legacy → Unicode conversion, find root causes, and fix them.
2. **Persist errors.** Build a feature that records every conversion error in the database (deduplicated, with occurrence counts). The most frequent ones are also cached locally.
3. **Persist AI results.** Store every AI-produced conversion in the database. The most-used ones are also cached.
4. **Fallback + re-check flow.** When the converter fails on an input, serve a previously stored result if one exists. **Every time** a known failing case recurs, re-run the converter first, because rules may have been fixed since.

## 4. Ground rules (accuracy first, no hallucination)

- **Never invent** file paths, functions, packages, config keys, env vars, table names, or API signatures. Verify by reading, grepping, or running before you rely on them.
- Back every finding with **evidence** (`file:line`, log excerpt, or command output). Mark anything unverified as **"UNVERIFIED"**.
- If client logs are not accessible from this environment (for example, they live in a browser, Sentry, or a remote server), **say so and ask me** how to obtain them. Do not fabricate log data.
- Re-read every file you changed and re-run the tests before you say something is done.
- Match the existing code style, folder structure, and dependencies. Add a new dependency only if there's a clear need, and justify it first.
- State your assumptions explicitly. Ask me **before** any destructive or irreversible action (dropping data, force-migrations, deleting files).

## 5. Engineering principles

- **DRY:** one shared conversion-pipeline function, one shared fingerprint/normalization utility, one cache abstraction, with no copy-pasted logic between client and server.
- **SOLID:** separate responsibilities into small units, for example `Converter`, `ErrorRecorder`, `ResultRepository`, `CacheStore`, and `AiConversionProvider`. Depend on interfaces so the AI provider and the cache backend are swappable.
- **ACID:** all writes go through transactions. Use unique constraints plus upserts and atomic counter increments (no read-modify-write races). Migrations must be reversible.
- Also apply KISS, YAGNI, fail-fast validation, and clear error types.

## 6. Workflow

Work in phases. **After Phase 1, stop and present a report and plan. Wait for my approval before Phase 2.**

### Phase 0 — Discovery (read-only) — ✅ Done
- Map the repo: the conversion code path (UI → converter → AI fallback → response), the current error handling and logging, the DB/ORM/migration setup, and any existing cache.
- Find where client-side errors are captured (console, error boundary, `window.onerror`, Sentry or another service, log files, or a backend endpoint).
- Summarize the architecture in ≤ 15 lines.

### Phase 1 — Error analysis and report — ✅ Done (report delivered in-session as taxonomy E1–E6; not committed as a file)
- Collect and analyze all available client-side error logs for conversion failures.
- Build an **error taxonomy**, ranked by frequency. For each category include: symptom, sample input (sanitized), frequency, root cause, and proposed fix.
- Look specifically for: unmapped legacy characters, wrong or ambiguous glyph mappings, conjunct/compound and ordering issues, Unicode normalization problems, encoding/copy-paste issues (BOM, zero-width characters, mixed legacy + Unicode text), and client/server mismatch.
- Present the report plus a **step-by-step implementation plan**. Then **stop for approval**.

### Phase 2 — Fix the root causes — ✅ Done (`abae9f8`, `8c52f44` E1, `3aba875` E2, `ff0188d` E3, `a2d961a` E4, `f0ac1cf` E5, `01a73be` E6, each with its regression test)
- Fix the converter for each confirmed root cause.
- Add a **regression test for each fixed error**, using the real failing input from the logs (sanitized).
- If some errors can't be fixed deterministically, list them as candidates for the AI fallback.

### Phase 3 — Error store (DB + local cache) — ✅ Done (`48f109d`…`6b6e33c`, close-out to `8e60e13`; see `docs/test-accounting.md`)
Design and implement, adapting to the existing ORM and conventions:

- **`conversion_errors` table (suggested shape, adapt as needed):**
  `id`, `fingerprint` (**unique**: hash of normalized input + source font + error type), `source_font`, `error_type`, `error_message`, `input_sample` (truncated and sanitized), `occurrence_count`, `first_seen_at`, `last_seen_at`, `converter_version`, `app_version`, `status` (`open | resolved | ignored`), plus minimal client context (browser family).
- Recording is an **atomic upsert**: on conflict, increment `occurrence_count` and update `last_seen_at`.
- **Client reporting must be non-blocking:** debounced/batched, sampled or rate-limited so an error flood can't hurt, and it must never break the conversion UX.
- **Local cache of the most frequent errors:** a bounded LRU with TTL, keyed by fingerprint and versioned by `converter_version`. Promote entries to the cache by hit count. Use IndexedDB or localStorage on the client, and an in-process cache or Redis on the server if Redis already exists.
- An admin/dev way to view top errors (a query, endpoint, or script) so we can keep fixing the biggest ones.

### Phase 4 — AI-result store (DB + cache) — ✅ Done (`4cf9a32` design, `f18f4b8`…`12134c6`; extends `aiResolutions`, see `docs/phase-4-resolution-store.md`)
- **`conversion_results` table (suggested shape):**
  `id`, `input_hash` (**unique**, together with `source_font` and `prompt_version`), `normalized_input`, `output_text`, `source` (`rule | ai | manual`), `ai_provider`, `ai_model`, `prompt_version`, `validation_status` (`unverified | verified | rejected`), `hit_count`, `last_used_at`, `created_at`.
- Cache the most-used results (hit-count promotion, LRU + TTL, versioned keys).
- **Validate AI output before storing or serving it:** valid Unicode in the target script, no leftover legacy characters, sane length ratio versus the input, and no added or dropped content. Store the result as `unverified` or `rejected` accordingly. Never present a rejected result as authoritative.
- **AI safety and cost:** treat user text strictly as data inside the prompt (delimited, with injection resistance), add timeouts, retries with backoff, in-flight de-duplication (concurrent identical requests share one AI call), and a rate limit or circuit breaker.

### Phase 5 — The conversion pipeline (fallback + re-check) — ✅ Done (`3c3d09a` design, `5419585`…`6b548d9`, wired dark by `debb7f5`; see `docs/phase-5-conversion-with-fallback.md` §7)
Implement one shared pipeline with this order and document it in a short diagram:

1. Normalize the input and compute the fingerprint/hash.
2. **Always run the converter first**, even for known failures. This is the re-check.
   - Success → return the result. If a matching error record exists, mark it `resolved` (or record the new `converter_version`) and prefer the converter output from now on.
   - Failure → record or increment the error (atomic upsert), then go to step 3.
3. Look up a stored result: local cache → server cache → DB. If found, serve it, increment `hit_count`, and flag it as a fallback result.
4. If nothing is stored, call the AI provider, validate the output, store it in the DB and cache, then serve it.
5. If everything fails, show a clear, user-friendly error (no raw stack traces) and keep the recorded error.

### Phase 6 — Privacy and security — ✅ Done in code (`398f6c7`, `719c15d`, `2cafe84`, `d6c3241`, `4c0f69a`, `f28fc32`, `e370f93`, `8d956b9`, `516493a`); console/approval steps open in `docs/pending-manual-steps.md`
- User text can be personal. Store only **minimal, truncated, sanitized** samples. Never log secrets, tokens, or full documents.
- Define a **retention/cleanup policy** for error samples and the results table.
- Validate and size-limit every input to the reporting endpoint. Prevent injection (parameterized queries only).
- Flag any consent or disclosure concern for storing user text.

### Phase 7 — Verification — 🔄 In progress (started 2026-10-04)
- Unit tests: converter fixes (one per root cause), fingerprinting/normalization, cache eviction and versioning, pipeline ordering.
- Integration tests: atomic upsert under concurrent writes, AI fallback with a mocked provider, re-check marking an error as resolved.
- Run the full test suite, linter, and type-check. Paste the actual output. Do not just claim they passed.

## 7. Acceptance criteria

- [ ] A written error report with a ranked taxonomy and evidence exists. — *Not in the repo: the Phase 1 report was given in-session; only its E1–E6 labels survive, in commit subjects.*
- [x] Each confirmed root cause is fixed and covered by a regression test. — E1–E6 commits above, each touching a test file.
- [x] Every conversion error is stored once per fingerprint with an accurate `occurrence_count`. — deterministic `patternId`, transactional `FieldValue.increment` (`lib/firebase/conversionFailures.ts`). Concurrent-write test: Phase 7.
- [ ] The most frequent errors and the most-used AI results are served from the cache, and the cache invalidates when `converter_version` or `prompt_version` changes. — *Partly.* Served from the cached known-patterns snapshot, keys carry engine version + rules hash (`lib/cache/keys.ts`). `promptVersion` is in the `aiResolutions` dedup key only; an accepted resolution deliberately survives a prompt bump and is re-validated before serving instead.
- [x] A failing input recurring triggers a converter re-check first, then falls back to the stored result or AI. — `runConversion` (engine first, store second). No live AI by design (pipeline doc §2.1). Shipped behind `NEXT_PUBLIC_ENABLE_FALLBACK_PIPELINE`, off.
- [x] Reporting failures never break or slow the conversion UX. — fire-and-forget `keepalive`, `reportBuffer` swallows sync and async flush failures (pinned by its tests).
- [ ] Migrations run up and down cleanly. All tests, lint, and type-check pass. — *Partly.* Tests/lint/tsc pass. No migration framework (Firestore); the two one-way scripts (`redactLegacyFailures.mjs`, `backfillRetention.mjs`) have never been run.
- [x] No new hardcoded secrets. No raw sensitive user text stored. — Guard A + `scripts/secretScan.mjs`; privacy bound `abae9f8`. Rows written before it still hold text until the redaction script is run.

## 8. Output format

At the end of each phase, give me:
1. **What changed** (files and a one-line reason each)
2. **Evidence** (test/command output)
3. **Assumptions and open questions**
4. **Risks / follow-ups**

