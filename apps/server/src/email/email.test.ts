import { beforeEach, describe, expect, test } from "bun:test";
import {
  emailCampaign,
  event,
  eventTicket,
  sportRegistration,
  uploadedFile,
  user,
} from "@it3k/db/schema/index";
import { EMPTY_PROFILE } from "@it3k/db/profile";
import type { CustomJob, EmailJob } from "@it3k/email/jobs";
import type { RichTextDoc } from "@it3k/email/rich-text";
import { eq } from "drizzle-orm";

import { createAthleteRoutes } from "../routes/athletes";
import { createEmailRoutes } from "../routes/emails";
import { createProfileRoutes } from "../routes/profile";
import { createRegistrationRoutes } from "../routes/registrations";
import { createTicketRoutes } from "../routes/tickets";
import { createTestContext, defined, readJson } from "../testing";
import { handleEmailBatch, type JobMessage, type OutgoingEmail } from "./consumer";

let t: ReturnType<typeof createTestContext>;

const emailContext = { webOrigin: "http://web.test", apiOrigin: "http://api.test" };
const HOUR = 60 * 60 * 1000;
const PHOTO = "11111111-1111-4111-8111-111111111111";

const doc = (text = "สวัสดีทุกคน"): RichTextDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

beforeEach(() => {
  t = createTestContext();
});

async function seedPhoto(ownerId: string, id = PHOTO) {
  await t.db.insert(uploadedFile).values({
    id,
    ownerId,
    key: `files/${id}`,
    name: "photo.png",
    contentType: "image/png",
    size: 100,
    state: "ready",
    expiresAt: new Date(Date.now() + 24 * HOUR),
  });
}

describe("transactional emails", () => {
  test("the first profile submit queues a summary; a resubmit does not", async () => {
    await t.seedUser("guest", { role: "guest" });
    await seedPhoto("guest");
    const app = createProfileRoutes(t.deps);
    const values = {
      ...EMPTY_PROFILE,
      prefix: "นาย",
      firstName: "สมชาย",
      lastName: "ใจดี",
      nickname: "ชาย",
      phone: "0812345678",
      photoFileId: PHOTO,
      institution: "kmitl",
    };
    const submit = (revision: number) =>
      app.request(
        "/submit",
        t.as("guest", { method: "POST", json: { userId: "guest", revision, values } }),
      );
    expect((await submit(0)).status).toBe(200);
    expect(t.mail.jobs).toMatchObject([
      {
        kind: "profile-submitted",
        to: { email: "guest@example.com", name: "สมชาย ใจดี" },
        profile: { nickname: "ชาย", institution: "kmitl" },
      },
    ]);
    expect((await submit(1)).status).toBe(200);
    expect(t.mail.jobs).toHaveLength(1);
  });

  test("a sport registration queues a confirmation, and a broken queue does not fail it", async () => {
    await t.seedParticipant("a1");
    const app = createRegistrationRoutes({
      ...t.deps,
      discordEnabled: false,
      discordProfile: async () => null,
    });
    const register = (code: string) =>
      t.divisionId(code).then((divisionId) =>
        app.request(
          "/",
          t.as("a1", {
            method: "POST",
            json: {
              divisionId,
              studentId: "65070001",
              shirtNumber: null,
              badmintonRank: null,
              ign: "",
              ignReading: "",
              facebookUrl: "",
            },
          }),
        ),
      );
    expect((await register("athletics-100m-male")).status).toBe(201);
    expect(t.mail.jobs).toMatchObject([
      {
        kind: "sport-registered",
        to: { email: "a1@example.com" },
        registration: { status: "review", institution: "kmutt" },
      },
    ]);

    t.mail.failing = true;
    expect((await register("athletics-400m-male")).status).toBe(201);
    expect(t.mail.jobs).toHaveLength(1);
  });

  test("a review decision queues the result once, and reopening sends nothing", async () => {
    await t.seedUser("tech", { department: "Tech/Live", seat: "head" });
    await t.seedParticipant("a1", "kmitl");
    const divisionId = await t.divisionId("athletics-100m-male");
    await t.db
      .insert(sportRegistration)
      .values({ id: "r1", userId: "a1", divisionId, institution: "kmitl" });
    const app = createAthleteRoutes(t.deps);
    const review = (status: string, version: number, note = "") =>
      app.request("/r1/status", t.as("tech", { method: "PUT", json: { status, note, version } }));

    expect((await review("rejected", 1, "เอกสารไม่ครบ")).status).toBe(200);
    expect((await review("review", 2)).status).toBe(200);
    expect((await review("approved", 3)).status).toBe(200);
    expect(t.mail.jobs).toMatchObject([
      { kind: "sport-reviewed", registration: { status: "rejected", note: "เอกสารไม่ครบ" } },
      { kind: "sport-reviewed", registration: { status: "approved", note: null } },
    ]);
  });

  test("claiming a ticket queues it once; claiming again does not", async () => {
    await t.seedUser("guest", { role: "guest" });
    const now = Date.now();
    await t.db.insert(event).values({
      id: "e1",
      type: "general",
      name: "พิธีเปิด",
      slug: "opening",
      startAt: new Date(now + HOUR),
      endAt: new Date(now + 3 * HOUR),
      ticketsOpen: true,
    });
    const app = createTicketRoutes(t.deps);
    const claim = () => app.request("/events/opening", t.as("guest", { method: "POST", json: {} }));
    expect((await claim()).status).toBe(201);
    expect((await claim()).status).toBe(200);
    expect(t.mail.jobs).toMatchObject([
      { kind: "ticket-claimed", ticket: { ref: "opening", eventName: "พิธีเปิด" } },
    ]);
    // The email draws the same code the kiosk checks.
    const [row] = await t.db.select({ code: eventTicket.code }).from(eventTicket);
    const job = t.mail.jobs[0];
    expect(job?.kind === "ticket-claimed" ? job.ticket.code : null).toBe(row?.code);
  });
});

