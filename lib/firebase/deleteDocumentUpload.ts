/**
 * Deletes one uploaded document: the file in Storage and the metadata record
 * in Firestore, which are the two halves of what `recordDocumentUpload`
 * created.
 *
 * ## There is no transaction across the two stores
 *
 * Firestore transactions do not cover Cloud Storage, so one of the two
 * deletes can succeed while the other fails and no amount of care makes that
 * impossible. What is available is a choice of *which* inconsistent state a
 * partial failure leaves behind, and that choice is the whole design here.
 *
 * **Storage first, Firestore second.**
 *
 * - *Storage fails.* Nothing else is attempted. Both halves still exist, the
 *   row is still in the user's history, and the delete can simply be
 *   retried. No state was lost and nothing is hidden.
 * - *Firestore fails after Storage succeeded.* The file — the sensitive half,
 *   and the one the user actually asked to be rid of — is gone. What remains
 *   is a row pointing at nothing. The user is told exactly that, and a retry
 *   fixes it because the Storage delete passes `ignoreNotFound`.
 *
 * The other order inverts both cases: a Firestore success followed by a
 * Storage failure would leave the user's file in the bucket with no record
 * of it, invisible in the UI and no longer deletable by the person who
 * uploaded it. That is the one outcome worth engineering against, so this
 * function cannot produce it.
 *
 * ## What is deliberately not touched
 *
 * `usage/{uid}` counters are lifetime totals of activity ("you have
 * converted 40 documents"), not an inventory of retained files. Deleting a
 * file does not un-convert it, and decrementing would make the counter mean
 * two things at once.
 */
import { getAdminDb, getAdminStorage } from "./admin";
import { documentRecordSchema, type DocumentRecord } from "./schemas";
import { AppErrors, err, ok, type Result } from "@/lib/errors/types";

export interface DeleteDocumentUploadInput {
  /** From the verified token — never from the request body. */
  userId: string;
  documentId: string;
}

export interface DeletedDocument {
  documentId: string;
  /** Returned so the caller can log what went, without re-reading the record. */
  storagePath: string;
}

/**
 * `notFound` is returned both when the record is missing and when it belongs
 * to somebody else. Distinguishing them would tell an attacker which
 * document ids exist, and the honest answer for this caller is the same
 * either way: there is no such document of yours.
 */
export async function deleteDocumentUpload(
  input: DeleteDocumentUploadInput,
): Promise<Result<DeletedDocument>> {
  const ref = getAdminDb().collection("documents").doc(input.documentId);

  let record: DocumentRecord;
  try {
    const snapshot = await ref.get();
    if (!snapshot.exists) return err(AppErrors.notFound("That document is not in your history."));

    const parsed = documentRecordSchema.safeParse(snapshot.data());
    if (!parsed.success) {
      return err(
        AppErrors.database("That history entry could not be read.", {
          debug: parsed.error.issues,
        }),
      );
    }
    record = parsed.data;
  } catch (cause) {
    return err(AppErrors.database("Could not look up that document.", { debug: cause }));
  }

  if (record.userId !== input.userId) {
    return err(AppErrors.notFound("That document is not in your history."));
  }

  // Step 1: the file. `ignoreNotFound` makes this idempotent, which is what
  // lets a user retry after the partial failure below.
  try {
    await getAdminStorage().bucket().file(record.storagePath).delete({ ignoreNotFound: true });
  } catch (cause) {
    return err(
      AppErrors.storage("Could not delete the stored file, so nothing was removed. Try again.", {
        debug: cause,
      }),
    );
  }

  // Step 2: the record. Reached only once the file is gone.
  try {
    await ref.delete();
  } catch (cause) {
    return err(
      AppErrors.database(
        "The file was deleted, but its history entry could not be removed. Try again to clear it.",
        { debug: cause },
      ),
    );
  }

  return ok({ documentId: input.documentId, storagePath: record.storagePath });
}
