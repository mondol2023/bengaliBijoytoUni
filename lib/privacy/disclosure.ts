/**
 * Every word of the privacy disclosure, English and Bengali, in one file.
 *
 * ## This copy is a draft awaiting review
 *
 * It is wired into all four surfaces so it can be read in place rather than
 * in a document, but the wording has not been approved and the Bengali has
 * not been read by a native speaker. Edit here; nothing below duplicates a
 * string.
 *
 * ## Two rules this file exists to enforce
 *
 * **It must match the code.** Each block carries the file that makes its
 * claim true. If one of those changes, this changes in the same commit — a
 * disclosure that drifted from the behaviour is worse than none, because it
 * is now a false statement rather than a missing one.
 *
 * **English and Bengali must say the same thing.** They are shown together,
 * not switched between, so a reader who reads both must not find two
 * different promises. The Bengali is a translation of the English, not a
 * looser paraphrase of it.
 *
 * ## Preconditions — check these before shipping the copy
 *
 * 1. **Retention.** `RETENTION` below states 90 and 365 days, matching
 *    `lib/conversionFailures/retention.ts`. Firestore deletes nothing until
 *    a TTL policy naming `expireAt` is created per collection from the
 *    console (`docs/data-retention.md` §3). Until that is done the periods
 *    are what new documents are *stamped* with, not what has happened, and
 *    the wording is written to be true either way — but do the console step.
 * 2. **Legacy rows.** Documents written before the `expireAt` field existed
 *    carry none and will never expire. `scripts/backfillRetention.mjs` fixes
 *    that and has not been run.
 * 3. **File names.** The copy says an upload's *type* is recorded, not its
 *    name, which became true in `lib/privacy/fileName.ts`. Old rows still
 *    hold names until `scripts/redactLegacyFailures.mjs` has been run.
 */

/** Characters of surrounding text a failure report carries either side of the failed sequence. */
export const CONTEXT_WINDOW_DISCLOSED = 80;

export const RETENTION = {
  /** `RETENTION_DAYS.conversionFailures` in `lib/conversionFailures/retention.ts`. */
  occurrenceDays: 90,
  /** `RETENTION_DAYS.failurePatterns`, on a sliding window. */
  patternDays: 365,
} as const;

/** The route the inline lines link to, and the footer entry. */
export const PRIVACY_HREF = "/privacy";

export interface Bilingual {
  en: string;
  bn: string;
}

export interface DisclosureSection {
  heading: Bilingual;
  body: Bilingual[];
}

/** Short label on the link at the end of each inline line, and in the footer. */
export const PRIVACY_LINK_LABEL: Bilingual = {
  en: "What we collect",
  bn: "আমরা কী সংগ্রহ করি",
};

export const FOOTER_LINK_LABEL: Bilingual = {
  en: "Privacy",
  bn: "গোপনীয়তা",
};

/**
 * Placement A — under the converter's input box, where someone can read it
 * before pasting rather than after.
 *
 * True because `features/converter/engine/pipeline.ts` is called from
 * `hooks/useConversion.ts` in the browser, and the only thing that leaves is
 * built by `lib/conversionFailures/occurrence.ts`.
 */
export const CONVERTER_NOTE: Bilingual = {
  en:
    "Converted in your browser — the text you paste is not uploaded. If a sequence cannot be " +
    `mapped, we send just that sequence and up to ${CONTEXT_WINDOW_DISCLOSED} characters either ` +
    "side of it, so the mapping can be fixed.",
  bn:
    "রূপান্তর আপনার ব্রাউজারেই হয় — আপনার পেস্ট করা লেখা কোথাও আপলোড করা হয় না। কোনো অংশ " +
    `রূপান্তর করা না গেলে শুধু সেই অংশটুকু আর তার দুই পাশের সর্বোচ্চ ${CONTEXT_WINDOW_DISCLOSED}টি ` +
    "অক্ষর আমাদের কাছে পাঠানো হয়, যাতে ম্যাপিংটি ঠিক করা যায়।",
};

/**
 * Placement B — under the document uploader. The converter's line would be
 * false here, which is why this one is not optional.
 *
 * "you can delete it at any time" became true with
 * `app/api/documents/[documentId]/route.ts` and the control on `/account`.
 * If that control is ever removed, this sentence has to go back to "you can
 * ask us to delete it".
 */
export const DOCUMENTS_NOTE: Bilingual = {
  en:
    "Uploaded files are converted on our server, so their contents pass through it. When you are " +
    "signed in, the file is saved to your document history — you can delete it at any time from " +
    "your account.",
  bn:
    "আপলোড করা ফাইল আমাদের সার্ভারে রূপান্তরিত হয়, তাই ফাইলের বিষয়বস্তু সার্ভারের মধ্য দিয়ে যায়। " +
    "আপনি সাইন ইন করা থাকলে ফাইলটি আপনার ডকুমেন্ট ইতিহাসে সংরক্ষিত হয় — আপনি যেকোনো সময় " +
    "আপনার অ্যাকাউন্ট থেকে সেটি মুছে ফেলতে পারেন।",
};

