import type { Database } from "@it3k/db";
import { competitionChange } from "@it3k/db/schema/index";

import type { CurrentUser } from "../middleware/current-user";

export type CompetitionEntity =
  | "division"
  | "team"
  | "group"
  | "match"
  | "lineup"
  | "checkin"
  | "placement";

/** An audit row for a competition change; put it in the same batch as the change. */
export function logCompetitionChange(
  db: Database,
  actor: CurrentUser,
  entity: CompetitionEntity,
  entityId: string,
  action: string,
  changes: Record<string, unknown> | null = null,
) {
  return db.insert(competitionChange).values({
    entity,
    entityId,
    actorUserId: actor.id,
    impersonatedBy: actor.impersonatedBy,
    action,
    changes,
  });
}
