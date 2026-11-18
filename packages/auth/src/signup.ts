// Who may sign in for the first time, and what their new account becomes.
// Anyone on an institution domain may; any other address needs an open
// invitation, which also sets the new account's role, department and seat.
import type { Database } from "@it3k/db";
import { roleForKind } from "@it3k/db/invitation-rules";
import { acceptInvitation, findUsableInvitation } from "@it3k/db/invitations";
import { isSelfSignupEmail } from "@it3k/db/profile";

export const INVITE_REQUIRED = "invite_required";

type NewUser = { email?: unknown; emailVerified?: unknown };

/** Whether this new account may be created; `null` when it may. */
export async function refuseSignup(
  db: Database,
  user: NewUser,
): Promise<{ error: string; errorDescription: string } | null> {
  const email = typeof user.email === "string" ? user.email : "";
  // Google verifies Workspace addresses; an unverified one proves nothing about the domain.
  if (user.emailVerified === true && isSelfSignupEmail(email)) return null;
  if (email && (await findUsableInvitation(db, email))) return null;
  return {
    error: INVITE_REQUIRED,
    errorDescription: "อีเมลนี้ต้องได้รับคำเชิญก่อนเข้าใช้งาน ติดต่อฝ่าย Tech/Live หรือทะเบียน",
  };
}

/** The role, department and institution an invited address starts with; `null` without an invitation. */
export async function invitedDefaults(db: Database, email: string) {
  const invite = await findUsableInvitation(db, email);
  if (!invite) return null;
  return {
    role: roleForKind(invite.kind),
    departmentId: invite.departmentId,
    // Left out when the invitation names none, so nothing overrides it.
    ...(invite.institution ? { institution: invite.institution } : {}),
  };
}

/** Accepts the new account's invitation, if it has one; returns what happened, for the log. */
export async function acceptOnSignup(
  db: Database,
  account: { id: string; name: string; email: string },
) {
  const invite = await findUsableInvitation(db, account.email);
  if (!invite) return null;
  const { seat } = await acceptInvitation(db, invite, account);
  return { invitationId: invite.id, kind: invite.kind, seat };
}
