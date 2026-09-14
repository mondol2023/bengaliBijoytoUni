/**
 * Reads/writes the single admin-editable `systemConfig/limits` document.
 * Firestore itself permits public *reads* of this collection (see
 * `firestore.rules` — it drives future client-side limit display), but only
 * `/api/admin/config` (server-verified admin) ever writes it. A missing
 * document is not an error — it means "no overrides yet", so every reader
 * gets `DEFAULT_SYSTEM_CONFIG` merged with whatever fields do exist.
 */
import { getAdminDb, isFirebaseAdminConfigured } from "./admin";
import { systemConfigSchema, type SystemConfig } from "./schemas";

const CONFIG_DOC_PATH = { collection: "systemConfig", doc: "limits" } as const;

export const DEFAULT_SYSTEM_CONFIG: SystemConfig = {
  tierOverrides: {},
  enabledEncodings: undefined,
  maxUploadSizeBytes: undefined,
  featureFlags: { documentsEnabled: true, comparisonEnabled: true },
  updatedAt: new Date(0).toISOString(),
};

export async function getSystemConfig(): Promise<SystemConfig> {
  const snapshot = await getAdminDb().collection(CONFIG_DOC_PATH.collection).doc(CONFIG_DOC_PATH.doc).get();
  if (!snapshot.exists) return DEFAULT_SYSTEM_CONFIG;

  const parsed = systemConfigSchema.safeParse(snapshot.data());
  if (!parsed.success) return DEFAULT_SYSTEM_CONFIG;
  return parsed.data;
}

/**
 * Same as `getSystemConfig`, but safe to call from a route that works with
 * or without Firebase configured (most of the app) — falls back to the
 * defaults instead of throwing when Firebase admin isn't set up, or if the
 * read itself fails for any other reason.
 */
export async function getSystemConfigSafe(): Promise<SystemConfig> {
  if (!isFirebaseAdminConfigured) return DEFAULT_SYSTEM_CONFIG;
  try {
    return await getSystemConfig();
  } catch {
    return DEFAULT_SYSTEM_CONFIG;
  }
}

/** Merges `patch` over whatever config currently exists (or the defaults) and writes the result. */
export async function setSystemConfig(patch: Partial<Omit<SystemConfig, "updatedAt">>): Promise<SystemConfig> {
  const current = await getSystemConfig();
  const next: SystemConfig = {
    ...current,
    ...patch,
    tierOverrides: { ...current.tierOverrides, ...patch.tierOverrides },
    featureFlags: patch.featureFlags ? { ...current.featureFlags, ...patch.featureFlags } : current.featureFlags,
    updatedAt: new Date().toISOString(),
  };
  const validated = systemConfigSchema.parse(next);
  await getAdminDb().collection(CONFIG_DOC_PATH.collection).doc(CONFIG_DOC_PATH.doc).set(validated);
  return validated;
}
