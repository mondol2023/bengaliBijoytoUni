/**
 * The two stores cannot be deleted transactionally, so what is tested here is
 * the behaviour under a partial failure: which half goes first, what survives
 * when the other half fails, and that the outcome is always retryable.
 *
 * The case that matters most is the one that must never happen — a deleted
 * record leaving an undeletable file in the bucket — so it gets its own
 * assertion rather than being implied by the happy path.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin", () => ({ getAdminDb: vi.fn(), getAdminStorage: vi.fn() }));

import { getAdminDb, getAdminStorage } from "../admin";
import { deleteDocumentUpload } from "../deleteDocumentUpload";

const OWNER = "user-1";
const DOC_ID = "doc-1";
const STORAGE_PATH = `users/${OWNER}/documents/${DOC_ID}/q3-layoffs-draft.docx`;

const record = {
  userId: OWNER,
  storagePath: STORAGE_PATH,
  fileName: "q3-layoffs-draft.docx",
  fileType: "docx" as const,
  sizeBytes: 2048,
  extractionStatus: "success" as const,
  createdAt: "2026-09-01T00:00:00.000Z",
};

interface Scenario {
  data?: Record<string, unknown> | undefined;
  getThrows?: Error;
  storageThrows?: Error;
  recordDeleteThrows?: Error;
}

/** Records the order the two deletes were attempted in, which is the design. */
let calls: string[];
let deleteOptions: unknown;

function setup(scenario: Scenario = {}) {
  calls = [];
  deleteOptions = undefined;
  const data = "data" in scenario ? scenario.data : record;

  vi.mocked(getAdminDb).mockReturnValue({
    collection: () => ({
      doc: () => ({
        async get() {
          if (scenario.getThrows) throw scenario.getThrows;
          return { exists: data !== undefined, data: () => data };
        },
        async delete() {
          calls.push("firestore");
          if (scenario.recordDeleteThrows) throw scenario.recordDeleteThrows;
        },
      }),
    }),
  } as unknown as ReturnType<typeof getAdminDb>);

  vi.mocked(getAdminStorage).mockReturnValue({
    bucket: () => ({
      file: (path: string) => ({
        async delete(options: unknown) {
          calls.push(`storage:${path}`);
          deleteOptions = options;
          if (scenario.storageThrows) throw scenario.storageThrows;
        },
      }),
    }),
  } as unknown as ReturnType<typeof getAdminStorage>);
}

describe("deleteDocumentUpload", () => {
  beforeEach(() => setup());

  it("deletes the file and then the record", async () => {
    const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.storagePath).toBe(STORAGE_PATH);
    expect(calls).toStrictEqual([`storage:${STORAGE_PATH}`, "firestore"]);
  });

  it("tolerates a file that is already gone, so a retry succeeds", async () => {
    await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

    expect(deleteOptions).toStrictEqual({ ignoreNotFound: true });
  });

  describe("partial failure", () => {
    it("leaves both halves in place when the file cannot be deleted", async () => {
      setup({ storageThrows: new Error("storage unreachable") });

      const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("STORAGE_ERROR");
        expect(result.error.message).toContain("nothing was removed");
      }
      // The assertion the ordering exists for: the record must still be there,
      // or the user would be left with a file they can no longer see or delete.
      expect(calls).toStrictEqual([`storage:${STORAGE_PATH}`]);
    });

    it("reports the file as gone but the record as remaining, when the record delete fails", async () => {
      setup({ recordDeleteThrows: new Error("firestore unavailable") });

      const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("DATABASE_ERROR");
        // Says both halves, because only one of them happened.
        expect(result.error.message).toContain("The file was deleted");
        expect(result.error.message).toContain("could not be removed");
      }
      expect(calls).toStrictEqual([`storage:${STORAGE_PATH}`, "firestore"]);
    });

    it("keeps the internal cause out of the user-facing message", async () => {
      setup({ storageThrows: new Error("bucket convert2uni-prod.appspot.com: 403") });

      const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).not.toContain("convert2uni-prod");
        expect(result.error.debug).toBeInstanceOf(Error);
      }
    });
  });

  describe("ownership", () => {
    it("refuses another user's document without touching either half", async () => {
      setup({ data: { ...record, userId: "somebody-else" } });

      const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("NOT_FOUND_ERROR");
      expect(calls).toStrictEqual([]);
    });

    it("answers a missing document exactly as it answers someone else's", async () => {
      setup({ data: undefined });
      const missing = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      setup({ data: { ...record, userId: "somebody-else" } });
      const notMine = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

      expect(missing.ok).toBe(false);
      expect(notMine.ok).toBe(false);
      if (!missing.ok && !notMine.ok) {
        // Differing answers would enumerate which document ids exist.
        expect(missing.error.code).toBe(notMine.error.code);
        expect(missing.error.message).toBe(notMine.error.message);
      }
    });
  });

  it("refuses a record that does not match the schema rather than guessing a path", async () => {
    setup({ data: { userId: OWNER, storagePath: "" } });

    const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
    expect(calls).toStrictEqual([]);
  });

  it("returns a typed error when the lookup itself fails", async () => {
    setup({ getThrows: new Error("firestore unavailable") });

    const result = await deleteDocumentUpload({ userId: OWNER, documentId: DOC_ID });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_ERROR");
    expect(calls).toStrictEqual([]);
  });
});