describe("/api/emails", () => {
  let app: ReturnType<typeof createEmailRoutes>;

  beforeEach(async () => {
    app = createEmailRoutes({ ...t.deps, emailContext });
    await t.seedUser("admin", { role: "admin" });
    await t.seedUser("tech", { department: "Tech/Live" });
    await t.seedUser("reg-kmitl-head", {
      department: "ทะเบียน",
      seat: "head",
      institution: "kmitl",
    });
    await t.seedUser("reg-kmutt-head", {
      department: "ทะเบียน",
      seat: "vicehead",
      institution: "kmutt",
    });
    await t.seedUser("reg-staff", { department: "ทะเบียน", institution: "kmitl" });
    await t.seedUser("art", { department: "Art" });
    await t.seedUser("guest", { role: "guest" });
    await t.seedParticipant("p-kmitl", "kmitl");
    await t.seedParticipant("p-kmutt", "kmutt");
    await t.seedParticipant("p-kmutt-2", "kmutt");
  });

  const send = (who: string, json: unknown, path = "/") =>
    app.request(path, t.as(who, { method: "POST", json }));

  const participants = (institutions: string[] = []) => ({
    subject: "ประกาศ",
    content: doc(),
    audience: { kind: "participants", institutions },
  });

  test("only admins, Tech/Live and KMITL registration leaders may send", async () => {
    for (const who of ["admin", "tech", "reg-kmitl-head"]) {
      expect((await app.request("/audiences", t.as(who))).status).toBe(200);
    }
    // reg-kmutt-head holds a seat from before seats were KMITL's only.
    for (const who of ["reg-staff", "reg-kmutt-head", "art", "guest"]) {
      expect((await app.request("/audiences", t.as(who))).status).toBe(403);
      expect((await send(who, participants())).status).toBe(403);
    }
    expect(t.mail.jobs).toEqual([]);
  });

  test("a send stores the campaign and queues one chunk per 50 people", async () => {
    const res = await send("tech", participants());
    expect(res.status).toBe(201);
    const body = await readJson(res);
    expect(body.recipientCount).toBe(3);
    const [campaign] = await t.db.select().from(emailCampaign);
    expect(defined(campaign)).toMatchObject({
      subject: "ประกาศ",
      recipientCount: 3,
      sentBy: "tech",
      scopeInstitution: null,
    });
    expect(t.mail.jobs).toHaveLength(1);
    const job = t.mail.jobs[0] as CustomJob;
    expect(job.campaignId).toBe(defined(campaign).id);
    expect(job.to.map((to) => to.email).sort()).toEqual([
      "p-kmitl@example.com",
      "p-kmutt-2@example.com",
      "p-kmutt@example.com",
    ]);
  });

  test("registration leaders reach everyone, typed addresses included", async () => {
    const res = await send("reg-kmitl-head", participants());
    expect((await readJson(res)).recipientCount).toBe(3);
    const manual = await send("reg-kmitl-head", {
      ...participants(),
      audience: { kind: "manual", userIds: ["p-kmutt"], emails: ["someone@example.com"] },
    });
    expect((await readJson(manual)).recipientCount).toBe(2);
  });

  test("audiences pick athletes by status and ticket holders by event", async () => {
    const divisionId = await t.divisionId("athletics-100m-male");
    await t.db.insert(sportRegistration).values([
      { userId: "p-kmitl", divisionId, institution: "kmitl", status: "approved" },
      { userId: "p-kmutt", divisionId, institution: "kmutt", status: "review" },
    ]);
    const athletes = await send(
      "tech",
      {
        ...participants(),
        audience: { kind: "athletes", divisionIds: [divisionId], statuses: ["approved"] },
      },
      "/preview",
    );
    expect(await readJson(athletes)).toMatchObject({ recipientCount: 1 });

    const now = Date.now();
    await t.db.insert(event).values({
      id: "e1",
      type: "general",
      name: "งาน",
      startAt: new Date(now + HOUR),
      endAt: new Date(now + 2 * HOUR),
    });
    await t.db
      .insert(eventTicket)
      .values({ eventId: "e1", userId: "p-kmutt-2", code: "c".repeat(32) });
    const holders = await send(
      "tech",
      { ...participants(), audience: { kind: "ticket-holders", eventId: "e1" } },
      "/preview",
    );
    const body = await readJson(holders);
    expect(body.recipientCount).toBe(1);
    expect(String(body.html)).toContain("สวัสดีทุกคน");
  });

  test("bodies are checked: no script links, only finished uploads as images", async () => {
    const withImage = (src: string) => ({
      ...participants(),
      content: { type: "doc", content: [{ type: "image", attrs: { src } }] },
    });
    expect(
      (
        await send("tech", {
          ...participants(),
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: "x",
                    marks: [{ type: "link", attrs: { href: "javascript:x" } }],
                  },
                ],
              },
            ],
          },
        })
      ).status,
    ).toBe(400);
    expect((await send("tech", withImage("https://elsewhere.test/a.png"))).status).toBe(400);
    expect(
      (await send("tech", withImage(`${emailContext.apiOrigin}/api/files/public/${PHOTO}`))).status,
    ).toBe(400);
    await seedPhoto("tech");
    expect(
      (await send("tech", withImage(`${emailContext.apiOrigin}/api/files/public/${PHOTO}`))).status,
    ).toBe(201);
    expect((await send("tech", { ...participants(), content: doc("   ") })).status).toBe(400);
  });

  test("losing the seat between the check and the write refuses the send", async () => {
    t.hooks.beforeBatch = () => {
      t.hooks.beforeBatch = undefined;
      t.sqlite.run("delete from leadership where user_id = 'reg-kmitl-head'");
    };
    expect((await send("reg-kmitl-head", participants())).status).toBe(409);
    expect(await t.db.select().from(emailCampaign)).toEqual([]);
    expect(t.mail.jobs).toEqual([]);
  });

  test("a queue failure removes the campaign so the sender can retry", async () => {
    t.mail.failing = true;
    expect((await send("tech", participants())).status).toBe(503);
    expect(await t.db.select().from(emailCampaign)).toEqual([]);
  });

  test("history shows every sender everything sent", async () => {
    await send("tech", participants());
    await send("reg-kmitl-head", participants());
    for (const who of ["admin", "reg-kmitl-head"]) {
      expect((await readJson(await app.request("/", t.as(who)))).items).toHaveLength(2);
    }
  });

  test("hand-picking searches every account", async () => {
    const res = await app.request("/recipients?q=Athlete", t.as("reg-kmitl-head"));
    const body = (await res.json()) as { items: { id: string }[] };
    expect(body.items.map((item) => item.id).sort()).toEqual(["p-kmitl", "p-kmutt", "p-kmutt-2"]);
  });

  test("banned accounts are skipped", async () => {
    await t.db.update(user).set({ banned: true }).where(eq(user.id, "p-kmitl"));
    expect((await readJson(await send("tech", participants()))).recipientCount).toBe(2);
  });
});

