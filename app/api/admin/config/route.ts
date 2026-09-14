import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAdminUser } from "@/lib/auth/session";
import { isFirebaseAdminConfigured } from "@/lib/firebase/admin";
import { getSystemConfig, setSystemConfig } from "@/lib/firebase/systemConfig";
import type { SystemConfig } from "@/lib/firebase/schemas";
import { writeAuditLog } from "@/lib/firebase/audit";
import { listEncodings } from "@/features/converter/encodings/registry";
import { logAppError, statusForAppError, toAppError, toSafeResponse } from "@/lib/errors/handlers";
import { AppErrors, type AppError } from "@/lib/errors/types";

export const runtime = "nodejs";

function fail(error: AppError) {
  logAppError(error, { route: "api/admin/config" });
  return NextResponse.json({ ok: false, error: toSafeResponse(error) }, { status: statusForAppError(error) });
}

const tierOverrideSchema = z.object({ maxNonWhitespaceChars: z.number().int().positive() }).nullable().optional();

const bodySchema = z.object({
  tierOverrides: z
    .object({ easy: tierOverrideSchema, medium: tierOverrideSchema, expert: tierOverrideSchema })
    .optional(),
  enabledEncodings: z.array(z.string()).optional(),
  maxUploadSizeBytes: z.number().int().positive().optional(),
  featureFlags: z.object({ documentsEnabled: z.boolean(), comparisonEnabled: z.boolean() }).optional(),
});

/** Current system config, plus the registered encoding ids the config UI can toggle. Admin-only. */
export async function GET(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  try {
    const config = await getSystemConfig();
    const availableEncodings = listEncodings().map((encoding) => ({ id: encoding.id, name: encoding.name }));
    return NextResponse.json({ ok: true, config, availableEncodings });
  } catch (cause) {
    return fail(toAppError(cause, "Could not load system config."));
  }
}

/** Updates the admin-editable overrides layered over the hard-coded defaults. Every write is audited. */
export async function POST(request: NextRequest) {
  if (!isFirebaseAdminConfigured) {
    return fail(AppErrors.unknown("Admin features aren't set up yet for this deployment."));
  }
  const auth = await requireAdminUser(request);
  if (!auth.ok) return fail(auth.error);

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return fail(AppErrors.validation("Expected a JSON body."));
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return fail(
      AppErrors.validation("Invalid system config update.", {
        details: { field: parsed.error.issues[0]?.path.join(".") },
      }),
    );
  }

  // A tier key that's entirely absent from the request body must stay
  // untouched by the merge in `setSystemConfig` — only keys the admin
  // actually sent belong in this patch. `null` for a sent key means "clear
  // it back to the hard-coded default"; `Object.entries` naturally skips any
  // key that wasn't in the parsed JSON at all.
  const rawTierOverrides = parsed.data.tierOverrides;
  const tierOverrides: SystemConfig["tierOverrides"] | undefined = rawTierOverrides
    ? (Object.fromEntries(
        Object.entries(rawTierOverrides).map(([tier, value]) => [tier, value === null ? undefined : value]),
      ) as SystemConfig["tierOverrides"])
    : undefined;

  try {
    const config = await setSystemConfig({ ...parsed.data, tierOverrides });
    try {
      await writeAuditLog({ actorUid: auth.value.uid, action: "config.update", target: "systemConfig/limits", metadata: parsed.data });
    } catch (cause) {
      logAppError({ code: "DATABASE_ERROR", message: "Failed to write audit log.", debug: cause }, { route: "api/admin/config" });
    }
    return NextResponse.json({ ok: true, config });
  } catch (cause) {
    return fail(toAppError(cause, "Could not save system config."));
  }
}
