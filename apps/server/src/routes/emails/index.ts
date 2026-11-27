// Staff emails: write a title and a rich-text body, choose who gets it, send.
// Who may send, and to whom, is decided by policies/email.ts.
import type { Database } from "@it3k/db";
import { type Institution, INSTITUTION_IDS, PHOTO_TYPES } from "@it3k/db/profile";
import { user } from "@it3k/db/schema/auth";
import {
  type EmailAudience,
  emailAudienceSchema,
  emailCampaign,
  MAX_EMAIL_RECIPIENTS,
  MAX_EMAIL_SUBJECT,
} from "@it3k/db/schema/email";
import { event, eventTicket } from "@it3k/db/schema/event";
import { uploadedFile, userProfile } from "@it3k/db/schema/profile";
import { sport, sportDivision, sportRegistration } from "@it3k/db/schema/sport";
import { CUSTOM_CHUNK, type CustomJob, type Recipient } from "@it3k/email/jobs";
import { type EmailContext, renderEmail } from "@it3k/email/render";
import {
  hasContent,
  imageSources,
  MAX_DOC_BYTES,
  publicFileId,
  type RichTextDoc,
  richTextDocSchema,
} from "@it3k/email/rich-text";
import { type SQLWrapper, and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";

import type { MailDeps } from "../../email/mailer";
import {
  type CurrentUserEnv,
  type RouteDeps,
  abortUnless,
  constraintError,
  requireJsonPosts,
  requireUser,
} from "../../middleware/current-user";
import { validate } from "../../middleware/validation";
import { notBanned } from "../../policies/actor-sql";
import { canSendEmail, canSendEmailIsAsRead } from "../../policies/email";
import { containsAny } from "../leadership";

export type EmailDeps = RouteDeps & MailDeps & { emailContext: EmailContext };

const FORBIDDEN = "คุณไม่มีสิทธิ์ส่งอีเมล";
const STALE = "สิทธิ์ของคุณเปลี่ยนไประหว่างส่ง กรุณาโหลดหน้าใหม่";

/** Room for a long body with many images, still far below the Worker's limits. */
const MAX_BODY_BYTES = MAX_DOC_BYTES + 32_000;

const composeInput = z.strictObject({
  subject: z.string().trim().min(1, "กรอกหัวเรื่อง").max(MAX_EMAIL_SUBJECT),
  content: z.unknown(),
  audience: emailAudienceSchema,
});

const recipientsQuery = z.strictObject({ q: z.string().trim().min(1).max(64) });

type Compose = z.infer<typeof composeInput>;

/** A person's institution: the account's, else the one on their submitted profile. */
const personInstitution = sql<
  string | null
>`coalesce(${user.institution}, nullif(json_extract(${userProfile.values}, '$.institution'), ''))`;

function institutionFilter(column: SQLWrapper, list: Institution[]) {
  return list.length ? inArray(column, list) : undefined;
}

type Resolved = { recipients: Recipient[] } | { error: string; status: 400 | 403 | 404 };

/** Everyone the audience names, one entry per address. */
async function resolveRecipients(db: Database, audience: EmailAudience): Promise<Resolved> {
  let rows: Recipient[] = [];
  switch (audience.kind) {
    case "participants": {
      const institutions = audience.institutions;
      rows = await db
        .select({ email: user.email, name: user.name })
        .from(user)
        .innerJoin(userProfile, eq(userProfile.userId, user.id))
        .where(
          and(
            isNotNull(userProfile.submittedAt),
            notBanned(),
            institutionFilter(personInstitution, institutions),
          ),
        );
      break;
    }
    case "athletes": {
      const institutions = audience.institutions;
      rows = await db
        .selectDistinct({ email: user.email, name: user.name })
        .from(sportRegistration)
        .innerJoin(sportDivision, eq(sportDivision.id, sportRegistration.divisionId))
        .innerJoin(user, eq(user.id, sportRegistration.userId))
        .where(
          and(
            inArray(sportRegistration.status, audience.statuses),
            audience.divisionIds.length
              ? inArray(sportRegistration.divisionId, audience.divisionIds)
              : undefined,
            audience.sportId ? eq(sportDivision.sportId, audience.sportId) : undefined,
            institutionFilter(sportRegistration.institution, institutions),
            notBanned(),
          ),
        );
      break;
    }
    case "ticket-holders": {
      const institutions = audience.institutions;
      const [found] = await db
        .select({ id: event.id })
        .from(event)
        .where(eq(event.id, audience.eventId));
      if (!found) return { error: "ไม่พบกิจกรรมนี้", status: 404 };
      rows = await db
        .select({ email: user.email, name: user.name })
        .from(eventTicket)
        .innerJoin(user, eq(user.id, eventTicket.userId))
        .leftJoin(userProfile, eq(userProfile.userId, user.id))
        .where(
          and(
            eq(eventTicket.eventId, audience.eventId),
            notBanned(),
            institutionFilter(personInstitution, institutions),
          ),
        );
      break;
    }
    case "manual": {
      if (audience.userIds.length) {
        const people = await db
          .select({ email: user.email, name: user.name })
          .from(user)
          .where(and(inArray(user.id, audience.userIds), notBanned()));
        rows = people;
      }
      rows.push(...audience.emails.map((email) => ({ email, name: null })));
      break;
    }
  }
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  for (const row of rows) {
    const key = row.email.trim().toLowerCase();
    // `abort-unless:` placeholders and other non-addresses never get mail.
    if (!key.includes("@") || key.startsWith("abort-unless:") || seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email: row.email.trim(), name: row.name || null });
  }
  return { recipients };
}

