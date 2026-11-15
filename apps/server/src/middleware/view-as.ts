// "View as": an admin previews the app as a role, department and institution
// they pick, without an account that holds them. The choice lives in a signed
// cookie on the API host and is applied by requireUser, read-only.
import { INSTITUTION_IDS } from "@it3k/db/profile";
import { LEADERSHIP_ROLES } from "@it3k/db/schema/leadership";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { z } from "zod";

/**
 * Sent as `__Host-it3k_view_as`. The `__Host-` prefix makes browsers refuse
 * the cookie unless it is Secure, Path=/ and set without a Domain, so a page on
 * another `creasy.club` subdomain cannot plant one for the API host.
 */
const COOKIE = "it3k_view_as";
const MAX_AGE = 8 * 60 * 60;

export const VIEW_AS_KINDS = [
  "guest",
  "participant",
  "athlete",
  "staff",
  ...LEADERSHIP_ROLES,
] as const;
export type ViewAsKind = (typeof VIEW_AS_KINDS)[number];

const institution = z.enum(INSTITUTION_IDS).nullable();

/** What an admin may ask to view as. Staff and seats need a department. */
export const viewAsInput = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["guest", "participant", "athlete"]), institution }),
  z.strictObject({
    kind: z.enum(["staff", ...LEADERSHIP_ROLES]),
    departmentId: z.string().trim().min(1),
    institution,
  }),
]);
export type ViewAsInput = z.infer<typeof viewAsInput>;

const stored = z.strictObject({
  /** The admin who chose it; the cookie means nothing to anyone else. */
  by: z.string().min(1),
  kind: z.enum(VIEW_AS_KINDS),
  departmentId: z.string().min(1).nullable(),
  institution,
});
export type ViewAs = z.infer<typeof stored>;

export function toViewAs(by: string, input: ViewAsInput): ViewAs {
  return {
    by,
    kind: input.kind,
    departmentId: "departmentId" in input ? input.departmentId : null,
    institution: input.institution,
  };
}

/**
 * The view the cookie holds, or null when it is missing, unsigned, signed
 * with another key, or malformed. Callers must still check `by` and that the
 * signed-in account is an admin: the signature only proves this API set it.
 */
export async function readViewAs(c: Context, secret: string): Promise<ViewAs | null> {
  let raw: string | false | undefined;
  try {
    raw = await getSignedCookie(c, secret, COOKIE, "host");
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = stored.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeViewAs(c: Context, secret: string, view: ViewAs) {
  await setSignedCookie(c, COOKIE, JSON.stringify(view), secret, {
    prefix: "host",
    httpOnly: true,
    // The web app and the API are different sites, as with the auth cookies.
    sameSite: "None",
    maxAge: MAX_AGE,
  });
}

export function clearViewAs(c: Context) {
  deleteCookie(c, COOKIE, { prefix: "host", httpOnly: true, sameSite: "None" });
}

/** The same deletion as a raw header, for responses built outside Hono (sign-out). */
export const CLEAR_VIEW_AS_COOKIE = `__Host-${COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=None`;