describe("queue consumer", () => {
  function message(body: EmailJob, attempts = 1) {
    const state = { acked: false, retried: null as null | number };
    const msg: JobMessage = {
      body,
      attempts,
      ack: () => {
        state.acked = true;
      },
      retry: (options) => {
        state.retried = options?.delaySeconds ?? 0;
      },
    };
    return { msg, state };
  }

  function deps(send: (email: OutgoingEmail) => Promise<unknown>) {
    const requeued: { job: CustomJob; delay: number }[] = [];
    const warnings: string[] = [];
    return {
      requeued,
      warnings,
      deps: {
        getDb: () => t.db,
        ctx: emailContext,
        send,
        requeue: async (job: CustomJob, delay: number) => {
          requeued.push({ job, delay });
        },
        log: { info: () => {}, warn: (text: string) => warnings.push(text) },
      },
    };
  }

  const ticket = {
    kind: "ticket-claimed" as const,
    to: { email: "a@example.com", name: "เอ" },
    ticket: { ref: "x", eventName: "งาน", startAt: Date.now(), endAt: null, venue: null },
  } satisfies EmailJob;

  test("sends a transactional email from the brand address", async () => {
    const sent: OutgoingEmail[] = [];
    const { msg, state } = message(ticket);
    await handleEmailBatch([msg], deps(async (email) => sent.push(email)).deps);
    expect(state.acked).toBe(true);
    expect(sent[0]).toMatchObject({
      from: { email: "noreply@mail.creasy.club", name: "IT3Kings" },
      to: { email: "a@example.com", name: "เอ" },
    });
    expect(sent[0]?.html).toContain("http://web.test/tickets/x");
    expect(sent[0]?.text.length).toBeGreaterThan(0);
    expect(sent[0]?.attachments).toBeUndefined();
  });

  test("a ticket with a code goes out with its QR as an inline image", async () => {
    const sent: OutgoingEmail[] = [];
    const withCode: EmailJob = { ...ticket, ticket: { ...ticket.ticket, code: "A".repeat(32) } };
    const { msg } = message(withCode);
    await handleEmailBatch([msg], deps(async (email) => sent.push(email)).deps);
    expect(sent[0]?.html).toContain('src="cid:ticket-qr"');
    expect(sent[0]?.attachments).toMatchObject([
      {
        filename: "ticket-qr.png",
        type: "image/png",
        disposition: "inline",
        contentId: "ticket-qr",
      },
    ]);
  });

  test("retries a rate limit and drops a suppressed recipient", async () => {
    const limited = message(ticket);
    await handleEmailBatch(
      [limited.msg],
      deps(async () => {
        throw Object.assign(new Error("slow down"), { code: "E_RATE_LIMIT_EXCEEDED" });
      }).deps,
    );
    expect(limited.state).toEqual({ acked: false, retried: 30 });

    const suppressed = message(ticket);
    const d = deps(async () => {
      throw Object.assign(new Error("no"), { code: "E_RECIPIENT_SUPPRESSED" });
    });
    await handleEmailBatch([suppressed.msg], d.deps);
    expect(suppressed.state.acked).toBe(true);
    expect(d.warnings).toEqual(["email dropped"]);
  });

  test("a staff-email chunk counts results and puts back only who is left", async () => {
    await t.seedUser("tech", { department: "Tech/Live" });
    await t.db.insert(emailCampaign).values({
      id: "c1",
      subject: "ประกาศ",
      content: doc(),
      audience: { kind: "participants", institutions: [] },
      recipientCount: 4,
      sentBy: "tech",
      senderName: "Tech",
    });
    let calls = 0;
    const d = deps(async (email) => {
      calls++;
      const to = typeof email.to === "string" ? email.to : email.to.email;
      if (to === "bad@example.com")
        throw Object.assign(new Error("x"), { code: "E_VALIDATION_ERROR" });
      if (to === "c@example.com")
        throw Object.assign(new Error("x"), { code: "E_RATE_LIMIT_EXCEEDED" });
    });
    const { msg, state } = message({
      kind: "custom",
      campaignId: "c1",
      to: [
        { email: "a@example.com" },
        { email: "bad@example.com" },
        { email: "c@example.com" },
        { email: "d@example.com" },
      ],
    });
    await handleEmailBatch([msg], d.deps);
    expect(calls).toBe(3);
    expect(state.acked).toBe(true);
    expect(d.requeued).toMatchObject([
      {
        job: {
          campaignId: "c1",
          attempt: 1,
          to: [{ email: "c@example.com" }, { email: "d@example.com" }],
        },
      },
    ]);
    const [row] = await t.db.select().from(emailCampaign);
    expect(defined(row)).toMatchObject({ sentCount: 1, failedCount: 1 });
  });
});
