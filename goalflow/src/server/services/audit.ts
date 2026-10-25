import { auditEvents } from "@/server/db/schema";
import type { Executor } from "@/server/db/client";

/** Append-only history of important changes (task history, plan adjustments, account events). */
export async function audit(
  ex: Executor,
  userId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  data: Record<string, unknown> = {},
) {
  await ex.insert(auditEvents).values({ userId, entityType, entityId, action, data });
}
