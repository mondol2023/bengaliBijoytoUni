import { describe, expect, it, vi } from "vitest";

// `word-extractor` never throws on genuinely garbled-but-parseable legacy
// .doc files — it returns mangled text instead (replacement characters,
// stray control codes). That's the path `unreliableRatio` in doc.ts exists
// to catch, but no real-world corrupted-input test can reach it: garbage
// bytes fail earlier, in the library's own format sniffing (see the
// "corrupted .doc" case in extract.test.ts, which hits `extraction_failed`,
// not this branch). Mocking the extractor is the only way to exercise it.
vi.mock("word-extractor", () => ({
  default: class {
    async extract() {
      return { getBody: () => "�����garbled text output" };
    }
  },
}));

describe("extractDocText — unreliable extraction", () => {
  it("rejects text with too high a ratio of replacement/control characters", async () => {
    const { extractDocText } = await import("../extract/doc");
    const result = await extractDocText(Buffer.from("irrelevant"), "legacy.doc");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("FILE_PROCESSING_ERROR");
      expect(result.error.details).toMatchObject({ reason: "unreliable_format", fileType: "doc" });
    }
  });
});
