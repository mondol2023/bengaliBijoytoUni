/**
 * Regression, matching `lib/conversionFailures/__tests__/occurrenceFileName.test.ts`
 * for the other collection: `errorLogs` rows are written from an upload too
 * (`captureServerIssue` on `/api/documents/extract`, and the browser via
 * `/api/error-logs`), and used to carry the file's name verbatim. Both reach
 * Firestore through `writeErrorLog`, so the reduction is asserted there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../admin", () => ({ getAdminDb: vi.fn() }));

import { getAdminDb } from "../admin";
import { writeErrorLog } from "../errorLog";

const written: Record<string, unknown>[] = [];

function createMockDb() {
  return {
    collection: () => ({
      doc: () => ({
        id: "log-1",
        set: async (data: Record<string, unknown>) => {
          written.push(data);
        },
      }),
    }),
  };
}

const input = {
  userId: null,
  source: "file" as const,
  kind: "unmapped_character" as const,
  severity: "warning" as const,
  code: "UNMAPPED_CHARACTER",
  message: "2 sequences had no mapping rule.",
  encodingId: "bijoy",
  fileName: "q3-layoffs-draft.docx",
  fileType: "docx",
  samples: ["Av"],
  route: "api/documents/extract",
};

describe("writeErrorLog and the uploaded file's name", () => {
  beforeEach(() => {
    written.length = 0;
    vi.mocked(getAdminDb).mockReturnValue(
      createMockDb() as unknown as ReturnType<typeof getAdminDb>,
    );
  });

  it("stores the extension, not the name", async () => {
    await writeErrorLog(input);

    expect(written).toHaveLength(1);
    expect(written[0].fileName).toBe(".docx");
    expect(JSON.stringify(written[0])).not.toContain("q3-layoffs-draft");
  });

  it("stores null when there is no file", async () => {
    await writeErrorLog({ ...input, source: "text", fileName: null, fileType: null });

    expect(written[0].fileName).toBeNull();
  });
});
