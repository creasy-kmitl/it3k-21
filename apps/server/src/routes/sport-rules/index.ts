// The Markdown rules of sports and divisions. A division with no rules of its
// own shows its sport's. Everyone signed in reads them; `rules.edit` writes.
//
// Writes follow the version the editor read, so two people saving at once
// cannot overwrite each other: version 0 means "there were no rules", and a
// save based on any other version than the stored one is refused as stale.
import type { Database } from "@it3k/db";
import { user } from "@it3k/db/schema/auth";
import { rulesInput, sport, sportDivision, sportRule } from "@it3k/db/schema/sport";
import { type SQL, and, asc, eq, getTableColumns } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import {
  type CurrentUser,
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { jsonBodyLimit } from "../../middleware/json-body-limit";
import { validate } from "../../middleware/validation";
import { canSport, sportAccessIsAsRead } from "../../policies/sports";

// RULES_MAX_LENGTH Thai characters are three bytes each in UTF-8.
const RULES_BODY_LIMIT = 128 * 1024;

const STALE = "กติกาถูกแก้ไขโดยคนอื่นแล้ว โหลดใหม่ก่อนบันทึก";
const NO_RIGHT = "คุณไม่มีสิทธิ์แก้ไขกติกา";
const SPORT_NOT_FOUND = "ไม่พบกีฬานี้";
const DIVISION_NOT_FOUND = "ไม่พบประเภทนี้";

const idParam = z.strictObject({ id: z.string().min(1) });

type Owner = { sportId: string } | { divisionId: string };

const ownerIs = (owner: Owner): SQL =>
  "sportId" in owner
    ? eq(sportRule.sportId, owner.sportId)
    : eq(sportRule.divisionId, owner.divisionId);

/** The rules `owner` has itself, with who saved them last; null when it has none. */
export type Rules = {
  markdown: string;
  version: number;
  updatedAt: Date;
  updatedByName: string | null;
};

// Typed by hand: a project that reads this file without noUncheckedIndexedAccess
// (the web app, through the client types) would otherwise drop the null.
async function readRules(db: Database, owner: Owner): Promise<Rules | null> {
  const rows = await db
    .select({
      markdown: sportRule.markdown,
      version: sportRule.version,
      updatedAt: sportRule.updatedAt,
      updatedByName: user.name,
    })
    .from(sportRule)
    .leftJoin(user, eq(user.id, sportRule.updatedBy))
    .where(ownerIs(owner));
  return rows[0] ?? null;
}

/** Stores `markdown` as the owner's rules, or removes them when it is blank. */
async function saveRules(
  db: Database,
  actor: CurrentUser,
  owner: Owner,
  input: z.infer<typeof rulesInput>,
): Promise<{ ok: true; rules: Rules | null } | { ok: false; status: 404 | 409; message: string }> {
  const markdown = input.markdown.replace(/\r\n?/g, "\n").trim();
  const guard = abortUnless(db, actor.id, sportAccessIsAsRead(actor));
  const notFound = "sportId" in owner ? SPORT_NOT_FOUND : DIVISION_NOT_FOUND;
  const matchesRead = and(ownerIs(owner), eq(sportRule.version, input.version));

  try {
    if (!markdown) {
      if (input.version === 0) return { ok: true, rules: null };
      const [, removed] = await db.batch([
        guard,
        db.delete(sportRule).where(matchesRead).returning({ id: sportRule.id }),
      ]);
      // Gone already is fine only if nobody wrote newer rules in between.
      if (!removed[0] && (await readRules(db, owner))) {
        return { ok: false, status: 409, message: STALE };
      }
      return { ok: true, rules: null };
    }

    if (input.version === 0) {
      await db.batch([
        guard,
        db.insert(sportRule).values({ ...owner, markdown, updatedBy: actor.id }),
      ]);
    } else {
      const [, updated] = await db.batch([
        guard,
        db
          .update(sportRule)
          .set({ markdown, updatedBy: actor.id, version: input.version + 1 })
          .where(matchesRead)
          .returning({ id: sportRule.id }),
      ]);
      if (!updated[0]) return { ok: false, status: 409, message: STALE };
    }
  } catch (error) {
    const kind = constraintError(error);
    // A unique clash means someone added rules after this editor read none.
    if (kind === "stale" || kind === "unique") return { ok: false, status: 409, message: STALE };
    if (kind === "foreign-key") return { ok: false, status: 404, message: notFound };
    throw error;
  }
  return { ok: true, rules: await readRules(db, owner) };
}

export const createSportRuleRoutes = (deps: RouteDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(jsonBodyLimit(RULES_BODY_LIMIT))

    .get("/sports/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      const [found] = await db
        .select({ id: sport.id, name: sport.name, code: sport.code })
        .from(sport)
        .where(eq(sport.id, id));
      if (!found) return c.json({ message: SPORT_NOT_FOUND }, 404);
      const [rules, divisions] = await Promise.all([
        readRules(db, { sportId: id }),
        db
          .select({ ...getTableColumns(sportDivision), ruleId: sportRule.id })
          .from(sportDivision)
          .leftJoin(sportRule, eq(sportRule.divisionId, sportDivision.id))
          .where(eq(sportDivision.sportId, id))
          .orderBy(asc(sportDivision.sortOrder), asc(sportDivision.name)),
      ]);
      return c.json(
        {
          sport: found,
          rules,
          divisions: divisions.map((division) => ({
            id: division.id,
            name: division.name,
            hasOwnRules: division.ruleId !== null,
          })),
          canEdit: canSport(c.var.user, "rules.edit"),
        },
        200,
      );
    })

    .get("/divisions/:id", validate("param", idParam), async (c) => {
      const db = c.var.db;
      const { id } = c.req.valid("param");
      const [found] = await db
        .select({ id: sportDivision.id, name: sportDivision.name, sportId: sportDivision.sportId })
        .from(sportDivision)
        .where(eq(sportDivision.id, id));
      if (!found) return c.json({ message: DIVISION_NOT_FOUND }, 404);
      const [rules, sportRules] = await Promise.all([
        readRules(db, { divisionId: id }),
        readRules(db, { sportId: found.sportId }),
      ]);
      return c.json(
        { division: found, rules, sportRules, canEdit: canSport(c.var.user, "rules.edit") },
        200,
      );
    })

    .put("/sports/:id", validate("param", idParam), validate("json", rulesInput), async (c) => {
      if (!canSport(c.var.user, "rules.edit")) return c.json({ message: NO_RIGHT }, 403);
      const result = await saveRules(
        c.var.db,
        c.var.user,
        { sportId: c.req.valid("param").id },
        c.req.valid("json"),
      );
      if (!result.ok) return c.json({ message: result.message }, result.status);
      return c.json({ rules: result.rules }, 200);
    })

    .put("/divisions/:id", validate("param", idParam), validate("json", rulesInput), async (c) => {
      if (!canSport(c.var.user, "rules.edit")) return c.json({ message: NO_RIGHT }, 403);
      const result = await saveRules(
        c.var.db,
        c.var.user,
        { divisionId: c.req.valid("param").id },
        c.req.valid("json"),
      );
      if (!result.ok) return c.json({ message: result.message }, result.status);
      return c.json({ rules: result.rules }, 200);
    });

export type SportRuleRoutes = ReturnType<typeof createSportRuleRoutes>;