type Checked = { doc: RichTextDoc } | { error: string; status: 400 };

/** Validates the body: allowed nodes only, and every image one of ours that has finished uploading. */
async function checkContent(db: Database, content: unknown, apiOrigin: string): Promise<Checked> {
  if (JSON.stringify(content ?? null).length > MAX_DOC_BYTES) {
    return { error: "เนื้อหายาวเกินไป", status: 400 };
  }
  const parsed = richTextDocSchema.safeParse(content);
  if (!parsed.success) return { error: "เนื้อหามีรูปแบบที่ไม่รองรับ", status: 400 };
  if (!hasContent(parsed.data)) return { error: "กรอกเนื้อหาอีเมล", status: 400 };
  const ids: string[] = [];
  for (const src of imageSources(parsed.data)) {
    const id = publicFileId(src, apiOrigin);
    if (!id) return { error: "ใช้ได้เฉพาะรูปที่อัปโหลดในระบบ", status: 400 };
    ids.push(id);
  }
  if (ids.length) {
    const unique = [...new Set(ids)];
    const files = await db
      .select({ id: uploadedFile.id, contentType: uploadedFile.contentType })
      .from(uploadedFile)
      .where(and(inArray(uploadedFile.id, unique), eq(uploadedFile.state, "ready")));
    const images = files.filter((file) => PHOTO_TYPES.some((type) => type === file.contentType));
    if (images.length !== unique.length) {
      return { error: "มีรูปที่ยังอัปโหลดไม่เสร็จหรือถูกลบไปแล้ว", status: 400 };
    }
  }
  return { doc: parsed.data };
}

/**
 * Everything a send and a preview both need, or why it is refused. The routes
 * turn a refusal into their own response, so the typed client still sees
 * each route's success body.
 */
async function prepare(
  c: Context<CurrentUserEnv>,
  deps: EmailDeps,
  input: Compose,
): Promise<
  { doc: RichTextDoc; recipients: Recipient[] } | { error: string; status: 400 | 403 | 404 }
> {
  if (!canSendEmail(c.var.user)) return { error: FORBIDDEN, status: 403 };
  const checked = await checkContent(c.var.db, input.content, deps.emailContext.apiOrigin);
  if ("error" in checked) return checked;
  const resolved = await resolveRecipients(c.var.db, input.audience);
  if ("error" in resolved) return resolved;
  return { doc: checked.doc, recipients: resolved.recipients };
}

/** Only those who may send emails get past this. */
const requireEmailAccess = async (c: Context<CurrentUserEnv>, next: () => Promise<void>) => {
  if (!canSendEmail(c.var.user)) return c.json({ message: FORBIDDEN }, 403);
  await next();
};