/** Placement C — the `/privacy` page both inline lines link to. */
export const PRIVACY_PAGE_TITLE: Bilingual = {
  en: "What we collect",
  bn: "আমরা কী সংগ্রহ করি",
};

export const PRIVACY_PAGE_INTRO: Bilingual = {
  en:
    "This page describes what this app actually does, not what a policy template says. It is " +
    "short because there is not much to describe.",
  bn:
    "এই পাতায় এই অ্যাপ বাস্তবে যা করে তা-ই লেখা আছে — কোনো নমুনা নীতিমালার ভাষা নয়। বলার মতো " +
    "বেশি কিছু নেই বলেই এটি সংক্ষিপ্ত।",
};

export const PRIVACY_PAGE_SECTIONS: DisclosureSection[] = [
  {
    // `features/converter/engine/pipeline.ts`, `app/api/documents/extract/route.ts`.
    heading: { en: "Where conversion happens", bn: "রূপান্তর কোথায় হয়" },
    body: [
      {
        en:
          "Text you paste or type into the converter is converted in your browser. It is not sent " +
          "to us, and it is not stored anywhere.",
        bn:
          "আপনি কনভার্টারে যে লেখা পেস্ট করেন বা টাইপ করেন, তা আপনার ব্রাউজারেই রূপান্তরিত হয়। " +
          "সেটি আমাদের কাছে পাঠানো হয় না এবং কোথাও সংরক্ষণ করা হয় না।",
      },
      {
        en:
          "A file you upload is different: it is read and converted on our server, so its contents " +
          "pass through it.",
        bn:
          "আপনি যে ফাইল আপলোড করেন সেটি আলাদা: সেটি আমাদের সার্ভারে পড়া ও রূপান্তর করা হয়, তাই " +
          "ফাইলের বিষয়বস্তু সার্ভারের মধ্য দিয়ে যায়।",
      },
    ],
  },
  {
    // `lib/conversionFailures/occurrence.ts`, `app/api/conversion-failures/route.ts`.
    heading: { en: "When a sequence cannot be converted", bn: "যখন কোনো অংশ রূপান্তর করা যায় না" },
    body: [
      {
        en:
          "Legacy Bengali encodings are not fully documented, so the mapping tables are still " +
          "incomplete. When the converter meets a sequence it has no rule for, it reports that " +
          "sequence so the rule can be added.",
        bn:
          "পুরোনো বাংলা এনকোডিংগুলোর পূর্ণ দলিল নেই, তাই ম্যাপিং টেবিলগুলো এখনও অসম্পূর্ণ। " +
          "কনভার্টার যখন এমন কোনো অংশ পায় যার জন্য কোনো নিয়ম নেই, তখন সেই অংশটি রিপোর্ট করা হয় " +
          "যাতে নিয়মটি যোগ করা যায়।",
      },
      {
        en:
          `A report contains the failed sequence, up to ${CONTEXT_WINDOW_DISCLOSED} characters of ` +
          "your original text either side of it, which encoding was in use, the converter's version, " +
          "and a random id for the browser session. For an upload it also records the file type — " +
          "“.docx” — and not the file name.",
        bn:
          `একটি রিপোর্টে থাকে: ব্যর্থ হওয়া অংশটি, তার দুই পাশে আপনার মূল লেখার সর্বোচ্চ ` +
          `${CONTEXT_WINDOW_DISCLOSED}টি অক্ষর, কোন এনকোডিং ব্যবহার হয়েছে, কনভার্টারের সংস্করণ, ` +
          "এবং ব্রাউজার সেশনের একটি এলোমেলো আইডি। আপলোডের ক্ষেত্রে ফাইলের ধরনও রাখা হয় — " +
          "“.docx” — ফাইলের নাম নয়।",
      },
      {
        en:
          "If you are signed in, your account id is attached to the report. If you are not, the " +
          "report is anonymous.",
        bn:
          "আপনি সাইন ইন করা থাকলে রিপোর্টের সঙ্গে আপনার অ্যাকাউন্ট আইডি যুক্ত থাকে। সাইন ইন করা " +
          "না থাকলে রিপোর্টটি নামহীন।",
      },
    ],
  },
  {
    // The privacy bound in `lib/conversionFailures/occurrence.ts`, plus
    // `conversionRecordSchema`/`comparisonRecordSchema` in `lib/firebase/schemas.ts`.
    heading: { en: "What a report never contains", bn: "রিপোর্টে যা কখনো থাকে না" },
    body: [
      {
        en:
          "Not the whole of what you pasted, not the whole of the converted result, and not the " +
          "name of an uploaded file.",
        bn:
          "আপনার পেস্ট করা পুরো লেখা নয়, রূপান্তরিত পুরো ফলাফল নয়, এবং আপলোড করা ফাইলের নামও নয়।",
      },
      {
        en:
          "Saved conversion and comparison history records counts, timings and a similarity score. " +
          "It records none of the text.",
        bn:
          "সংরক্ষিত রূপান্তর ও তুলনার ইতিহাসে কেবল সংখ্যা, সময় ও মিলের হার থাকে। কোনো লেখা রাখা " +
          "হয় না।",
      },
    ],
  },
  {
    // `lib/firebase/recordActivity.ts#recordDocumentUpload`,
    // `lib/firebase/deleteDocumentUpload.ts`.
    heading: { en: "Files you upload", bn: "আপনার আপলোড করা ফাইল" },
    body: [
      {
        en:
          "If you upload a file while signed in, the original file is saved to your document " +
          "history so you can find it again. Nobody else can read it.",
        bn:
          "সাইন ইন করা অবস্থায় কোনো ফাইল আপলোড করলে মূল ফাইলটি আপনার ডকুমেন্ট ইতিহাসে সংরক্ষিত " +
          "হয়, যাতে আপনি পরে সেটি আবার খুঁজে পান। অন্য কেউ সেটি পড়তে পারে না।",
      },
      {
        en:
          "You can delete it from your account at any time. Deleting removes both the stored file " +
          "and its entry in your history.",
        bn:
          "আপনি যেকোনো সময় আপনার অ্যাকাউন্ট থেকে সেটি মুছে ফেলতে পারেন। মুছে ফেললে সংরক্ষিত " +
          "ফাইল এবং ইতিহাসের এন্ট্রি — দুটোই চলে যায়।",
      },
      {
        en: "If you are not signed in, the uploaded file is converted and then discarded.",
        bn: "আপনি সাইন ইন করা না থাকলে আপলোড করা ফাইলটি রূপান্তরের পর বাতিল করা হয়।",
      },
    ],
  },
  {
    // `lib/conversionFailures/retention.ts`, `docs/data-retention.md`.
    heading: { en: "How long reports are kept", bn: "রিপোর্ট কতদিন রাখা হয়" },
    body: [
      {
        en:
          `An individual report is set to expire ${RETENTION.occurrenceDays} days after it is ` +
          "made. That is the part that holds your text.",
        bn:
          `একটি আলাদা রিপোর্ট তৈরির ${RETENTION.occurrenceDays} দিন পর মুছে যাওয়ার জন্য নির্ধারিত ` +
          "থাকে। আপনার লেখা এই অংশেই থাকে।",
      },
      {
        en:
          "The summary of a repeated failure — the sequence itself and how often it has been seen, " +
          `with none of the surrounding text — is kept for ${RETENTION.patternDays} days after the ` +
          "last time it happened.",
        bn:
          "বারবার ঘটা কোনো ব্যর্থতার সারসংক্ষেপ — অর্থাৎ অংশটি ও কতবার দেখা গেছে, আশপাশের কোনো " +
          `লেখা ছাড়া — শেষবার ঘটার পর ${RETENTION.patternDays} দিন পর্যন্ত রাখা হয়।`,
      },
    ],
  },
  {
    // `lib/ai/resolveConversionFailure.ts`, admin-gated; `lib/ai/enabled.ts`.
    heading: { en: "Where AI is, and is not, used", bn: "এআই কোথায় ব্যবহার হয়, কোথায় হয় না" },
    body: [
      {
        en:
          "Your conversion never involves an AI service. The converter is a set of mapping rules, " +
          "and it runs in your browser.",
        bn:
          "আপনার রূপান্তরে কখনো কোনো এআই সেবা যুক্ত হয় না। কনভার্টার হলো ম্যাপিং নিয়মের একটি সেট, " +
          "এবং তা আপনার ব্রাউজারেই চলে।",
      },
      {
        en:
          "Separately, when we work through the reported failures, one of us may ask an external AI " +
          "provider what a short failed sequence should map to. Only that sequence is sent — never " +
          "your surrounding text, your file, or anything identifying you — and a person reviews the " +
          "answer before any rule changes.",
        bn:
          "এর বাইরে, রিপোর্ট করা ব্যর্থতাগুলো নিয়ে কাজ করার সময় আমাদের কেউ কোনো বাইরের এআই " +
          "সেবাকে জিজ্ঞাসা করতে পারেন যে একটি ছোট ব্যর্থ অংশ কীসে রূপান্তরিত হওয়া উচিত। কেবল " +
          "সেই অংশটুকুই পাঠানো হয় — আপনার আশপাশের লেখা, আপনার ফাইল বা আপনাকে শনাক্ত করার মতো " +
          "কিছুই নয় — এবং কোনো নিয়ম বদলানোর আগে একজন মানুষ উত্তরটি যাচাই করেন।",
      },
    ],
  },
  {
    // `app/api/auth/session/route.ts`, `components/auth/AuthProvider.tsx`.
    heading: { en: "Cookies and tracking", bn: "কুকি ও ট্র্যাকিং" },
    body: [
      {
        en:
          "There is no analytics, no advertising and no tracking cookie. The app sets one cookie, " +
          "and only when you sign in: the one that keeps you signed in.",
        bn:
          "এখানে কোনো অ্যানালিটিক্স নেই, কোনো বিজ্ঞাপন নেই, কোনো ট্র্যাকিং কুকি নেই। অ্যাপটি " +
          "কেবল একটি কুকি ব্যবহার করে, তা-ও শুধু আপনি সাইন ইন করলে: যেটি আপনাকে সাইন ইন অবস্থায় " +
          "রাখে।",
      },
    ],
  },
];
