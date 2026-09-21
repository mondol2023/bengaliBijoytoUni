# Privacy disclosure — what shipped, and what still needs your sign-off

**Status: implemented, wording not approved.** The copy is live on all four
surfaces so it can be read in place rather than in a document. **The wording
is a draft.** Edit `lib/privacy/disclosure.ts`; nothing else holds a string.

The previous revision of this file was a proposal with three open questions.
All three were answered — all four placements, file names dropped rather than
disclosed, delete control in scope — so what follows is the record of what
those answers produced.

## 1. Where it is

| Surface | File | Notes |
| --- | --- | --- |
| Converter, under the input box | `components/converter/ConverterWorkspace.tsx` | Under the *input*, not the output: the only moment the line can change what someone pastes is before they paste it. |
| Documents, under the drop zone | `components/documents/DocumentUploadWorkspace.tsx` | Its own text. The converter's line ("not uploaded") is false on this page. |
| `/privacy` | `app/privacy/page.tsx` | Static server component; both inline lines link here. |
| Footer | `components/layout/SiteFooter.tsx` | One entry, added to the existing colophon. |

All four render from `lib/privacy/disclosure.ts`, in English and Bengali.
`components/privacy/PrivacyNote.tsx` is the shared inline line.

## 2. Both languages, shown together

There is no locale mechanism in this app and adding one for four strings
would be the larger change. The audience for a legacy-Bengali converter is
not reliably reached by either language alone, so both are rendered, English
first. Each Bengali block is its own `lang="bn"` element with `font-bengali`,
per the rule in `CLAUDE.md`: a screen reader switches voice for the Bengali
and not for the English beside it.

**The Bengali has not been read by a native speaker.** It is written to say
exactly what the English says, but register and phrasing are worth a pass by
someone who will actually read it. This is the item I would most like
reviewed.

## 3. What the copy claims, and what makes each claim true

`lib/privacy/disclosure.ts` carries the file reference above every block, and
`lib/privacy/__tests__/disclosure.test.ts` asserts the numbers against their
sources — `CONTEXT_WINDOW_DISCLOSED` against `CONTEXT_WINDOW_CHARS`, the two
retention periods against `RETENTION_DAYS`, and that both languages quote
them. Changing a constant now fails a test instead of silently making the
copy false.

Two claims the copy makes that only became true during this phase:

- **"the file type — `.docx` — and not the file name."** True as of
  `lib/privacy/fileName.ts`. Rows written before that still hold whole names
  until `scripts/redactLegacyFailures.mjs` is run.
- **"you can delete it at any time from your account."** True as of
  `DELETE /api/documents/[documentId]` and the control on `/account`. The
  earlier draft said "you can ask us to delete it", which was the weakest
  honest phrasing while no button existed. A test asserts the strong wording
  so that removing the route is noticed here.

## 4. Preconditions before this is merged

1. **Read the wording**, English and Bengali, and edit
   `lib/privacy/disclosure.ts`. It is one file and nothing duplicates it.
2. **Create the TTL policies** (`docs/data-retention.md` §3). The copy says
   reports "are set to expire" after 90 days, which is precisely true of the
   `expireAt` field and would be misleading if read as "are deleted" while no
   policy exists. Doing the console step removes the distinction.
3. **Run the two scripts**, redaction first, then the retention backfill
   (`docs/data-retention.md` §5). Until then the copy describes new rows
   accurately and old rows optimistically.

## 5. Deliberately still absent

- **No cookie banner.** Nothing here sets a tracking cookie; the app sets one
  cookie, the httpOnly sign-in session (`app/api/auth/session/route.ts`).
- **No consent checkbox.** A checkbox implies the reporting is optional. If
  it should be, that is an opt-out plus a way to honour it, and the copy
  would change to match — say so and I will propose it.
- **No "we take your privacy seriously".** The specific sentence — text is
  not uploaded, 80 characters around a failure is — does the work that
  sentence pretends to.
- **No bucket lifecycle rule** for uploaded files. Declined for now; see
  `docs/data-retention.md` §6.