export const createEmailRoutes = (deps: EmailDeps) =>
  new Hono<CurrentUserEnv>()
    .use(requireJsonPosts)
    .use(requireUser(deps))
    .use(requireEmailAccess)
    .use(async (c, next) => {
      const length = Number(c.req.header("content-length") ?? 0);
      if (length > MAX_BODY_BYTES) return c.json({ message: "เนื้อหายาวเกินไป" }, 413);
      await next();
    })

    // Sports, divisions and events to pick an audience from.
    .get("/audiences", async (c) => {
      const db = c.var.db;
      const [sports, divisions, events] = await Promise.all([
        db
          .select({ id: sport.id, name: sport.name, icon: sport.icon })
          .from(sport)
          .orderBy(asc(sport.sortOrder), asc(sport.name)),
        db
          .select({
            id: sportDivision.id,
            sportId: sportDivision.sportId,
            name: sportDivision.name,
          })
          .from(sportDivision)
          .orderBy(asc(sportDivision.sortOrder), asc(sportDivision.name)),
        db
          .select({ id: event.id, name: event.name, startAt: event.startAt })
          .from(event)
          .orderBy(desc(event.startAt))
          .limit(200),
      ]);
      if (!canSendEmail(c.var.user)) return c.json({ message: FORBIDDEN }, 403);
      return c.json(
        {
          institutions: INSTITUTION_IDS,
          sports: sports.map((item) => ({
            ...item,
            divisions: divisions
              .filter((division) => division.sportId === item.id)
              .map(({ id, name }) => ({ id, name })),
          })),
          events: events.map((item) => ({ ...item, startAt: item.startAt.toISOString() })),
        },
        200,
      );
    })

    // Accounts to hand-pick.
    .get("/recipients", validate("query", recipientsQuery), async (c) => {
      if (!canSendEmail(c.var.user)) return c.json({ message: FORBIDDEN }, 403);
      const { q } = c.req.valid("query");
      const people = await c.var.db
        .select({ id: user.id, name: user.name, email: user.email, institution: personInstitution })
        .from(user)
        .leftJoin(userProfile, eq(userProfile.userId, user.id))
        .where(
          and(
            or(containsAny([user.name], q), containsAny([user.email], q)),
            notBanned(),
            sql`${user.email} not like 'abort-unless:%'`,
          ),
        )
        .orderBy(asc(user.name))
        .limit(20);
      return c.json({ items: people }, 200);
    })

    .post("/preview", validate("json", composeInput), async (c) => {
      const input = c.req.valid("json");
      const ready = await prepare(c, deps, input);
      if ("error" in ready) return c.json({ message: ready.error }, ready.status);
      const rendered = await renderEmail(
        {
          kind: "custom",
          to: { email: "" },
          subject: input.subject,
          content: ready.doc,
          sender: c.var.user.name || null,
        },
        deps.emailContext,
      );
      return c.json(
        {
          recipientCount: ready.recipients.length,
          tooMany: ready.recipients.length > MAX_EMAIL_RECIPIENTS,
          html: rendered.html,
        },
        200,
      );
    })

    .post("/", validate("json", composeInput), async (c) => {
      const db = c.var.db;
      const actor = c.var.user;
      const input = c.req.valid("json");
      const ready = await prepare(c, deps, input);
      if ("error" in ready) return c.json({ message: ready.error }, ready.status);
      const { recipients } = ready;
      if (recipients.length === 0) return c.json({ message: "ไม่มีผู้รับในกลุ่มที่เลือก" }, 400);
      if (recipients.length > MAX_EMAIL_RECIPIENTS) {
        return c.json(
          { message: `ส่งได้ครั้งละไม่เกิน ${MAX_EMAIL_RECIPIENTS.toLocaleString("th-TH")} คน` },
          400,
        );
      }
      const id = crypto.randomUUID();
      try {
        await db.batch([
          abortUnless(db, actor.id, canSendEmailIsAsRead(actor)),
          db.insert(emailCampaign).values({
            id,
            subject: input.subject,
            content: ready.doc,
            audience: input.audience,
            recipientCount: recipients.length,
            sentBy: actor.id,
            senderName: actor.name,
            impersonatedBy: actor.impersonatedBy,
          }),
        ]);
      } catch (error) {
        if (constraintError(error) === "stale") return c.json({ message: STALE }, 409);
        throw error;
      }
      const jobs: CustomJob[] = [];
      for (let i = 0; i < recipients.length; i += CUSTOM_CHUNK) {
        jobs.push({ kind: "custom", campaignId: id, to: recipients.slice(i, i + CUSTOM_CHUNK) });
      }
      try {
        await deps.mailer.enqueue(jobs);
      } catch (error) {
        // Unlike a transactional email, this one is the whole point of the request.
        await db.delete(emailCampaign).where(eq(emailCampaign.id, id));
        c.var.log?.warn("email campaign enqueue failed", {
          email: { campaignId: id, error: String(error) },
        });
        return c.json({ message: "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่" }, 503);
      }
      c.var.log?.set({
        email: { campaignId: id, recipients: recipients.length, audience: input.audience.kind },
      });
      return c.json({ id, recipientCount: recipients.length }, 201);
    })

    // What has been sent.
    .get("/", async (c) => {
      if (!canSendEmail(c.var.user)) return c.json({ message: FORBIDDEN }, 403);
      const rows = await c.var.db
        .select({
          id: emailCampaign.id,
          subject: emailCampaign.subject,
          audience: emailCampaign.audience,
          recipientCount: emailCampaign.recipientCount,
          sentCount: emailCampaign.sentCount,
          failedCount: emailCampaign.failedCount,
          senderName: emailCampaign.senderName,
          createdAt: emailCampaign.createdAt,
        })
        .from(emailCampaign)
        .orderBy(desc(emailCampaign.createdAt))
        .limit(50);
      return c.json(
        {
          items: rows.map(({ audience, createdAt, ...row }) => ({
            ...row,
            audienceKind: audience.kind,
            createdAt: createdAt.toISOString(),
          })),
        },
        200,
      );
    });

export type EmailRoutes = ReturnType<typeof createEmailRoutes>;
