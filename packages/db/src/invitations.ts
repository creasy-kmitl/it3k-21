// Reading and accepting invitations, shared by the auth hooks (packages/auth)
// and the server's invitation routes.
import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "./index";
import { normalizeEmail } from "./invitation-rules";
import { invitation } from "./schema/invitation";
import { leadership } from "./schema/leadership";

export type Invitation = typeof invitation.$inferSelect;

/** SQL: neither accepted nor revoked. At most one row per address is open (invitation_open_email_uidx). */
export function isOpen() {
  return and(isNull(invitation.acceptedAt), isNull(invitation.revokedAt));
}

/** SQL: open and not yet expired at `now`. */
export function isUsable(now = new Date()) {
  return and(isOpen(), gt(invitation.expiresAt, now));
}

/** The address's usable invitation, if any. */
export async function findUsableInvitation(
  db: Database,
  email: string,
  now = new Date(),
): Promise<Invitation | undefined> {
  const [row] = await db
    .select()
    .from(invitation)
    .where(and(eq(invitation.email, normalizeEmail(email)), isUsable(now)));
  return row;
}

/**
 * Marks the invitation accepted by the new account and, for a seat, gives the
 * account that seat if it is still vacant; otherwise the account stays on as
 * staff of the department. Returns whether the account got the seat.
 */
export async function acceptInvitation(
  db: Database,
  invite: Invitation,
  account: { id: string; name: string },
): Promise<{ seat: boolean }> {
  const seatRole = invite.kind === "head" || invite.kind === "vicehead" ? invite.kind : null;
  const accept = db
    .update(invitation)
    .set({ acceptedAt: new Date(), acceptedUserId: account.id })
    .where(and(eq(invitation.id, invite.id), isOpen()));
  if (!seatRole || !invite.departmentId) {
    await accept;
    return { seat: false };
  }
  await db.batch([
    accept,
    db
      .insert(leadership)
      .values({
        departmentId: invite.departmentId,
        role: seatRole,
        userId: account.id,
        name: account.name,
      })
      // The seat was taken after the invitation was sent: the account stays staff.
      .onConflictDoNothing(),
  ]);
  const [held] = await db
    .select({ id: leadership.id })
    .from(leadership)
    .where(eq(leadership.userId, account.id));
  return { seat: !!held };
}
