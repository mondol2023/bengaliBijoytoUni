/**
 * Writes one `auditLogs` entry per mutating admin action. Every
 * `/api/admin/*` route handler calls this after (or alongside) the mutation
 * it just performed. A failed audit write is logged and swallowed at each
 * call site rather than turned into a failed response — losing the audit
 * trail for one action is bad, but blocking a legitimate admin action (e.g.
 * disabling an abusive account) because logging hiccuped would be worse.
 */
import { getAdminDb } from "./admin";
import { auditLogSchema, type AuditLog } from "./schemas";

export interface AuditLogInput {
  actorUid: string;
  action: string;
  target: string;
  metadata?: Record<string, unknown>;
}

export async function writeAuditLog(input: AuditLogInput): Promise<void> {
  const record: AuditLog = {
    actorUid: input.actorUid,
    action: input.action,
    target: input.target,
    metadata: input.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  const validated = auditLogSchema.parse(record);
  await getAdminDb().collection("auditLogs").doc().set(validated);
}
