# Golden corpus

Real legacy documents and the Unicode they must convert to. Empty until real
samples are added; the runner
(`features/converter/__tests__/goldenCorpus.test.ts`) skips cleanly and says
so rather than passing silently.

## Adding a document

Two files per document, same stem:

```
<name>.<encodingId>.legacy.txt      the legacy bytes, exactly as extracted
<name>.<encodingId>.expected.txt    the Unicode it must produce
```

`<encodingId>` is a registered encoding: `bijoy`, `sutonny`, `alphaAnsi`.
For example:

```
annual-report-p3.bijoy.legacy.txt
annual-report-p3.bijoy.expected.txt
```

A `.legacy.txt` with no matching `.expected.txt` fails the suite rather than
being skipped — a document dropped in and forgotten would otherwise look like
a passing corpus.

## What each case asserts

1. The conversion succeeds.
2. **Zero unmapped sequences.** A real document that still produces one is a
   missing mapping-table rule, which is the whole reason for this corpus.
3. **Exact output.** Only a BOM, CRLF line endings and a single trailing
   newline are normalized away — things a text editor changes without anyone
   meaning to. Nothing else is trimmed: a comparison that ignored whitespace
   could not catch a reorder bug that moves a ZWJ.

## Getting the two files right

The legacy side must be the bytes as extracted, not as retyped. Opening a
Bijoy document and copying from the rendered view gives you whatever the font
displayed, which is not the same thing.

The expected side must come from a source independent of this converter —
typed by someone who reads Bengali, or taken from a publisher's own Unicode
edition of the same text. Generating it by running this engine and eyeballing
the result produces a corpus that asserts the engine still does what it does
today, including the parts that are wrong.

Both files are UTF-8. The expected file should already be NFC-normalized; the
engine normalizes its output, so a decomposed expected file will differ from a
correct conversion.

## Size

Keep each document to a page or so. The corpus is for correctness, not
throughput, and a failure in a 40-line file is diagnosable in a way that a
failure in a 40-page file is not. Several small documents beat one large one.
