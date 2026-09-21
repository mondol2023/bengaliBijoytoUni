# Privacy disclosure — proposed copy and placement

**Nothing here is shipped.** No component, route or string in the app was
changed by this document. It is a proposal for you to edit, cut or reject;
say which option you want and I will implement exactly that.

## 1. What there is to disclose

The facts below are read off the code, not assumed. Anything the copy says
has to match this table, and if a retention period changes
(`docs/data-retention.md`) the copy changes with it.

| Fact | Where it comes from |
| --- | --- |
| Conversion runs in the browser. Pasted text is never sent anywhere to be converted. | `features/converter/engine/pipeline.ts`, called from `hooks/useConversion.ts` |
| When a sequence cannot be mapped, a report is sent: the failed sequence, up to 80 characters of the original text either side of it, the encoding, engine version, rules hash and a session id. | `lib/conversionFailures/occurrence.ts` (`CONTEXT_WINDOW_CHARS = 80`) |
| The whole document and the whole converted output are **not** collected. | Same file, the privacy bound; enforced in one builder for both reporters |
| Reports are anonymous unless signed in, in which case the verified user id is attached. | `app/api/conversion-failures/route.ts` |
| Uploaded files are converted **on the server**, so their contents pass through it. | `app/api/documents/extract/route.ts` |
| For a **signed-in** user, the original file is uploaded to Firebase Storage at `users/{uid}/documents/{docId}/{filename}` and a metadata record is written, both kept indefinitely. | `lib/firebase/recordActivity.ts#recordDocumentUpload` |
| For an uploaded file, the **file name and type** are also stored on the failure report. | `app/api/documents/extract/route.ts` |
| Conversion and comparison history store counts, timings and similarity only — no text. | `conversionRecordSchema`, `comparisonRecordSchema` in `lib/firebase/schemas.ts` |
| Reports are used to fix the mapping tables, and may be sent to an external AI provider (Gemini/OpenAI) for a suggested fix — the short failed sequence only, reviewed by a human before anything changes. | `lib/ai/resolveConversionFailure.ts`, admin-gated |
| Records expire (proposed: occurrences 90 days, patterns 365) once the TTL policies are created. | `lib/conversionFailures/retention.ts`, `docs/data-retention.md` |

**One thing to decide before any copy ships.** A file name is user content —
`q3-layoffs-draft.docx` says something even if the text inside it never
leaves. It is stored today on every failure report from a document upload.
Three ways out, and I would like your call:

- **(a)** Disclose it ("the file's name and type"). Honest, costs nothing to
  implement, but it is the one line in the copy that reads badly.
- **(b) (recommended)** Stop storing it: send the extension only
  (`.docx`), which is all the diagnostics actually use, and drop the name.
  Then the copy has one less thing to say.
- **(c)** Hash it, so repeat failures from the same document are still
  groupable without the name being readable.

## 2. Placement

Three surfaces, in order of how much they matter.

### A. Inline, on the converter — **recommended, ship this one**

One line under the input, visible at the moment text is pasted, not behind a
link. This is the only placement that reaches someone before they paste
something they would not have pasted.

> Converted in your browser — the text you paste is not uploaded. If a
> character cannot be mapped, we send that short sequence and a little of the
> text around it so the mapping can be fixed. [What we collect](/privacy)

Placement: `components/converter/ConverterWorkspace.tsx`, directly below the
source textarea, at `text-sm text-foreground/70`. Not a dismissible banner
and not a modal — a modal makes a routine, narrow disclosure look like a
consent event, and a dismissible one is invisible to everyone who dismissed
it once.

Shorter variant, if that is too long for the layout:

> Converted in your browser. Unmappable sequences are reported so we can fix
> them. [What we collect](/privacy)

### B. On the documents page — **also recommended, and this one is not optional**

The upload path genuinely differs from the paste path, and the converter's
line would be false there. Signed-in uploads are not just processed on the
server: `recordDocumentUpload` saves **the original file** to Firebase
Storage and keeps it, so it can be listed in the user's document history.
There is no retention policy on that bucket and no delete control in the UI.
Whatever else is agreed, the upload surface has to say this.

> Uploaded files are converted on our server. When you're signed in, the file
> is saved to your document history so you can find it again — you can ask us
> to delete it at any time. [What we collect](/privacy)

Placement: `app/documents/page.tsx` / its uploader component, under the drop
zone. Conditional on option (b) above: if the file name keeps being stored on
failure reports, the privacy page has to say so too.

Two follow-ups this turns up, neither in scope here and neither started:

- **A delete control.** The copy above promises "you can ask us to delete
  it", which is the weakest honest phrasing while no button exists. A delete
  on the history row, removing the Storage object and the record, would let
  it read "you can delete it at any time".
- **Storage retention.** `docs/data-retention.md` covers the failure
  collections only. Uploaded files are the larger privacy exposure and have
  no expiry at all. Worth deciding in the same pass.

### C. A `/privacy` page — needed if A or B links to one

Neither inline line is complete on its own, and both end in a link that has
to go somewhere. Proposed as a short page, not a legal template: what runs
where, what a failure report contains, what it is used for, how long it is
kept, and how to ask for deletion. A draft of the whole page is a separate
piece of work — say the word and I will write it.

If you would rather not have a privacy page yet, drop the links and ship the
inline lines alone. They are true and self-contained; they are just not the
whole story.

### D. Footer link — optional

`components/layout/SiteFooter.tsx` deliberately reads as a colophon rather
than a sitemap, so a "Privacy" link there is a small change in what the
footer is for. Worth it only once the page in C exists.

## 3. What the copy deliberately does not do

- **No cookie banner.** Nothing here sets a tracking cookie. The app sets
  exactly one cookie: the httpOnly sign-in session cookie
  (`app/api/auth/session/route.ts`, set by `components/auth/AuthProvider.tsx`
  when a user signs in), which is strictly functional.
- **No consent checkbox.** A checkbox implies the reporting is optional. If
  you want it to be optional, that is a different piece of work (an opt-out
  and a way to honor it) and the copy would change to match — tell me and I
  will propose that instead.
- **No "we take your privacy seriously".** The specific sentence — text is
  not uploaded, 80 characters around a failure is — does the work that
  sentence pretends to.

## 4. What I need from you

1. Which placements: A, B, C, D, or a subset. B is the one I would not skip.
2. The file-name question: (a), (b) or (c).
3. Whether to scope in a delete control and a retention rule for uploaded
   files, which the upload copy depends on.
4. Any edits to the wording. The retention numbers in `docs/data-retention.md`
   and this copy have to agree, so pick those at the same time.

Then I will implement exactly the approved text in the approved places, in
one commit.
