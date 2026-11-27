// Routes for the Discord bots (apps/discord/*). They authenticate with a token
// an admin issued on the staff dashboard (routes/bot-tokens), never a session, so nothing here may depend on a
// signed-in account. The bots import `BotRoutes` by relative path for a typed
// client, so this file must not import `cloudflare:workers`.
import { DISCORD } from "@it3k/auth";
import { account, user } from "@it3k/db/schema/auth";
import { department } from "@it3k/db/schema/department";
import { userProfile } from "@it3k/db/schema/profile";
import { sport, sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { RouteDeps } from "../../middleware/current-user";
import { requireBotToken } from "../../middleware/bot-token";
import { validate } from "../../middleware/validation";
import { isEsportsDiscordStaff } from "../../policies/esports-discord";

export type BotDeps = Pick<RouteDeps, "getDb"> & {
  /** Deploy stage (prod, staging, pr-42, or dev), echoed so a bot can tell where it landed. */
  stage: string;
  /** The web app of this stage, where people link their Discord account. */
  webOrigin: string;
};

/** Discord snowflakes are 17 to 20 digits. */
const memberParam = z.strictObject({ discordUserId: z.string().regex(/^\d{17,20}$/) });

export const createBotRoutes = (deps: BotDeps) =>
  new Hono()
    .use(requireBotToken(deps))
    // A health check the bot runs on /ping and after /mode switches endpoint.
    .get("/ping", (c) => c.json({ ok: true as const, stage: deps.stage }, 200))
    // What a Discord member is in it3k, so the bot can give them roles and a
    // server nickname. Only what those need: the nickname (ชื่อเล่น) from the
    // participant profile and the in-game names, never a full name or email.
    .get("/members/:discordUserId", validate("param", memberParam), async (c) => {
      const { discordUserId } = c.req.valid("param");
      const db = deps.getDb();
      const [owner] = await db
        .select({
          id: user.id,
          role: user.role,
          banned: user.banned,
          institution: user.institution,
          department: department.name,
          departmentCode: department.code,
          profile: userProfile.values,
          draft: userProfile.draft,
        })
        .from(account)
        .innerJoin(user, eq(user.id, account.userId))
        .leftJoin(department, eq(department.id, user.departmentId))
        .leftJoin(userProfile, eq(userProfile.userId, user.id))
        .where(and(eq(account.providerId, DISCORD), eq(account.accountId, discordUserId)));
      if (!owner) {
        return c.json({ linked: false as const, linkUrl: `${deps.webOrigin}/me` }, 200);
      }
      const banned = owner.banned === true;
      // Approved esports registrations only: a team's roles follow what staff accepted.
      const esports = banned
        ? []
        : await db
            .select({
              divisionCode: sportDivision.code,
              divisionName: sportDivision.name,
              sportName: sport.name,
              institution: sportRegistration.institution,
              ign: sportRegistration.ign,
            })
            .from(sportRegistration)
            .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
            .innerJoin(sport, eq(sport.id, sportDivision.sportId))
            .where(
              and(
                eq(sportRegistration.userId, owner.id),
                eq(sportRegistration.status, "approved"),
                eq(sportDivision.requiresGameProfile, true),
              ),
            );
      // Staff of the esports Discord only: admins, Tech/Live and กีฬา.
      const staff = isEsportsDiscordStaff({
        role: owner.role,
        departmentCode: owner.departmentCode,
        banned,
      });
      // The submitted profile's nickname, else what they have typed so far.
      const nickname = (owner.profile?.nickname || owner.draft?.nickname || "").trim() || null;
      return c.json(
        {
          linked: true as const,
          banned,
          staff,
          nickname: banned ? null : nickname,
          institution: banned ? null : owner.institution,
          department: staff ? owner.department : null,
          esports,
        },
        200,
      );
    });

export type BotRoutes = ReturnType<typeof createBotRoutes>;
