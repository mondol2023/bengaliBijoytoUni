import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { getAdminAuth, getAdminDb, isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { userProfileSchema, usageOverrideSchema, type UsageOverride, type UserProfile } from "@/lib/firebase/schemas";
import { recordUserTierChange } from "@/lib/firebase/adminStats";
import { writeAuditLog } from "@/lib/firebase/audit";
import { DEFAULT_TIER } from "@/features/usage/tierConfig";
import { failResponder, logAppError, toAppError } from "@/lib/errors/handlers";
import { AppErrors } from "@/lib/errors/types";

export const runtime = "nodejs";

const fail = failResponder("api/admin/users/[uid]");

async function auditSafely(input: Parameters<typeof writeAuditLog>[0]) {
  try {
    await writeAuditLog(input);
  } catch (cause) {
    logAppError({ code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause }, { route: "api/admin/users/[uid]" });
  }
}

const bodySchema = z.object({
  tier: z.enum(["easy", "medium", "expert"]).optional(),
  disabled: z.boolean().optional(),
  /** `null` clears an existing per-user usage override; a positive number sets one; omit to leave it untouched. */
  usageOverrideMaxChars: z.number().int().positive().nullable().optional(),
});

/**
 * Applies one or more admin actions to a single user — tier change, account
 * disable/enable, and/or a per-user usage-limit override. Each provided
 * field is applied independently and audited separately, so a partial
 * failure (e.g. Auth update succeeds, Firestore write fails) is still
 * legible in the audit trail rather than silently merged into one opaque
 * "user updated" entry.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ uid: string }> }) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  const { uid: targetUid } = await params;
  if (!targetUid) return fail(AppErrors.validation("Missing target user id."));

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid user update.", { details: { field: parsed.error.issues[0]?.path.join(".") } }),
    );
  }
  const { tier, disabled, usageOverrideMaxChars } = parsed.data;
  if (tier === undefined && disabled === undefined && usageOverrideMaxChars === undefined) {
    return fail(AppErrors.validation("Nothing to update."));
  }
  if (disabled === true && targetUid === auth.value.uid) {
    return fail(AppErrors.validation("You cannot disable your own account."));
  }

  const db = getAdminDb();

  if (tier !== undefined) {
    try {
      const ref = db.collection("users").doc(targetUid);
      const existingSnapshot = await ref.get();
      const existing = existingSnapshot.exists ? userProfileSchema.safeParse(existingSnapshot.data()) : null;
      const oldTier = existing?.success ? existing.data.tier : DEFAULT_TIER;

      let email: string | null = existing?.success ? existing.data.email : null;
      let displayName: string | null = existing?.success ? existing.data.displayName : null;
      if (!existing?.success) {
        try {
          const record = await getAdminAuth().getUser(targetUid);
          email = record.email ?? null;
          displayName = record.displayName ?? null;
        } catch {
          // Target user doesn't exist in Auth either — fall through and let
          // the write below fail loudly rather than fabricate a profile.
        }
      }

      const record: UserProfile = {
        uid: targetUid,
        email,
        displayName,
        tier,
        createdAt: existing?.success ? existing.data.createdAt : new Date().toISOString(),
      };
      await ref.set(record);

      try {
        await recordUserTierChange(oldTier, tier);
      } catch (cause) {
        logAppError({ code: "DATABASE_ERROR", message: "Failed to update admin stats counters.", debug: cause }, { route: "api/admin/users/[uid]" });
      }
      await auditSafely({
        actorUid: auth.value.uid,
        action: "user.tier.set",
        target: `users/${targetUid}`,
        metadata: { oldTier, newTier: tier },
      });
    } catch (cause) {
      return fail(toAppError(cause, "Could not update this user's tier."));
    }
  }

  if (disabled !== undefined) {
    try {
      await getAdminAuth().updateUser(targetUid, { disabled });
      await auditSafely({
        actorUid: auth.value.uid,
        action: disabled ? "user.disable" : "user.enable",
        target: `auth/${targetUid}`,
        metadata: {},
      });
    } catch (cause) {
      return fail(toAppError(cause, "Could not update this user's account status."));
    }
  }

  if (usageOverrideMaxChars !== undefined) {
    try {
      const ref = db.collection("usageOverrides").doc(targetUid);
      if (usageOverrideMaxChars === null) {
        await ref.delete();
        await auditSafely({ actorUid: auth.value.uid, action: "user.usageOverride.clear", target: `usageOverrides/${targetUid}`, metadata: {} });
      } else {
        const override: UsageOverride = {
          uid: targetUid,
          maxNonWhitespaceChars: usageOverrideMaxChars,
          updatedAt: new Date().toISOString(),
          updatedBy: auth.value.uid,
        };
        await ref.set(usageOverrideSchema.parse(override));
        await auditSafely({
          actorUid: auth.value.uid,
          action: "user.usageOverride.set",
          target: `usageOverrides/${targetUid}`,
          metadata: { maxNonWhitespaceChars: usageOverrideMaxChars },
        });
      }
    } catch (cause) {
      return fail(toAppError(cause, "Could not update this user's usage override."));
    }
  }

  return NextResponse.json({ ok: true });
}
