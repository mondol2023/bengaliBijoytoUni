/**
 * Server-only writer + reader for the `feedback` collection — the reviews
 * and complaints submitted from the form under each workspace.
 *
 * Unlike the activity collections, a failed write here *is* surfaced to the
 * caller: the user deliberately pressed "Send", so silently dropping their
 * complaint would be the one outcome worse than showing an error. Call sites
 * let it propagate to their normal `fail()` handling.
 */
import { getAdminDb } from "./admin";
import { feedbackSchema, type Feedback } from "./schemas";
import { FEEDBACK_LIMITS } from "@/lib/feedback/limits";

const COLLECTION = "feedback";

// Re-exported so server-side call sites (the routes) keep importing their
// limits from the same module as the writer that enforces them. Client code
// must import from `@/lib/feedback/limits` directly — this module pulls in
// firebase-admin.
export { FEEDBACK_LIMITS };

export type FeedbackInput = Omit<Feedback, "createdAt" | "updatedAt" | "status" | "adminNote">;

export async function writeFeedback(input: FeedbackInput): Promise<string> {
  const now = new Date().toISOString();
  const record: Feedback = {
    ...input,
    message: input.message.slice(0, FEEDBACK_LIMITS.maxMessageLength),
    sampleInput: input.sampleInput?.slice(0, FEEDBACK_LIMITS.maxSampleLength) ?? null,
    sampleOutput: input.sampleOutput?.slice(0, FEEDBACK_LIMITS.maxSampleLength) ?? null,
    status: "new",
    adminNote: null,
    createdAt: now,
    updatedAt: now,
  };
  const validated = feedbackSchema.parse(record);
  const ref = getAdminDb().collection(COLLECTION).doc();
  await ref.set(validated);
  return ref.id;
}

export type WithId<T> = T & { id: string };

export interface ListFeedbackOptions {
  limit: number;
  status?: Feedback["status"];
}

export async function listFeedback(options: ListFeedbackOptions): Promise<WithId<Feedback>[]> {
  let query = getAdminDb().collection(COLLECTION) as FirebaseFirestore.Query;
  if (options.status) query = query.where("status", "==", options.status);

  const snapshot = await query.orderBy("createdAt", "desc").limit(options.limit).get();
  return snapshot.docs.flatMap((doc) => {
    const parsed = feedbackSchema.safeParse(doc.data());
    return parsed.success ? [{ id: doc.id, ...parsed.data }] : [];
  });
}

export interface UpdateFeedbackInput {
  id: string;
  status?: Feedback["status"];
  adminNote?: string | null;
}

/** Triage update from `/api/admin/feedback`. Returns the updated row, or null if it's gone. */
export async function updateFeedback(input: UpdateFeedbackInput): Promise<WithId<Feedback> | null> {
  const ref = getAdminDb().collection(COLLECTION).doc(input.id);
  const snapshot = await ref.get();
  if (!snapshot.exists) return null;

  const existing = feedbackSchema.safeParse(snapshot.data());
  if (!existing.success) return null;

  const next: Feedback = {
    ...existing.data,
    status: input.status ?? existing.data.status,
    adminNote:
      input.adminNote === undefined
        ? existing.data.adminNote
        : input.adminNote === null
          ? null
          : input.adminNote.slice(0, FEEDBACK_LIMITS.maxAdminNoteLength),
    updatedAt: new Date().toISOString(),
  };
  const validated = feedbackSchema.parse(next);
  await ref.set(validated);
  return { id: input.id, ...validated };
}
